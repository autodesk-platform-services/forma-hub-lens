import "server-only";

import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { compileCloseoutNamePattern, type CloseoutRuleConfig } from "./closeoutRules";

export const CLOSEOUT_DOMAINS = [
  "files", "assets", "issues", "forms", "submittals", "reviews",
  "rfis", "transmittals", "relationships", "sheets",
] as const;
export type CloseoutDomain = (typeof CLOSEOUT_DOMAINS)[number];

export type CloseoutProfile = {
  id: string;
  name: string;
  client: string;
  businessUnit: string;
  projectType: string;
  region: string;
  deliveryModel: string;
  rules: CloseoutRuleConfig;
  requiredDomains: CloseoutDomain[];
  requiredAssetFields: string[];
  createdBy: string;
  createdAt: number;
};
export type ExpectedDeliverable = {
  id: string;
  profileId: string;
  projectId: string | null;
  domain: CloseoutDomain;
  label: string;
  externalId: string;
  namePattern: string;
  folderPath: string;
  requiredMetadata: string[];
  createdAt: number;
};
export type CloseoutAssignment = {
  projectId: string;
  profileId: string;
  assignedBy: string;
  assignedAt: number;
};
export type SourceAttestation = {
  projectId: string;
  domain: CloseoutDomain;
  sourceRevision: string;
  actor: string;
  note: string;
  attestedAt: number;
};
export type SelectedRecord = {
  id: string;
  projectId: string;
  domain: CloseoutDomain;
  externalId: string;
  versionId: string | null;
  sourceRevision: string;
  sourceKind: "live-aps" | "aps-data-connector" | "user-zip";
  name: string;
  selectedBy: string;
  selectedAt: number;
};
export type StoredAssessment = {
  id: string;
  projectId: string;
  profileId: string;
  status: string;
  result: string;
  actor: string;
  createdAt: number;
};
export type StoredPackage = {
  id: string;
  projectId: string;
  profileId: string;
  assessmentId: string;
  status: "ready" | "exceptions";
  manifest: string;
  sha256: string;
  byteSize: number;
  fileName: string;
  actor: string;
  createdAt: number;
};
export type Acceptance = {
  id: string;
  packageId: string;
  projectId: string;
  actor: string;
  note: string;
  acknowledgedExceptions: string;
  acceptedAt: number;
};

const DOMAIN_SET = new Set<string>(CLOSEOUT_DOMAINS);
export function asCloseoutDomain(raw: string): CloseoutDomain {
  if (!DOMAIN_SET.has(raw)) throw new Error("Choose a supported closeout evidence domain.");
  return raw as CloseoutDomain;
}

function parseArray<T>(raw: string): T[] {
  try { const value: unknown = JSON.parse(raw); return Array.isArray(value) ? value as T[] : []; }
  catch { return []; }
}
function cleaned(value: string, max: number, label: string): string {
  const result = value.trim();
  if (!result || result.length > max) throw new Error(label + " must be 1–" + max + " characters.");
  return result;
}
function simpleFields(values: string[]): string[] {
  const fields = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (fields.length > 30 || fields.some((value) => !/^[a-z][a-z0-9_]{0,79}$/.test(value))) {
    throw new Error("Metadata fields must use column-style names (letters, numbers, underscores).");
  }
  return fields;
}

