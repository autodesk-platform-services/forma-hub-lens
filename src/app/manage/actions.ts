"use server";

import { revalidatePath } from "next/cache";
import { cachedProjects, markProjectsArchived } from "@/lib/aps/admin";
import { requireHubAdminSession, type Session } from "@/lib/aps/auth";
import {
  createProject, fetchCompanies, fetchProjectStatus, fetchProjectUsers,
  importProjectUsers, PRODUCT_ACCESS_OPTIONS, PROJECT_TYPES, productKeysFor,
  removeProjectUser, requireAccountAdmin, setProjectStatus,
  type ImportUser, type NewProject,
} from "@/lib/aps/hubAdmin";
import {
  adminOperation, claimAdminPlan, finishAdminItem, finishAdminOperation, recordAdminSkip,
  saveAdminPlan, startAdminItem,
  type AdminPlan, type PlanKind, type PlanPreview, type PlanSkip,
} from "@/lib/adminOperations";
import { readRoleDirectory } from "@/lib/organization";

export type ManageState = {
  ok: boolean;
  message: string;
  detail?: string[];
  preview?: PlanPreview;
  operationId?: string;
} | null;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_PROJECTS = 50;
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

async function adminSession(accountAdmin = false): Promise<Session> {
  const session = await requireHubAdminSession();
  // The legacy archive endpoint uses app credentials, so it needs this extra
  // signed-in-account check; other writes use the signed-in user's token.
  if (accountAdmin) await requireAccountAdmin(session);
  return session;
}

function selectedProjects(formData: FormData): string[] {
  const ids = [...new Set(formData.getAll("projectIds").map(String).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one project.");
  if (ids.length > MAX_PROJECTS) throw new Error(`Select at most ${MAX_PROJECTS} projects.`);
  const known = new Set(cachedProjects().map((project) => project.id));
  if (ids.some((id) => !known.has(id))) throw new Error("A selected project is not in the synced hub list. Sync and preview again.");
  return ids;
}

function parseMemberLines(raw: string): ImportUser[] {
  const users: ImportUser[] = [];
  const seen = new Set<string>();
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const parts = text.split(",").map((part) => part.trim());
    if (parts.length > 3 || !EMAIL.test(parts[0] ?? "")) throw new Error(`Line ${index + 1}: enter email, First, Last (names optional).`);
    const email = parts[0].toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    users.push({ email, firstName: parts[1] || undefined, lastName: parts[2] || undefined });
  }
  if (!users.length) throw new Error("List at least one valid member.");
  if (users.length > 200) throw new Error("The import limit is 200 members per project.");
  return users;
}

function parseEmails(raw: string): string[] {
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const email = line.trim().toLowerCase();
    if (!email || email.startsWith("#")) continue;
    if (!EMAIL.test(email)) throw new Error(`Line ${index + 1}: enter one email address per line.`);
    if (!seen.has(email)) { seen.add(email); emails.push(email); }
  }
  if (!emails.length) throw new Error("List at least one email address.");
  return emails;
}

function previewState(preview: PlanPreview): ManageState {
  return { ok: true, message: preview.summary, detail: preview.details, preview };
}

