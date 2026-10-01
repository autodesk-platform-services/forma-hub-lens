"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHubAdminSession } from "@/lib/aps/auth";
import { fetchCloseoutProjectEvidence } from "@/lib/aps/closeoutEvidence";
import { assessCloseoutProject, closeoutProject, collectCloseoutSources,
  currentSelectableRecord } from "@/lib/closeoutEngine";
import { ingestCloseoutProjectEvidence } from "@/lib/closeoutLive";
import { acknowledgedCloseoutExceptions, buildCloseoutPackage,
  readVerifiedCloseoutPackage, type CloseoutManifest } from "@/lib/closeoutPackage";
import {
  acceptCloseoutPackage, addExpectedDeliverable, asCloseoutDomain,
  assignCloseoutProfile, attestCloseoutSource, clearCloseoutSelection, createCloseoutProfile,
  getCloseoutAssignment, getCloseoutPackage, saveCloseoutAssessment,
  getCloseoutProfile, getExpectedDeliverable, removeExpectedDeliverable,
  saveCloseoutProfileRules, selectCloseoutRecord, updateExpectedDeliverable,
} from "@/lib/closeoutStore";
import { compileCloseoutNamePattern, type CloseoutRuleConfig } from "@/lib/closeoutRules";

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const lines = (value: string) => value.split(/[\r\n,]+/).map((part) => part.trim()).filter(Boolean);
const message = (error: unknown) => error instanceof Error ? error.message : "Closeout action failed.";
function projectPath(projectId: string): string { return `/closeout/${encodeURIComponent(projectId)}`; }
function exactProject(projectId: string) {
  const project = closeoutProject(projectId);
  if (!project) throw new Error("Project is not in the synced hub inventory.");
  return project;
}
function done(path: string, result: string, detail: string): never {
  revalidatePath(path);
  revalidatePath("/closeout");
  redirect(`${path}?${result}=${encodeURIComponent(detail.slice(0, 500))}`);
}
type RuleList = Exclude<keyof CloseoutRuleConfig, "version">;
function ruleList(raw: string): RuleList {
  if (!["files", "assets", "relationships", "projectMetadata", "statusPolicies"].includes(raw)) {
    throw new Error("Choose a supported closeout rule.");
  }
  return raw as RuleList;
}
function optionalCount(raw: string): number | undefined {
  if (!raw) return undefined;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error("Required count must be 1–10,000.");
  return count;
}
function safeFields(raw: string): string[] {
  const fields = [...new Set(lines(raw))];
  if (fields.length > 30 || fields.some((value) => !/^[a-z][a-z0-9_]{0,79}$/i.test(value))) {
    throw new Error("Use up to 30 source field names with letters, numbers, and underscores.");
  }
  return fields;
}
export async function addProfileRuleAction(form: FormData): Promise<void> {
  const profileId = field(form, "profileId");
  let outcome = "Profile rule added."; let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    const profile = getCloseoutProfile(profileId);
    if (!profile) throw new Error("Closeout profile not found.");
    const rules = structuredClone(profile.rules);
    const list = ruleList(field(form, "ruleList"));
    const label = field(form, "label").slice(0, 160);
    if (list === "files") {
      if (!label) throw new Error("File rule label is required.");
      const namePattern = field(form, "namePattern");
      if (namePattern && !compileCloseoutNamePattern(namePattern)) throw new Error("File name pattern is invalid or unsafe.");
      const extensions = lines(field(form, "extensions")).map((value) => value.replace(/^\./, "").toLowerCase());
      if (extensions.some((value) => !/^[a-z0-9]{1,12}$/.test(value))) throw new Error("File extensions must be short alphanumeric values.");
      rules.files.push({ id: randomUUID(), label, folderPath: field(form, "folderPath").slice(0, 300) || undefined,
        includeDescendants: field(form, "includeDescendants") === "yes", extensions,
        namePattern: namePattern || undefined, minCount: optionalCount(field(form, "minCount")),
        requireLatestFinalVersion: field(form, "requireLatestFinalVersion") === "yes",
        requiredMetadata: safeFields(field(form, "requiredMetadata")) });
    } else if (list === "assets") {
      if (!label) throw new Error("Asset rule label is required.");
      const attributes: Record<string, string> = {};
      for (const entry of lines(field(form, "attributes"))) {
        const separator = entry.indexOf("=");
        if (separator < 1 || separator === entry.length - 1) throw new Error("Asset attributes must use field=value entries.");
        const key = entry.slice(0, separator).trim(); const value = entry.slice(separator + 1).trim();
        if (!/^[a-z][a-z0-9_]{0,79}$/i.test(key) || value.length > 160) throw new Error("Asset attribute name or value is invalid.");
        attributes[key] = value;
      }
      rules.assets.push({ id: randomUUID(), label, category: field(form, "category") || undefined,
        status: field(form, "status") || undefined, location: field(form, "location") || undefined,
        attributes, minCount: optionalCount(field(form, "minCount")),
        requireDocumentRelationship: field(form, "requireDocumentRelationship") === "yes",
        requiredMetadata: safeFields(field(form, "requiredMetadata")) });
    } else if (list === "relationships") {
      if (!label) throw new Error("Relationship rule label is required.");
      rules.relationships.push({ id: randomUUID(), label,
        fromDomain: asCloseoutDomain(field(form, "fromDomain")),
        toDomain: asCloseoutDomain(field(form, "toDomain")),
        relationshipType: field(form, "relationshipType") || undefined,
        minCount: optionalCount(field(form, "minCount")) });
    } else if (list === "projectMetadata") {
      const key = field(form, "metadataField");
      if (!/^[a-z][a-z0-9_]{0,79}$/i.test(key)) throw new Error("Project metadata field name is invalid.");
      rules.projectMetadata.push({ field: key, label: label || key, equals: field(form, "equals") || undefined });
    } else {
      const domain = asCloseoutDomain(field(form, "domain"));
      if (!["issues", "forms", "submittals", "reviews", "rfis", "transmittals"].includes(domain)) {
        throw new Error("Closure policies apply to issues, forms, submittals, reviews, RFIs, or transmittals.");
      }
      const openStatuses = lines(field(form, "openStatuses"));
      const terminalStatuses = lines(field(form, "terminalStatuses"));
      if (!openStatuses.length || openStatuses.length > 40 || !terminalStatuses.length || terminalStatuses.length > 40 ||
        [...openStatuses, ...terminalStatuses].some((value) => value.length > 100)) {
        throw new Error("Supply 1–40 open statuses and 1–40 terminal statuses.");
      }
      rules.statusPolicies = rules.statusPolicies.filter((item) => item.domain !== domain);
      rules.statusPolicies.push({ domain, openStatuses, terminalStatuses });
    }
    saveCloseoutProfileRules(profileId, rules, session.userId ?? session.userEmail ?? "");
  } catch (error) { outcome = message(error); kind = "error"; }
  done("/closeout/profiles", kind, outcome);
}
export async function removeProfileRuleAction(form: FormData): Promise<void> {
  const profileId = field(form, "profileId");
  let outcome = "Profile rule removed."; let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    const profile = getCloseoutProfile(profileId);
    if (!profile) throw new Error("Closeout profile not found.");
    const list = ruleList(field(form, "ruleList"));
    const index = Number(field(form, "ruleIndex"));
    const rules = structuredClone(profile.rules);
    const collection = rules[list];
    if (!Number.isInteger(index) || index < 0 || index >= collection.length) throw new Error("Profile rule changed; refresh and retry.");
    // All rule arrays are plain JSON records; remove by verified list and index.
    collection.splice(index, 1);
    saveCloseoutProfileRules(profileId, rules, session.userId ?? session.userEmail ?? "");
  } catch (error) { outcome = message(error); kind = "error"; }
  done("/closeout/profiles", kind, outcome);
}

