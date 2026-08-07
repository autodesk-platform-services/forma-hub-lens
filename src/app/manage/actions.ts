"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/aps/auth";
import {
  createProject,
  fetchProjectStatus,
  fetchProjectUsers,
  importProjectUsers,
  NotAccountAdminError,
  productKeysFor,
  removeProjectUser,
  requireAccountAdmin,
  setProjectStatus,
  type ImportUser,
} from "@/lib/aps/hubAdmin";
import { markProjectsArchived } from "@/lib/aps/admin";

export type ManageState = {
  ok: boolean;
  message: string;
  detail?: string[];
} | null;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Accepts "email, First, Last" or just "email", one per line. */
function parseMemberLines(raw: string): { users: ImportUser[]; errors: string[] } {
  const users: ImportUser[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [email, first, last] = trimmed.split(",").map((part) => part.trim());
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push(`Line ${index + 1}: "${trimmed.slice(0, 40)}" is not an email address.`);
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    users.push({
      email: key,
      firstName: first || undefined,
      lastName: last || undefined,
    });
  }
  return { users, errors };
}

export async function bulkAddMembers(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  try {
    const session = await requireSession();

    const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);
    if (projectIds.length === 0) return { ok: false, message: "Select at least one project." };

    const { users, errors } = parseMemberLines(String(formData.get("members") ?? ""));
    if (users.length === 0) {
      return { ok: false, message: "No valid email addresses found.", detail: errors.slice(0, 8) };
    }
    if (users.length > 200) {
      return { ok: false, message: `${users.length} members exceeds the 200-per-request limit.` };
    }

    const productLabels = formData.getAll("products").map(String).filter(Boolean);
    const accessLevel = String(formData.get("accessLevel") || "member") as
      | "member"
      | "administrator";
    const companyId = String(formData.get("companyId") || "").trim();
    const suppressEmails = formData.get("suppressEmails") === "on";

    const products = productKeysFor(productLabels).map((key) => ({ key, access: accessLevel }));
    const payload: ImportUser[] = users.map((user) => ({
      ...user,
      companyId: companyId || undefined,
      products: products.length ? products : undefined,
    }));

    const results: string[] = [];
    let failures = 0;
    for (const projectId of projectIds) {
      try {
        await importProjectUsers(session, projectId, payload, suppressEmails);
        results.push(`${projectId}: submitted ${payload.length} members`);
      } catch (error) {
        failures++;
        results.push(`${projectId}: FAILED — ${describe(error)}`);
      }
    }

    revalidatePath("/manage");
    return {
      ok: failures === 0,
      message:
        failures === 0
          ? `Submitted ${payload.length} members to ${projectIds.length} project(s). Autodesk processes imports asynchronously.`
          : `${failures} of ${projectIds.length} project(s) failed.`,
      detail: [...errors.slice(0, 4), ...results].slice(0, 12),
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function bulkRemoveMembers(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  try {
    const session = await requireSession();

    const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);
    if (projectIds.length === 0) return { ok: false, message: "Select at least one project." };

    const emails = new Set(
      String(formData.get("members") ?? "")
        .split(/\r?\n/)
        .map((line) => line.split(",")[0].trim().toLowerCase())
        .filter(Boolean),
    );
    if (emails.size === 0) return { ok: false, message: "List at least one email address." };

    const confirm = String(formData.get("confirm") ?? "").trim();
    if (confirm !== "REMOVE") {
      return {
        ok: false,
        message: 'Type REMOVE in the confirmation box to run this. Removal cannot be undone.',
      };
    }

    const detail: string[] = [];
    let removed = 0;
    let notFound = 0;

    for (const projectId of projectIds) {
      let members;
      try {
        members = await fetchProjectUsers(session, projectId);
      } catch (error) {
        detail.push(`${projectId}: could not list members — ${describe(error)}`);
        continue;
      }
      const targets = members.filter((m) => m.email && emails.has(m.email.toLowerCase()));
      if (targets.length === 0) {
        notFound++;
        detail.push(`${projectId}: no listed members matched`);
        continue;
      }
      for (const target of targets) {
        try {
          await removeProjectUser(session, projectId, target.id);
          removed++;
        } catch (error) {
          detail.push(`${projectId}/${target.email}: ${describe(error)}`);
        }
      }
      detail.push(`${projectId}: removed ${targets.length}`);
    }

    revalidatePath("/manage");
    return {
      ok: removed > 0,
      message:
        removed > 0
          ? `Removed ${removed} membership(s) across ${projectIds.length} project(s).`
          : `Nothing removed${notFound ? " — no members matched those emails." : "."}`,
      detail: detail.slice(0, 12),
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function bulkCreateProjects(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  try {
    const session = await requireSession();

    const defaultType = String(formData.get("type") || "Office");
    const classification = String(formData.get("classification") || "production");
    const raw = String(formData.get("projects") ?? "");

    const rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    if (rows.length === 0) return { ok: false, message: "List at least one project name." };
    if (rows.length > 50) {
      return { ok: false, message: `${rows.length} rows — create at most 50 at a time.` };
    }

    const detail: string[] = [];
    let created = 0;

    for (const row of rows) {
      // "Name, Type, JobNumber" — type and job number optional.
      const [name, type, jobNumber] = row.split(",").map((part) => part.trim());
      if (!name) continue;
      try {
        const project = await createProject(session, {
          name,
          type: type || defaultType,
          classification,
          jobNumber: jobNumber || undefined,
        });
        created++;
        detail.push(`${name} → ${project.id}`);
      } catch (error) {
        detail.push(`${name}: FAILED — ${describe(error)}`);
      }
    }

    revalidatePath("/", "layout");
    return {
      ok: created === rows.length,
      message: `Created ${created} of ${rows.length} project(s).`,
      detail: detail.slice(0, 15),
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

const MAX_ARCHIVE_PER_RUN = 50;

/**
 * Moves projects from active to archived. Never deletes: the only field sent to
 * Autodesk is `status`, and the reverse (archived -> active) is a one-field
 * change away in Forma if this is ever run in error.
 */
export async function bulkArchiveProjects(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  try {
    const session = await requireSession();

    // The archive endpoint runs on app credentials, so it does not check who is
    // asking. Gate it on account-admin before anything else happens.
    try {
      await requireAccountAdmin(session);
    } catch (error) {
      if (error instanceof NotAccountAdminError) return { ok: false, message: error.message };
      throw error;
    }

    const projectIds = [...new Set(formData.getAll("projectIds").map(String).filter(Boolean))];
    if (projectIds.length === 0) return { ok: false, message: "Select at least one project." };
    if (projectIds.length > MAX_ARCHIVE_PER_RUN) {
      return {
        ok: false,
        message: `${projectIds.length} projects selected; archive at most ${MAX_ARCHIVE_PER_RUN} at a time.`,
      };
    }

    if (String(formData.get("confirm") ?? "").trim() !== "ARCHIVE") {
      return { ok: false, message: 'Type ARCHIVE in the confirmation box to run this.' };
    }

    const detail: string[] = [];
    const archived: string[] = [];
    let skipped = 0;
    let failed = 0;

    for (const projectId of projectIds) {
      // Read the live status rather than trusting the cache: a project archived
      // by someone else in the meantime should be left alone, not re-written.
      const current = await fetchProjectStatus(projectId);
      if (!current) {
        failed++;
        detail.push(`${projectId}: could not read current status — skipped`);
        continue;
      }
      if (current.status === "archived") {
        skipped++;
        detail.push(`${current.name}: already archived — skipped`);
        continue;
      }
      if (current.status !== "active") {
        skipped++;
        detail.push(`${current.name}: status is "${current.status}", not active — skipped`);
        continue;
      }

      try {
        const result = await setProjectStatus(projectId, "archived");
        archived.push(projectId);
        detail.push(`${current.name}: active → ${result.status}`);
      } catch (error) {
        failed++;
        detail.push(`${current.name}: FAILED — ${describe(error)}`);
      }
    }

    if (archived.length > 0) markProjectsArchived(archived);
    revalidatePath("/", "layout");

    const parts = [`Archived ${archived.length} of ${projectIds.length} selected`];
    if (skipped) parts.push(`${skipped} skipped`);
    if (failed) parts.push(`${failed} failed`);

    return {
      ok: failed === 0 && archived.length > 0,
      message:
        parts.join(", ") +
        ". Archived projects keep all their data and can be set back to active in Forma.",
      detail: detail.slice(0, 25),
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}