export async function bulkAddMembers(_previous: ManageState, formData: FormData): Promise<ManageState> {
  try {
    if (formData.get("intent") === "execute") return await executePlan("add_members", formData);
    const session = await adminSession();
    const projectIds = selectedProjects(formData);
    const users = parseMemberLines(String(formData.get("members") ?? ""));
    const labels = formData.getAll("products").map(String);
    if (labels.some((label) => !PRODUCT_ACCESS_OPTIONS.some((option) => option.label === label))) throw new Error("Unsupported product option.");
    const requestedAccess = String(formData.get("accessLevel") || "member");
    if (requestedAccess !== "member" && requestedAccess !== "administrator") throw new Error("Invalid access level.");
    const access: "member" | "administrator" = requestedAccess;
    const companyId = String(formData.get("companyId") || "").trim();
    if (companyId && !(await fetchCompanies(session)).some((company) => company.id === companyId)) {
      throw new Error("Selected company was not found in this hub.");
    }
    const products = productKeysFor(labels).map((key) => ({ key, access }));
    const roleIds = [...new Set(formData.getAll("roleIds").map(String).filter(Boolean))];
    let roleSourceUploadedAt: number | undefined;
    if (roleIds.length > 20) throw new Error("Select at most 20 roles.");
    if (roleIds.length) {
      const directory = readRoleDirectory();
      if (!directory.rolesAssignable) throw new Error("Role assignment needs a complete, trusted APS Data Connector admin role snapshot.");
      roleSourceUploadedAt = directory.uploadedAt ?? undefined;
      for (const roleId of roleIds) {
        const role = directory.roles.find((item) => item.id === roleId);
        if (!role || role.status !== "active") throw new Error(`Role ${roleId} is absent or inactive in the latest trusted role snapshot.`);
        const missing = projectIds.filter((projectId) => !role.projectIds.includes(projectId));
        if (missing.length) throw new Error(`Role ${role.name} is not listed for ${missing.length} selected project(s) in the trusted role snapshot.`);
      }
    }
    const payload: ImportUser[] = users.map((user) => ({
      ...user, companyId: companyId || undefined, products: products.length ? products : undefined,
      roleIds: roleIds.length ? roleIds : undefined,
    }));
    const targets: Array<{ projectId: string; users: ImportUser[] }> = [];
    const skips: PlanSkip[] = [];
    const details: string[] = [];
    for (const projectId of projectIds) {
      const members = await fetchProjectUsers(session, projectId);
      const existing = new Set(members.map((member) => member.email?.toLowerCase()).filter(Boolean));
      const newUsers = payload.filter((user) => !existing.has(user.email));
      for (const user of payload) if (existing.has(user.email)) {
        skips.push({ key: `${projectId}:${user.email}`, label: `${user.email} · ${projectId}`, reason: "Already a member at preview." });
      }
      if (newUsers.length) targets.push({ projectId, users: newUsers });
      details.push(`${projectId}: ${newUsers.length} to add, ${payload.length - newUsers.length} already members${roleIds.length ? `; ${roleIds.length} role(s) per new member` : ""}`);
    }
    if (!targets.length) throw new Error("All listed people are already members of the selected projects.");
    const plan: AdminPlan = { kind: "add_members", targets, suppressEmails: formData.get("suppressEmails") === "on", roleSourceUploadedAt, skips };
    const planned = targets.reduce((sum, target) => sum + target.users.length, 0);
    return previewState(saveAdminPlan(session, plan, `Preview: ${planned} membership import(s); ${skips.length} already exist.`, details.slice(0, 30)));
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function bulkRemoveMembers(_previous: ManageState, formData: FormData): Promise<ManageState> {
  try {
    if (formData.get("intent") === "execute") return await executePlan("remove_members", formData);
    const session = await adminSession();
    const projectIds = selectedProjects(formData);
    if (String(formData.get("confirm") ?? "").trim() !== "REMOVE") throw new Error("Type REMOVE to preview this access removal.");
    const emails = parseEmails(String(formData.get("members") ?? ""));
    const targets: Array<{ projectId: string; userId: string; email: string }> = [];
    const skips: PlanSkip[] = [];
    const details: string[] = [];
    for (const projectId of projectIds) {
      const members = await fetchProjectUsers(session, projectId);
      const byEmail = new Map(members.filter((member) => member.email).map((member) => [member.email!.toLowerCase(), member]));
      let count = 0;
      for (const email of emails) {
        const member = byEmail.get(email);
        if (member) { targets.push({ projectId, userId: member.id, email }); count++; }
        else skips.push({ key: `${projectId}:${email}`, label: `${email} · ${projectId}`, reason: "No membership at preview." });
      }
      details.push(`${projectId}: ${count} membership(s) to remove`);
    }
    if (!targets.length) throw new Error("No matching memberships were found.");
    return previewState(saveAdminPlan(session, { kind: "remove_members", targets, skips }, `Preview: remove ${targets.length} membership(s); ${skips.length} absent membership(s) skipped.`, details.slice(0, 30)));
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function bulkCreateProjects(_previous: ManageState, formData: FormData): Promise<ManageState> {
  try {
    if (formData.get("intent") === "execute") return await executePlan("create_projects", formData);
    const session = await adminSession();
    const defaultType = String(formData.get("type") || "Office");
    const classification = String(formData.get("classification") || "production");
    if (!PROJECT_TYPES.includes(defaultType)) throw new Error("Invalid default project type.");
    if (classification !== "production" && classification !== "template") throw new Error("Invalid project classification.");
    const rows = String(formData.get("projects") ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    if (!rows.length) throw new Error("List at least one project.");
    if (rows.length > 50) throw new Error("Create at most 50 projects at a time.");
    const existing = new Set(cachedProjects().map((project) => project.name.trim().toLowerCase()));
    const seen = new Set<string>();
    const targets: NewProject[] = [];
    const skips: PlanSkip[] = [];
    for (const [index, row] of rows.entries()) {
      const parts = row.split(",").map((part) => part.trim());
      if (parts.length > 3 || !parts[0] || parts[0].length > 255 || (parts[2]?.length ?? 0) > 255) {
        throw new Error(`Line ${index + 1}: use Name, Type, JobNumber (max 255 characters for name/job number).`);
      }
      const [name, type, jobNumber] = parts;
      const projectType = type || defaultType;
      if (!PROJECT_TYPES.includes(projectType)) throw new Error(`Line ${index + 1}: unsupported project type "${projectType}".`);
      const key = name.toLowerCase();
      if (seen.has(key) || existing.has(key)) {
        skips.push({ key: name, label: name, reason: seen.has(key) ? "Duplicate in this batch." : "Name already in synced hub list." });
        continue;
      }
      seen.add(key);
      targets.push({ name, type: projectType, classification, jobNumber: jobNumber || undefined });
    }
    if (!targets.length) throw new Error("No new project names remain after duplicate checks.");
    const details = targets.map((project) => `${project.name} · ${project.type}${project.jobNumber ? ` · ${project.jobNumber}` : ""}`);
    return previewState(saveAdminPlan(session, { kind: "create_projects", targets, skips }, `Preview: create ${targets.length} project(s); ${skips.length} duplicate name(s) skipped.`, details.slice(0, 30)));
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function bulkArchiveProjects(_previous: ManageState, formData: FormData): Promise<ManageState> {
  try {
    if (formData.get("intent") === "execute") return await executePlan("archive_projects", formData);
    const session = await adminSession(true);
    const projectIds = selectedProjects(formData);
    if (String(formData.get("confirm") ?? "").trim() !== "ARCHIVE") throw new Error("Type ARCHIVE to preview this status change.");
    const targets: Array<{ projectId: string; name: string }> = [];
    const skips: PlanSkip[] = [];
    for (const projectId of projectIds) {
      const current = await fetchProjectStatus(projectId);
      if (!current) throw new Error(`Could not read live status for ${projectId}. Nothing was queued.`);
      if (current.status === "active") targets.push({ projectId, name: current.name });
      else skips.push({ key: projectId, label: current.name, reason: `Live status is ${current.status}; only active projects can be archived.` });
    }
    if (!targets.length) throw new Error("No selected projects are currently active.");
    return previewState(saveAdminPlan(session, { kind: "archive_projects", targets, skips }, `Preview: archive ${targets.length} active project(s); ${skips.length} other status(es) skipped. Data is retained.`, targets.map((target) => `${target.name}: active → archived`).slice(0, 30)));
  } catch (error) { return { ok: false, message: describe(error) }; }
}

async function executePlan(kind: Exclude<PlanKind, "create_company" | "update_company">, formData: FormData): Promise<ManageState> {
  const session = await adminSession(kind === "archive_projects");
  const { plan, operationId } = claimAdminPlan(session, String(formData.get("planId") ?? ""), kind);
  const details: string[] = [];
  let index = 0;
  for (const skip of plan.skips) recordAdminSkip(operationId, index++, skip);

  if (plan.kind === "add_members") {
    for (const target of plan.targets) {
      const indexed = target.users.map((user) => {
        const item = { index: index++, user };
        startAdminItem(operationId, item.index, `${target.projectId}:${user.email}`, `${user.email} · ${target.projectId}`);
        return item;
      });
      let pending = indexed;
      try {
        const requestedRoles = [...new Set(target.users.flatMap((user) => user.roleIds ?? []))];
        if (requestedRoles.length) {
          const directory = readRoleDirectory();
          if (!directory.rolesAssignable || !plan.roleSourceUploadedAt || directory.uploadedAt !== plan.roleSourceUploadedAt) {
            throw new Error("Trusted role snapshot changed since preview; no import sent. Preview again.");
          }
          for (const roleId of requestedRoles) {
            const role = directory.roles.find((item) => item.id === roleId);
            if (!role || role.status !== "active" || !role.projectIds.includes(target.projectId)) {
              throw new Error(`Role ${roleId} is no longer active/available for ${target.projectId}; no import sent.`);
            }
          }
        }
        const members = await fetchProjectUsers(session, target.projectId);
        const existing = new Set(members.map((member) => member.email?.toLowerCase()).filter(Boolean));
        pending = indexed.filter(({ user, index: itemIndex }) => {
          if (!existing.has(user.email)) return true;
          finishAdminItem(operationId, itemIndex, "skipped", "Became a member after preview.");
          return false;
        });
        if (!pending.length) continue;
        const response = await importProjectUsers(session, target.projectId, pending.map(({ user }) => user), plan.suppressEmails);
        for (const item of pending) finishAdminItem(operationId, item.index, "submitted", response.jobId ? `Autodesk import job ${response.jobId}` : "Autodesk import accepted; processing is asynchronous.");
        details.push(`${target.projectId}: submitted ${pending.length} member(s)`);
      } catch (error) {
        for (const item of pending) finishAdminItem(operationId, item.index, "failed", describe(error));
        details.push(`${target.projectId}: FAILED — ${describe(error)}`);
      }
    }
  } else if (plan.kind === "remove_members") {
    const grouped = new Map<string, typeof plan.targets>();
    for (const target of plan.targets) grouped.set(target.projectId, [...(grouped.get(target.projectId) ?? []), target]);
    for (const [projectId, targets] of grouped) {
      let members: Awaited<ReturnType<typeof fetchProjectUsers>>;
      try { members = await fetchProjectUsers(session, projectId); }
      catch (error) {
        for (const target of targets) {
          const itemIndex = index++;
          startAdminItem(operationId, itemIndex, `${projectId}:${target.userId}`, `${target.email} · ${projectId}`);
          finishAdminItem(operationId, itemIndex, "failed", `Could not recheck membership: ${describe(error)}`);
        }
        continue;
      }
      for (const target of targets) {
        const itemIndex = index++;
        startAdminItem(operationId, itemIndex, `${projectId}:${target.userId}`, `${target.email} · ${projectId}`);
        if (!members.some((member) => member.id === target.userId && member.email?.toLowerCase() === target.email)) {
          finishAdminItem(operationId, itemIndex, "skipped", "Membership changed or disappeared after preview.");
          continue;
        }
        try {
          await removeProjectUser(session, projectId, target.userId);
          finishAdminItem(operationId, itemIndex, "succeeded", "Autodesk accepted membership removal.");
        } catch (error) {
          finishAdminItem(operationId, itemIndex, "failed", describe(error));
          details.push(`${projectId}/${target.email}: FAILED — ${describe(error)}`);
        }
      }
    }
  } else if (plan.kind === "create_projects") {
    for (const project of plan.targets) {
      const itemIndex = index++;
      startAdminItem(operationId, itemIndex, project.name, project.name);
      try {
        const result = await createProject(session, project);
        // Autodesk creates projects asynchronously and returns a job ID. An
        // accepted request is not proof that the project became active.
        finishAdminItem(operationId, itemIndex, "submitted", result.jobId
          ? `Autodesk creation job ${result.jobId}; sync projects later to verify activation.`
          : "Autodesk accepted project creation; sync projects later to verify activation.");
        details.push(`${project.name} → submitted${result.jobId ? ` (job ${result.jobId})` : ""}`);
      } catch (error) {
        finishAdminItem(operationId, itemIndex, "failed", describe(error));
        details.push(`${project.name}: FAILED — ${describe(error)}`);
      }
    }
  } else if (plan.kind === "archive_projects") {
    const archived: string[] = [];
    for (const target of plan.targets) {
      const itemIndex = index++;
      startAdminItem(operationId, itemIndex, target.projectId, target.name);
      const current = await fetchProjectStatus(target.projectId); // preserve live-status guard
      if (!current) { finishAdminItem(operationId, itemIndex, "failed", "Could not read live status; no write sent."); continue; }
      if (current.status !== "active") { finishAdminItem(operationId, itemIndex, "skipped", `Live status is ${current.status}; no write sent.`); continue; }
      try {
        const result = await setProjectStatus(target.projectId, "archived");
        archived.push(target.projectId);
        finishAdminItem(operationId, itemIndex, "succeeded", `Active → ${result.status}. Project data retained.`);
        details.push(`${current.name}: active → ${result.status}`);
      } catch (error) {
        finishAdminItem(operationId, itemIndex, "failed", describe(error));
        details.push(`${current.name}: FAILED — ${describe(error)}`);
      }
    }
    if (archived.length) markProjectsArchived(archived);
  }

  finishAdminOperation(operationId, `Executed ${kind.replaceAll("_", " ")} plan.`);
  const result = adminOperation(operationId);
  revalidatePath("/", "layout");
  revalidatePath("/manage/audit");
  return {
    ok: result?.status === "complete",
    message: `Operation recorded: ${result?.succeeded ?? 0} succeeded, ${result?.submitted ?? 0} submitted, ${result?.skipped ?? 0} skipped, ${result?.failed ?? 0} failed. ${kind === "add_members" ? "Membership imports may still be processing in Autodesk." : "Review item outcomes in the audit log."}`,
    detail: details.slice(0, 25),
    operationId,
  };
}