export function ensureCloseoutTables(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS closeout_profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL,
      business_unit TEXT NOT NULL, project_type TEXT NOT NULL,
      required_domains TEXT NOT NULL, required_asset_fields TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '', delivery_model TEXT NOT NULL DEFAULT '',
      rules TEXT NOT NULL DEFAULT '{"version":1,"files":[],"assets":[],"relationships":[],"projectMetadata":[],"statusPolicies":[]}',
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_deliverables (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, domain TEXT NOT NULL,
      label TEXT NOT NULL, external_id TEXT NOT NULL, required_metadata TEXT NOT NULL,
      project_id TEXT, name_pattern TEXT NOT NULL DEFAULT '', folder_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(profile_id) REFERENCES closeout_profiles(id)
    );
    CREATE INDEX IF NOT EXISTS closeout_deliverables_profile ON closeout_deliverables(profile_id);
    CREATE TABLE IF NOT EXISTS closeout_deliverable_history (
      id TEXT PRIMARY KEY, deliverable_id TEXT NOT NULL, actor TEXT NOT NULL,
      operation TEXT NOT NULL, before_json TEXT, after_json TEXT,
      changed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_profile_rule_history (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, actor TEXT NOT NULL,
      rules TEXT NOT NULL, changed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_assignments (
      project_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
      assigned_by TEXT NOT NULL, assigned_at INTEGER NOT NULL,
      FOREIGN KEY(profile_id) REFERENCES closeout_profiles(id)
    );
    CREATE TABLE IF NOT EXISTS closeout_assignment_history (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      actor TEXT NOT NULL, assigned_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_source_attestations (
      project_id TEXT NOT NULL, domain TEXT NOT NULL, source_revision TEXT NOT NULL,
      actor TEXT NOT NULL, note TEXT NOT NULL, attested_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, domain, source_revision)
    );
    CREATE TABLE IF NOT EXISTS closeout_source_attestation_history (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, domain TEXT NOT NULL,
      source_revision TEXT NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL,
      attested_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_selected_records (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, domain TEXT NOT NULL,
      external_id TEXT NOT NULL, version_id TEXT, source_revision TEXT NOT NULL,
      source_kind TEXT NOT NULL, name TEXT NOT NULL,
      selected_by TEXT NOT NULL, selected_at INTEGER NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS closeout_selection_project
      ON closeout_selected_records(project_id, domain, is_current);
    CREATE TABLE IF NOT EXISTS closeout_selection_events (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, domain TEXT NOT NULL,
      external_id TEXT NOT NULL, operation TEXT NOT NULL, actor TEXT NOT NULL,
      changed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_live_snapshots (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, collected_at INTEGER NOT NULL,
      actor TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS closeout_live_project
      ON closeout_live_snapshots(project_id, collected_at DESC);
    CREATE TABLE IF NOT EXISTS closeout_assessments (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      status TEXT NOT NULL, result TEXT NOT NULL, actor TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS closeout_assessments_project
      ON closeout_assessments(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS closeout_packages (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      assessment_id TEXT NOT NULL, status TEXT NOT NULL,
      manifest TEXT NOT NULL, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL,
      file_name TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(assessment_id) REFERENCES closeout_assessments(id)
    );
    CREATE INDEX IF NOT EXISTS closeout_packages_project
      ON closeout_packages(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS closeout_acceptances (
      id TEXT PRIMARY KEY, package_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL,
      actor TEXT NOT NULL, note TEXT NOT NULL, acknowledged_exceptions TEXT NOT NULL,
      accepted_at INTEGER NOT NULL,
      FOREIGN KEY(package_id) REFERENCES closeout_packages(id)
    );
  `);
  const db = getDb();
  const profileColumns = new Set((db.prepare("PRAGMA table_info(closeout_profiles)").all() as Array<{ name: string }>).map((row) => row.name));
  if (!profileColumns.has("region")) db.exec("ALTER TABLE closeout_profiles ADD COLUMN region TEXT NOT NULL DEFAULT ''");
  if (!profileColumns.has("delivery_model")) db.exec("ALTER TABLE closeout_profiles ADD COLUMN delivery_model TEXT NOT NULL DEFAULT ''");
  if (!profileColumns.has("rules")) db.exec(`ALTER TABLE closeout_profiles ADD COLUMN rules TEXT NOT NULL DEFAULT '{"version":1,"files":[],"assets":[],"relationships":[],"projectMetadata":[],"statusPolicies":[]}'`);
  const deliverableColumns = new Set((db.prepare("PRAGMA table_info(closeout_deliverables)").all() as Array<{ name: string }>).map((row) => row.name));
  if (!deliverableColumns.has("project_id")) db.exec("ALTER TABLE closeout_deliverables ADD COLUMN project_id TEXT");
  if (!deliverableColumns.has("name_pattern")) db.exec("ALTER TABLE closeout_deliverables ADD COLUMN name_pattern TEXT NOT NULL DEFAULT ''");
  if (!deliverableColumns.has("folder_path")) db.exec("ALTER TABLE closeout_deliverables ADD COLUMN folder_path TEXT NOT NULL DEFAULT ''");
}

export function createCloseoutProfile(input: {
  name: string; client: string; businessUnit: string; projectType: string;
  region?: string; deliveryModel?: string; rules?: CloseoutRuleConfig;
  requiredDomains: string[]; requiredAssetFields: string[];
}, actor: string): CloseoutProfile {
  ensureCloseoutTables();
  const requiredDomains = [...new Set(input.requiredDomains.map(asCloseoutDomain))];
  if (!requiredDomains.length) throw new Error("Choose at least one required evidence domain.");
  const profile: CloseoutProfile = {
    id: randomUUID(), name: cleaned(input.name, 120, "Profile name"),
    client: input.client.trim().slice(0, 120), businessUnit: input.businessUnit.trim().slice(0, 120),
    projectType: input.projectType.trim().slice(0, 120),
    region: (input.region ?? "").trim().slice(0, 120),
    deliveryModel: (input.deliveryModel ?? "").trim().slice(0, 120),
    rules: input.rules ?? { version: 1, files: [], assets: [], relationships: [], projectMetadata: [], statusPolicies: [] },
    requiredDomains,
    requiredAssetFields: simpleFields(input.requiredAssetFields),
    createdBy: cleaned(actor, 300, "Actor"), createdAt: Date.now(),
  };
  getDb().prepare(`INSERT INTO closeout_profiles
    (id,name,client,business_unit,project_type,required_domains,required_asset_fields,region,delivery_model,rules,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    profile.id, profile.name, profile.client, profile.businessUnit, profile.projectType,
    JSON.stringify(profile.requiredDomains), JSON.stringify(profile.requiredAssetFields),
    profile.region, profile.deliveryModel, JSON.stringify(profile.rules),
    profile.createdBy, profile.createdAt,
  );
  return profile;
}

function profileFromRow(row: Record<string, unknown>): CloseoutProfile {
  return {
    id: String(row.id), name: String(row.name), client: String(row.client),
    businessUnit: String(row.business_unit), projectType: String(row.project_type),
    region: String(row.region ?? ""), deliveryModel: String(row.delivery_model ?? ""),
    rules: JSON.parse(String(row.rules)) as CloseoutRuleConfig,
    requiredDomains: parseArray<CloseoutDomain>(String(row.required_domains)).filter((domain) => DOMAIN_SET.has(domain)),
    requiredAssetFields: parseArray<string>(String(row.required_asset_fields)),
    createdBy: String(row.created_by), createdAt: Number(row.created_at),
  };
}
export function listCloseoutProfiles(): CloseoutProfile[] {
  ensureCloseoutTables();
  return (getDb().prepare("SELECT * FROM closeout_profiles ORDER BY name COLLATE NOCASE, created_at DESC").all() as Array<Record<string, unknown>>)
    .map(profileFromRow);
}
export function getCloseoutProfile(id: string): CloseoutProfile | null {
  ensureCloseoutTables();
  const row = getDb().prepare("SELECT * FROM closeout_profiles WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? profileFromRow(row) : null;
}
export function saveCloseoutProfileRules(profileId: string, rules: CloseoutRuleConfig, actor: string): CloseoutProfile {
  ensureCloseoutTables();
  const profile = getCloseoutProfile(profileId);
  if (!profile) throw new Error("Closeout profile not found.");
  if (rules.version !== 1 || !Array.isArray(rules.files) || !Array.isArray(rules.assets) ||
    !Array.isArray(rules.relationships) || !Array.isArray(rules.projectMetadata) ||
    !Array.isArray(rules.statusPolicies)) throw new Error("Invalid closeout rule configuration.");
  const serialized = JSON.stringify(rules);
  if (Buffer.byteLength(serialized) > 50_000) throw new Error("Closeout rules exceed the supported profile size.");
  const changedAt = Date.now();
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE closeout_profiles SET rules = ? WHERE id = ?").run(serialized, profileId);
    db.prepare(`INSERT INTO closeout_profile_rule_history (id,profile_id,actor,rules,changed_at)
      VALUES (?,?,?,?,?)`).run(randomUUID(), profileId, cleaned(actor, 300, "Actor"), serialized, changedAt);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { ...profile, rules };
}
export function addExpectedDeliverable(input: {
  profileId: string; projectId?: string; domain: string; label: string;
  externalId?: string; namePattern?: string; folderPath?: string; requiredMetadata: string[];
}, actor: string): ExpectedDeliverable {
  ensureCloseoutTables();
  const profile = getCloseoutProfile(input.profileId);
  if (!profile) throw new Error("Closeout profile no longer exists.");
  const domain = asCloseoutDomain(input.domain);
  if (!profile.requiredDomains.includes(domain)) throw new Error("Add this domain to the profile before requiring its deliverable.");
  const externalId = (input.externalId ?? "").trim();
  const namePattern = (input.namePattern ?? "").trim();
  const folderPath = (input.folderPath ?? "").trim();
  if (externalId.length > 200 || namePattern.length > 160 || folderPath.length > 300) {
    throw new Error("Expected deliverable criteria are too long.");
  }
  if (namePattern && !compileCloseoutNamePattern(namePattern)) {
    throw new Error("Expected name pattern is invalid or unsafe.");
  }
  const item: ExpectedDeliverable = {
    id: randomUUID(), profileId: profile.id,
    projectId: input.projectId?.trim().toLowerCase() || null, domain,
    label: cleaned(input.label, 160, "Deliverable label"),
    externalId, namePattern, folderPath,
    requiredMetadata: simpleFields(input.requiredMetadata), createdAt: Date.now(),
  };
  const db = getDb(); db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO closeout_deliverables
      (id,profile_id,project_id,domain,label,external_id,name_pattern,folder_path,required_metadata,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(item.id, item.profileId, item.projectId, item.domain, item.label,
      item.externalId, item.namePattern, item.folderPath, JSON.stringify(item.requiredMetadata), item.createdAt);
    db.prepare(`INSERT INTO closeout_deliverable_history
      (id,deliverable_id,actor,operation,before_json,after_json,changed_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), item.id, cleaned(actor, 300, "Actor"), "create", null, JSON.stringify(item), item.createdAt);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return item;
}
export function listExpectedDeliverables(profileId: string, projectId?: string): ExpectedDeliverable[] {
  ensureCloseoutTables();
  const sql = projectId ?
    "SELECT * FROM closeout_deliverables WHERE profile_id = ? AND (project_id IS NULL OR project_id = ?) ORDER BY created_at, id" :
    "SELECT * FROM closeout_deliverables WHERE profile_id = ? AND project_id IS NULL ORDER BY created_at, id";
  const rows = projectId ? getDb().prepare(sql).all(profileId, projectId.toLowerCase()) : getDb().prepare(sql).all(profileId);
  return (rows as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id), profileId: String(row.profile_id),
      projectId: row.project_id == null ? null : String(row.project_id),
      domain: asCloseoutDomain(String(row.domain)), label: String(row.label), externalId: String(row.external_id),
      namePattern: String(row.name_pattern ?? ""), folderPath: String(row.folder_path ?? ""),
      requiredMetadata: parseArray<string>(String(row.required_metadata)), createdAt: Number(row.created_at),
    }));
}
export function getExpectedDeliverable(id: string): ExpectedDeliverable | null {
  ensureCloseoutTables();
  const row = getDb().prepare("SELECT profile_id, project_id FROM closeout_deliverables WHERE id = ?")
    .get(id) as { profile_id: string; project_id: string | null } | undefined;
  if (!row) return null;
  return listExpectedDeliverables(row.profile_id, row.project_id ?? undefined).find((item) => item.id === id) ?? null;
}
export function updateExpectedDeliverable(input: {
  id: string; label: string; externalId: string; namePattern: string;
  folderPath: string; requiredMetadata: string[];
}, actor: string): ExpectedDeliverable {
  ensureCloseoutTables();
  const before = getExpectedDeliverable(input.id);
  if (!before) throw new Error("Expected deliverable not found.");
  const namePattern = input.namePattern.trim();
  if (namePattern && !compileCloseoutNamePattern(namePattern)) throw new Error("Expected name pattern is invalid or unsafe.");
  const after: ExpectedDeliverable = { ...before, label: cleaned(input.label, 160, "Deliverable label"),
    externalId: input.externalId.trim().slice(0, 200), namePattern,
    folderPath: input.folderPath.trim().slice(0, 300), requiredMetadata: simpleFields(input.requiredMetadata) };
  const db = getDb(); db.exec("BEGIN");
  try {
    db.prepare(`UPDATE closeout_deliverables SET label=?,external_id=?,name_pattern=?,folder_path=?,required_metadata=? WHERE id=?`)
      .run(after.label, after.externalId, after.namePattern, after.folderPath, JSON.stringify(after.requiredMetadata), after.id);
    db.prepare(`INSERT INTO closeout_deliverable_history
      (id,deliverable_id,actor,operation,before_json,after_json,changed_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), before.id, cleaned(actor, 300, "Actor"), "update", JSON.stringify(before), JSON.stringify(after), Date.now());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return after;
}
export function removeExpectedDeliverable(id: string, actor: string): void {
  ensureCloseoutTables();
  const before = getExpectedDeliverable(id);
  if (!before) throw new Error("Expected deliverable not found.");
  const db = getDb(); db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM closeout_deliverables WHERE id = ?").run(id);
    db.prepare(`INSERT INTO closeout_deliverable_history
      (id,deliverable_id,actor,operation,before_json,after_json,changed_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), id, cleaned(actor, 300, "Actor"), "remove", JSON.stringify(before), null, Date.now());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function assignCloseoutProfile(projectId: string, profileId: string, actor: string): CloseoutAssignment {
  ensureCloseoutTables();
  const profile = getCloseoutProfile(profileId);
  if (!profile) throw new Error("Choose an existing closeout profile.");
  const assignment: CloseoutAssignment = {
    projectId: cleaned(projectId, 200, "Project ID").toLowerCase(), profileId,
    assignedBy: cleaned(actor, 300, "Actor"), assignedAt: Date.now(),
  };
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO closeout_assignments (project_id,profile_id,assigned_by,assigned_at)
      VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
      profile_id=excluded.profile_id, assigned_by=excluded.assigned_by, assigned_at=excluded.assigned_at`)
      .run(assignment.projectId, profileId, assignment.assignedBy, assignment.assignedAt);
    db.prepare(`INSERT INTO closeout_assignment_history (id,project_id,profile_id,actor,assigned_at)
      VALUES (?,?,?,?,?)`).run(randomUUID(), assignment.projectId, profileId, assignment.assignedBy, assignment.assignedAt);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return assignment;
}
export function getCloseoutAssignment(projectId: string): CloseoutAssignment | null {
  ensureCloseoutTables();
  const row = getDb().prepare("SELECT * FROM closeout_assignments WHERE project_id = ?")
    .get(projectId.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? { projectId: String(row.project_id), profileId: String(row.profile_id),
    assignedBy: String(row.assigned_by), assignedAt: Number(row.assigned_at) } : null;
}
export function listCloseoutAssignments(): CloseoutAssignment[] {
  ensureCloseoutTables();
  return (getDb().prepare("SELECT * FROM closeout_assignments ORDER BY assigned_at DESC").all() as Array<Record<string, unknown>>)
    .map((row) => ({ projectId: String(row.project_id), profileId: String(row.profile_id),
      assignedBy: String(row.assigned_by), assignedAt: Number(row.assigned_at) }));
}

export function attestCloseoutSource(input: {
  projectId: string; domain: CloseoutDomain; sourceRevision: string; note: string;
}, actor: string): SourceAttestation {
  ensureCloseoutTables();
  const attestation: SourceAttestation = {
    projectId: cleaned(input.projectId, 200, "Project ID").toLowerCase(), domain: input.domain,
    sourceRevision: cleaned(input.sourceRevision, 200, "Source revision"),
    actor: cleaned(actor, 300, "Actor"), note: cleaned(input.note, 600, "Source verification note"),
    attestedAt: Date.now(),
  };
  const db = getDb(); db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO closeout_source_attestations
      (project_id,domain,source_revision,actor,note,attested_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(project_id,domain,source_revision) DO UPDATE SET
        actor=excluded.actor,note=excluded.note,attested_at=excluded.attested_at`)
      .run(attestation.projectId, attestation.domain, attestation.sourceRevision,
        attestation.actor, attestation.note, attestation.attestedAt);
    db.prepare(`INSERT INTO closeout_source_attestation_history
      (id,project_id,domain,source_revision,actor,note,attested_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), attestation.projectId, attestation.domain, attestation.sourceRevision,
        attestation.actor, attestation.note, attestation.attestedAt);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return attestation;
}
export function closeoutAttestations(projectId: string): SourceAttestation[] {
  ensureCloseoutTables();
  return (getDb().prepare("SELECT * FROM closeout_source_attestations WHERE project_id = ?").all(projectId.toLowerCase()) as Array<Record<string, unknown>>)
    .map((row) => ({ projectId: String(row.project_id), domain: asCloseoutDomain(String(row.domain)),
      sourceRevision: String(row.source_revision), actor: String(row.actor), note: String(row.note),
      attestedAt: Number(row.attested_at) }));
}

export function selectCloseoutRecord(input: Omit<SelectedRecord, "id" | "selectedAt">): SelectedRecord {
  ensureCloseoutTables();
  const record: SelectedRecord = {
    ...input, id: randomUUID(), projectId: cleaned(input.projectId, 200, "Project ID").toLowerCase(),
    externalId: cleaned(input.externalId, 200, "Source record ID"),
    versionId: input.versionId ? cleaned(input.versionId, 300, "Version ID") : null,
    sourceRevision: cleaned(input.sourceRevision, 200, "Source revision"),
    name: cleaned(input.name, 300, "Record name"), selectedBy: cleaned(input.selectedBy, 300, "Actor"),
    selectedAt: Date.now(),
  };
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE closeout_selected_records SET is_current = 0
      WHERE project_id = ? AND domain = ? AND external_id = ? AND is_current = 1`)
      .run(record.projectId, record.domain, record.externalId);
    db.prepare(`INSERT INTO closeout_selected_records
      (id,project_id,domain,external_id,version_id,source_revision,source_kind,name,selected_by,selected_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(record.id, record.projectId, record.domain,
      record.externalId, record.versionId, record.sourceRevision, record.sourceKind,
      record.name, record.selectedBy, record.selectedAt);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return record;
}
export function selectedCloseoutRecords(projectId: string): SelectedRecord[] {
  ensureCloseoutTables();
  return (getDb().prepare(`SELECT * FROM closeout_selected_records
    WHERE project_id = ? AND is_current = 1 ORDER BY domain, selected_at, id`).all(projectId.toLowerCase()) as Array<Record<string, unknown>>)
    .map((row) => ({ id: String(row.id), projectId: String(row.project_id),
      domain: asCloseoutDomain(String(row.domain)), externalId: String(row.external_id),
      versionId: row.version_id == null ? null : String(row.version_id),
      sourceRevision: String(row.source_revision), sourceKind: String(row.source_kind) as SelectedRecord["sourceKind"],
      name: String(row.name), selectedBy: String(row.selected_by), selectedAt: Number(row.selected_at) }));
}
export function clearCloseoutSelection(projectId: string, externalId: string, actor: string): void {
  ensureCloseoutTables();
  const project = cleaned(projectId, 200, "Project ID").toLowerCase();
  const selected = selectedCloseoutRecords(project).find((item) => item.domain === "files" && item.externalId === externalId);
  if (!selected) throw new Error("Current file selection not found.");
  const db = getDb(); db.exec("BEGIN");
  try {
    db.prepare("UPDATE closeout_selected_records SET is_current = 0 WHERE id = ?").run(selected.id);
    db.prepare(`INSERT INTO closeout_selection_events (id,project_id,domain,external_id,operation,actor,changed_at)
      VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), project, "files", externalId, "clear", cleaned(actor, 300, "Actor"), Date.now());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function saveCloseoutAssessment(input: Omit<StoredAssessment, "id" | "createdAt">): StoredAssessment {
  ensureCloseoutTables();
  const value: StoredAssessment = { ...input, id: randomUUID(), createdAt: Date.now() };
  getDb().prepare(`INSERT INTO closeout_assessments
    (id,project_id,profile_id,status,result,actor,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(value.id, value.projectId.toLowerCase(), value.profileId, value.status,
      value.result, value.actor, value.createdAt);
  return value;
}
export function listCloseoutAssessments(projectId: string, limit = 20): StoredAssessment[] {
  ensureCloseoutTables();
  return (getDb().prepare(`SELECT * FROM closeout_assessments WHERE project_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(projectId.toLowerCase(), Math.min(100, Math.max(1, limit))) as Array<Record<string, unknown>>)
    .map((row) => ({ id: String(row.id), projectId: String(row.project_id),
      profileId: String(row.profile_id), status: String(row.status), result: String(row.result),
      actor: String(row.actor), createdAt: Number(row.created_at) }));
}
export function getCloseoutAssessment(id: string): StoredAssessment | null {
  ensureCloseoutTables();
  const row = getDb().prepare("SELECT * FROM closeout_assessments WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? { id: String(row.id), projectId: String(row.project_id),
    profileId: String(row.profile_id), status: String(row.status), result: String(row.result),
    actor: String(row.actor), createdAt: Number(row.created_at) } : null;
}

export function saveCloseoutPackage(input: Omit<StoredPackage, "id" | "createdAt">): StoredPackage {
  ensureCloseoutTables();
  const value: StoredPackage = { ...input, id: randomUUID(), createdAt: Date.now() };
  getDb().prepare(`INSERT INTO closeout_packages
    (id,project_id,profile_id,assessment_id,status,manifest,sha256,byte_size,file_name,actor,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(value.id, value.projectId.toLowerCase(), value.profileId,
    value.assessmentId, value.status, value.manifest, value.sha256, value.byteSize,
    value.fileName, value.actor, value.createdAt);
  return value;
}
function packageFromRow(row: Record<string, unknown>): StoredPackage {
  return { id: String(row.id), projectId: String(row.project_id), profileId: String(row.profile_id),
    assessmentId: String(row.assessment_id), status: String(row.status) as StoredPackage["status"],
    manifest: String(row.manifest), sha256: String(row.sha256), byteSize: Number(row.byte_size),
    fileName: String(row.file_name), actor: String(row.actor), createdAt: Number(row.created_at) };
}
export function getCloseoutPackage(id: string): StoredPackage | null {
  ensureCloseoutTables();
  const row = getDb().prepare("SELECT * FROM closeout_packages WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? packageFromRow(row) : null;
}
export function listCloseoutPackages(projectId: string, limit = 20): StoredPackage[] {
  ensureCloseoutTables();
  return (getDb().prepare(`SELECT * FROM closeout_packages WHERE project_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(projectId.toLowerCase(), Math.min(100, Math.max(1, limit))) as Array<Record<string, unknown>>)
    .map(packageFromRow);
}
export function listRecentCloseoutPackages(limit = 25): StoredPackage[] {
  ensureCloseoutTables();
  return (getDb().prepare("SELECT * FROM closeout_packages ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(Math.min(100, Math.max(1, limit))) as Array<Record<string, unknown>>).map(packageFromRow);
}

export function acceptCloseoutPackage(input: {
  packageId: string; projectId: string; actor: string; note: string;
  acknowledgedExceptions: string[];
}): Acceptance {
  ensureCloseoutTables();
  const item = getCloseoutPackage(input.packageId);
  if (!item || item.projectId !== input.projectId.toLowerCase()) throw new Error("Closeout package was not found for this project.");
  const acceptance: Acceptance = {
    id: randomUUID(), packageId: item.id, projectId: item.projectId,
    actor: cleaned(input.actor, 300, "Actor"),
    note: cleaned(input.note, 1000, "Acceptance note"),
    acknowledgedExceptions: JSON.stringify(input.acknowledgedExceptions), acceptedAt: Date.now(),
  };
  getDb().prepare(`INSERT INTO closeout_acceptances
    (id,package_id,project_id,actor,note,acknowledged_exceptions,accepted_at)
    VALUES (?,?,?,?,?,?,?)`).run(acceptance.id, acceptance.packageId, acceptance.projectId,
    acceptance.actor, acceptance.note, acceptance.acknowledgedExceptions, acceptance.acceptedAt);
  return acceptance;
}
export function getCloseoutAcceptance(packageId: string): Acceptance | null {
  ensureCloseoutTables();
  const row = getDb().prepare("SELECT * FROM closeout_acceptances WHERE package_id = ?")
    .get(packageId) as Record<string, unknown> | undefined;
  return row ? { id: String(row.id), packageId: String(row.package_id), projectId: String(row.project_id),
    actor: String(row.actor), note: String(row.note), acknowledgedExceptions: String(row.acknowledged_exceptions),
    acceptedAt: Number(row.accepted_at) } : null;
}