export async function createProfileAction(form: FormData): Promise<void> {
  let outcome = "Profile created.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    const actor = session.userId ?? session.userEmail ?? "";
    const profile = createCloseoutProfile({ name: field(form, "name"), client: field(form, "client"),
      businessUnit: field(form, "businessUnit"), projectType: field(form, "projectType"),
      region: field(form, "region"), deliveryModel: field(form, "deliveryModel"),
      requiredDomains: form.getAll("requiredDomains").map(String),
      requiredAssetFields: lines(field(form, "requiredAssetFields")) }, actor);
    outcome = `Profile ${profile.name} created. Add its exact expected deliverables below.`;
  } catch (error) { outcome = message(error); kind = "error"; }
  done("/closeout/profiles", kind, outcome);
}
export async function addDeliverableAction(form: FormData): Promise<void> {
  const profileId = field(form, "profileId");
  const projectId = field(form, "projectId");
  let outcome = "Expected deliverable added.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    if (projectId) {
      exactProject(projectId);
      if (getCloseoutAssignment(projectId)?.profileId !== profileId) throw new Error("Project profile assignment changed.");
    }
    addExpectedDeliverable({ profileId, projectId: projectId || undefined,
      domain: field(form, "domain"), label: field(form, "label"),
      externalId: field(form, "externalId"), namePattern: field(form, "namePattern"),
      folderPath: field(form, "folderPath"), requiredMetadata: lines(field(form, "requiredMetadata")) },
      session.userId ?? session.userEmail ?? "");
  } catch (error) { outcome = message(error); kind = "error"; }
  done(projectId ? projectPath(projectId) : "/closeout/profiles", kind, outcome);
}
export async function updateDeliverableAction(form: FormData): Promise<void> {
  const id = field(form, "deliverableId");
  let outcome = "Expected deliverable updated."; let kind = "notice";
  let path = "/closeout/profiles";
  try {
    const session = await requireHubAdminSession();
    const existing = getExpectedDeliverable(id);
    if (!existing) throw new Error("Expected deliverable not found.");
    if (existing.projectId) {
      exactProject(existing.projectId);
      if (getCloseoutAssignment(existing.projectId)?.profileId !== existing.profileId) throw new Error("Project profile assignment changed.");
      path = projectPath(existing.projectId);
    }
    updateExpectedDeliverable({ id, label: field(form, "label"), externalId: field(form, "externalId"),
      namePattern: field(form, "namePattern"), folderPath: field(form, "folderPath"),
      requiredMetadata: safeFields(field(form, "requiredMetadata")) }, session.userId ?? session.userEmail ?? "");
  } catch (error) { outcome = message(error); kind = "error"; }
  done(path, kind, outcome);
}
export async function removeDeliverableAction(form: FormData): Promise<void> {
  const id = field(form, "deliverableId");
  let outcome = "Expected deliverable removed; history retained."; let kind = "notice";
  let path = "/closeout/profiles";
  try {
    const session = await requireHubAdminSession();
    const existing = getExpectedDeliverable(id);
    if (!existing) throw new Error("Expected deliverable not found.");
    if (existing.projectId) {
      exactProject(existing.projectId);
      if (getCloseoutAssignment(existing.projectId)?.profileId !== existing.profileId) throw new Error("Project profile assignment changed.");
      path = projectPath(existing.projectId);
    }
    removeExpectedDeliverable(id, session.userId ?? session.userEmail ?? "");
  } catch (error) { outcome = message(error); kind = "error"; }
  done(path, kind, outcome);
}
export async function clearSelectionAction(form: FormData): Promise<void> {
  const projectId = field(form, "projectId");
  let outcome = "Final file selection cleared; selection history retained."; let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    exactProject(projectId);
    clearCloseoutSelection(projectId, field(form, "externalId"), session.userId ?? session.userEmail ?? "");
  } catch (error) { outcome = message(error); kind = "error"; }
  done(projectPath(projectId), kind, outcome);
}
export async function assignProfileAction(form: FormData): Promise<void> {
  const projectId = field(form, "projectId");
  let outcome = "Profile assigned to project.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    exactProject(projectId);
    assignCloseoutProfile(projectId, field(form, "profileId"), session.userId ?? session.userEmail ?? "");
  } catch (error) { outcome = message(error); kind = "error"; }
  done(projectId && closeoutProject(projectId) ? projectPath(projectId) : "/closeout", kind, outcome);
}
export async function attestSourceAction(form: FormData): Promise<void> {
  const projectId = field(form, "projectId");
  let outcome = "Project coverage attested for the current CSV revision.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    exactProject(projectId);
    const domain = asCloseoutDomain(field(form, "domain"));
    const source = collectCloseoutSources(projectId).find((item) => item.domain === domain);
    if (!source || source.kind !== "user-zip" || !source.complete || !source.revision ||
      source.revision !== field(form, "revision")) throw new Error("Current CSV revision is not complete or has changed.");
    attestCloseoutSource({ projectId, domain, sourceRevision: source.revision,
      note: field(form, "note") }, session.userId ?? session.userEmail ?? "");
  } catch (error) { outcome = message(error); kind = "error"; }
  done(projectPath(projectId), kind, outcome);
}
export async function refreshEvidenceAction(form: FormData): Promise<void> {
  const projectId = field(form, "projectId");
  let outcome = "Authenticated APS evidence refreshed.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    const project = exactProject(projectId);
    const payload = await fetchCloseoutProjectEvidence(session, project.id);
    ingestCloseoutProjectEvidence(session, payload);
    outcome = `APS evidence saved for ${payload.sources.length} domains. Review incomplete domains before assessment.`;
  } catch (error) { outcome = message(error); kind = "error"; }
  done(projectPath(projectId), kind, outcome);
}
export async function selectRecordAction(form: FormData): Promise<void> {
  const projectId = field(form, "projectId");
  let outcome = "Final record selection pinned to current source revision.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    exactProject(projectId);
    const assignment = getCloseoutAssignment(projectId);
    const domain = asCloseoutDomain(field(form, "domain"));
    if (!assignment || domain !== "files") throw new Error("Assign a closeout profile and select a Files record.");
    const externalId = field(form, "externalId");
    const current = currentSelectableRecord(projectId, domain, externalId);
    if (!current.versionId) throw new Error("A specific file version ID is required.");
    if (field(form, "versionId") !== current.versionId) throw new Error("File version changed; refresh the page and select again.");
    selectCloseoutRecord({ projectId, domain, externalId, versionId: current.versionId,
      sourceRevision: current.source.revision!, sourceKind: current.source.kind as "live-aps" | "aps-data-connector" | "user-zip",
      name: current.name, selectedBy: session.userId ?? session.userEmail ?? "" });
  } catch (error) { outcome = message(error); kind = "error"; }
  done(projectPath(projectId), kind, outcome);
}
export async function assessProjectAction(form: FormData): Promise<void> {
  const projectId = field(form, "projectId");
  let outcome = "Assessment saved.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    const assessment = assessCloseoutProject(projectId);
    if (!assessment) throw new Error("Assign a closeout profile first.");
    saveCloseoutAssessment({ projectId: assessment.projectId, profileId: assessment.profile.id,
      status: assessment.status, result: JSON.stringify(assessment), actor: session.userId ?? session.userEmail ?? "" });
    outcome = `Assessment saved: ${assessment.status}; ${assessment.totals.blockers} blockers, ${assessment.totals.unknown} unknown findings.`;
  } catch (error) { outcome = message(error); kind = "error"; }
  done(projectPath(projectId), kind, outcome);
}
export async function buildPackageAction(form: FormData): Promise<void> {
  const projectId = field(form, "projectId");
  let path = projectPath(projectId);
  let outcome = "Package built.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    exactProject(projectId);
    const built = await buildCloseoutPackage(session, projectId);
    path = `/closeout/packages/${built.id}`;
    outcome = "Immutable local package built. Review the manifest and exceptions before acceptance.";
  } catch (error) { outcome = message(error); kind = "error"; }
  done(path, kind, outcome);
}
export async function acceptPackageAction(form: FormData): Promise<void> {
  const packageId = field(form, "packageId");
  let outcome = "Local acceptance recorded.";
  let kind = "notice";
  try {
    const session = await requireHubAdminSession();
    const pkg = getCloseoutPackage(packageId);
    if (!pkg) throw new Error("Package not found.");
    exactProject(pkg.projectId);
    readVerifiedCloseoutPackage(packageId);
    const manifest = JSON.parse(pkg.manifest) as CloseoutManifest;
    const acknowledged = acknowledgedCloseoutExceptions(manifest,
      form.getAll("acknowledgedException").map(String));
    acceptCloseoutPackage({ packageId, projectId: pkg.projectId,
      actor: session.userId ?? session.userEmail ?? "", note: field(form, "note"),
      acknowledgedExceptions: acknowledged });
  } catch (error) { outcome = message(error); kind = "error"; }
  done(`/closeout/packages/${packageId}`, kind, outcome);
}
