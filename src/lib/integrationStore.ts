import "server-only";
import { env } from "./env";

import { getDb } from "./db";

export type ExpectedType = "any" | "text" | "number" | "date" | "boolean" | "uuid" | "urn";
export type EvidenceStatus = "unknown" | "declared" | "test_recorded";
export const CAPABILITY_KEYS = [
  "fiveLevels", "structureAware", "perProjectSwitch", "quantityJoins", "sheetUrnResolution",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  fiveLevels: "Up to five classifications per item",
  structureAware: "Group by classification structure rather than numbered column",
  perProjectSwitch: "Read Takeoff and Estimate switches for each project",
  quantityJoins: "Join quantities through item and definition keys",
  sheetUrnResolution: "Resolve converted 2D sheet version URNs via Data Management",
};

export type FieldRequirement = {
  table: string;
  field: string;
  type: ExpectedType;
  maxNullPct: number | null;
  consumerField: string | null;
};
export type TableRequirement = {
  table: string;
  minRows: number | null;
  maxAgeHours: number | null;
  projectField: string | null;
  serviceField: string | null;
  baselineRows: number | null;
  baselineMinPct: number;
};
export type ReferenceRequirement = {
  sourceTable: string;
  sourceField: string;
  targetTable: string;
  targetField: string;
  maxMissingPct: number;
};
export type ApiDependency = { path: string; version: string | null; note: string | null };
export type CapabilityEvidence = { status: EvidenceStatus; reference: string | null };
export type IntegrationManifest = {
  id: string;
  version: number;
  name: string;
  customer: string;
  owner: string;
  description: string;
  requestId: string | null;
  expectedProjectIds: string[];
  expectedServices: string[];
  dependencies: ApiDependency[];
  tables: TableRequirement[];
  fields: FieldRequirement[];
  references: ReferenceRequirement[];
  classification: { takeoff: boolean; estimates: boolean; quantities: boolean; sheetReferences: boolean };
  capabilities: Record<CapabilityKey, CapabilityEvidence>;
  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
};

export type IntegrationRun = { id: string; manifestId: string; version: number; evaluatedAt: number; result: unknown };
export type OfficialSnapshot = { id: string; kind: "schema" | "changes"; source: "autodesk_endpoint" | "admin_registered"; sourceUrl: string; capturedAt: number; body: unknown; digest: string };

function ensureTables(): void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS integration_manifests (
    id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS integration_manifest_revisions (
    manifest_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
    updated_at INTEGER NOT NULL, updated_by TEXT,
    PRIMARY KEY (manifest_id, version)
  );
  CREATE TABLE IF NOT EXISTS integration_quality_runs (
    id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL, manifest_version INTEGER NOT NULL,
    evaluated_at INTEGER NOT NULL, result TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS integration_runs_manifest ON integration_quality_runs (manifest_id, evaluated_at DESC);
  CREATE TABLE IF NOT EXISTS integration_official_snapshots (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL,
    captured_at INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS integration_snapshots_kind ON integration_official_snapshots (kind, captured_at DESC);
  CREATE TABLE IF NOT EXISTS integration_api_notices (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_url TEXT NOT NULL, published_on TEXT,
    effective_on TEXT, affected_paths TEXT NOT NULL, description TEXT NOT NULL,
    recorded_at INTEGER NOT NULL, recorded_by TEXT
  );
  CREATE TABLE IF NOT EXISTS integration_monitor_state (
    id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0,
    interval_minutes INTEGER NOT NULL DEFAULT 360, last_run_at INTEGER, next_run_at INTEGER,
    last_error TEXT, running_until INTEGER
  );`);
  if (!env.demoMode) getDb().prepare(`INSERT OR IGNORE INTO integration_monitor_state
    (id, enabled, interval_minutes, last_run_at, next_run_at, last_error, running_until)
    VALUES (1, 0, 360, NULL, NULL, NULL, NULL)`).run();
}

function limited(value: string, label: string, max: number): string {
  const text = value.trim();
  if (text.length > max) throw new Error(`${label} must be at most ${max} characters.`);
  return text;
}

function identifier(value: string, label: string): string {
  const text = limited(value, label, 128);
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(text)) throw new Error(`${label} must be a CSV table or field name.`);
  return text;
}

function optionalNumber(value: string, label: string, max: number): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) throw new Error(`${label} must be between 0 and ${max}.`);
  return number;
}

function lines(value: string, label: string, maxLines: number): string[] {
  const result = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (result.length > maxLines) throw new Error(`${label} supports at most ${maxLines} lines.`);
  return result;
}

function parts(line: string, expected: number, label: string): string[] {
  const result = line.split("|").map((part) => part.trim());
  if (result.length > expected) throw new Error(`${label}: too many | separators in ${line.slice(0, 100)}.`);
  while (result.length < expected) result.push("");
  return result;
}

function splitTableField(value: string, label: string): [string, string] {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) throw new Error(`${label} must use table.field.`);
  return [identifier(value.slice(0, dot), `${label} table`), identifier(value.slice(dot + 1), `${label} field`)];
}

function unique(values: string[]): string[] { return [...new Set(values)]; }

/** A bounded, line-oriented manifest editor; no manifest value is used as a URL to fetch. */
export function parseManifestForm(form: FormData, previous?: IntegrationManifest): IntegrationManifest {
  const get = (key: string) => String(form.get(key) ?? "");
  const now = Date.now();
  const name = limited(get("name"), "Name", 120);
  if (!name) throw new Error("Name is required.");
  const customer = limited(get("customer"), "Customer/team", 120);
  const owner = limited(get("owner"), "Owner", 120);
  const description = limited(get("description"), "Description", 1_000);
  const requestId = limited(get("requestId"), "APS request ID", 200) || null;
  const expectedProjectIds = unique(lines(get("projectIds"), "Projects", 500)
    .map((id) => limited(id, "Project ID", 200)));
  const expectedServices = unique(lines(get("services"), "Service groups", 50)
    .map((service) => identifier(service, "Service group").toLowerCase()));
  const dependencies = lines(get("dependencies"), "API dependencies", 100).map((line) => {
    const [path, version, note] = parts(line, 3, "API dependency");
    const safePath = limited(path, "API path", 250);
    if (!/^\/[a-zA-Z0-9_./:{}-]+$/.test(safePath)) throw new Error("API dependencies must be relative paths without query strings or secrets.");
    return { path: safePath, version: limited(version, "API version", 60) || null, note: limited(note, "API note", 240) || null };
  });
  const tables = lines(get("tables"), "Tables", 100).map((line) => {
    const [table, minRows, maxAgeHours, projectField, serviceField, baselineMinPct] = parts(line, 6, "Table");
    const name = identifier(table, "Table");
    const old = previous?.tables.find((item) => item.table === name);
    return {
      table: name,
      minRows: optionalNumber(minRows, "Minimum rows", 10_000_000),
      maxAgeHours: optionalNumber(maxAgeHours, "Maximum age in hours", 100_000),
      projectField: projectField ? identifier(projectField, "Project field") : null,
      serviceField: serviceField ? identifier(serviceField, "Service field") : null,
      baselineRows: old?.baselineRows ?? null,
      baselineMinPct: optionalNumber(baselineMinPct || "80", "Baseline minimum percentage", 100) ?? 80,
    };
  });
  if (unique(tables.map((item) => item.table)).length !== tables.length) throw new Error("Each required table must be listed once.");
  const knownTables = new Set(tables.map((table) => table.table));
  const fields = lines(get("fields"), "Fields", 500).map((line) => {
    const [key, expectedType, maxNullPct, consumerField] = parts(line, 4, "Field");
    const [table, field] = splitTableField(key, "Field");
    if (!knownTables.has(table)) throw new Error(`Field ${key} references a table absent from the manifest.`);
    const type = (expectedType || "any").toLowerCase() as ExpectedType;
    if (!["any", "text", "number", "date", "boolean", "uuid", "urn"].includes(type)) throw new Error(`Unsupported type for ${key}.`);
    return { table, field, type, maxNullPct: optionalNumber(maxNullPct, "Maximum null percentage", 100), consumerField: consumerField ? identifier(consumerField, "Consumer field") : null };
  });
  if (unique(fields.map((item) => `${item.table}.${item.field}`)).length !== fields.length) throw new Error("Each required field must be listed once.");
  const references = lines(get("references"), "Reference checks", 100).map((line) => {
    const [source, target, maxMissingPct] = parts(line, 3, "Reference check");
    const [sourceTable, sourceField] = splitTableField(source, "Source reference");
    const [targetTable, targetField] = splitTableField(target, "Target reference");
    if (!knownTables.has(sourceTable) || !knownTables.has(targetTable)) throw new Error("Reference checks must use listed tables.");
    return { sourceTable, sourceField, targetTable, targetField, maxMissingPct: optionalNumber(maxMissingPct || "0", "Maximum unmatched percentage", 100) ?? 0 };
  });
  const capabilities = Object.fromEntries(CAPABILITY_KEYS.map((key) => {
    const status = get(`capability_${key}`) as EvidenceStatus;
    if (!["unknown", "declared", "test_recorded"].includes(status)) throw new Error(`Choose a valid status for ${CAPABILITY_LABELS[key]}.`);
    const reference = limited(get(`evidence_${key}`), "Evidence reference", 300) || null;
    if (status === "test_recorded" && !reference) throw new Error(`Record test evidence for ${CAPABILITY_LABELS[key]}.`);
    return [key, { status, reference }];
  })) as Record<CapabilityKey, CapabilityEvidence>;
  return {
    id: previous?.id ?? crypto.randomUUID(), version: (previous?.version ?? 0) + 1,
    name, customer, owner, description, requestId, expectedProjectIds, expectedServices,
    dependencies, tables, fields, references,
    classification: {
      takeoff: get("class_takeoff") === "on",
      estimates: get("class_estimates") === "on",
      quantities: get("class_quantities") === "on",
      sheetReferences: get("class_sheets") === "on",
    },
    capabilities, createdAt: previous?.createdAt ?? now, updatedAt: now, updatedBy: null,
  };
}

export function saveManifest(manifest: IntegrationManifest, actor: string | null): void {
  ensureTables();
  const db = getDb();
  const body = JSON.stringify({ ...manifest, updatedBy: actor });
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT version FROM integration_manifests WHERE id = ?").get(manifest.id) as { version: number } | undefined;
    if (existing && existing.version !== manifest.version - 1) throw new Error("Manifest changed since editing. Reload and retry.");
    if (!existing && manifest.version !== 1) throw new Error("Manifest version is invalid.");
    db.prepare(`INSERT INTO integration_manifests (id, version, body, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, body = excluded.body,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(manifest.id, manifest.version, body, manifest.createdAt, manifest.updatedAt, actor);
    db.prepare(`INSERT INTO integration_manifest_revisions (manifest_id, version, body, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?)`)
      .run(manifest.id, manifest.version, body, manifest.updatedAt, actor);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function getManifest(id: string): IntegrationManifest | null {
  ensureTables();
  const row = getDb().prepare("SELECT body FROM integration_manifests WHERE id = ?").get(id) as { body: string } | undefined;
  return row ? JSON.parse(row.body) as IntegrationManifest : null;
}

export function listManifests(): IntegrationManifest[] {
  ensureTables();
  return (getDb().prepare("SELECT body FROM integration_manifests ORDER BY updated_at DESC").all() as Array<{ body: string }>)
    .map((row) => JSON.parse(row.body) as IntegrationManifest);
}

export function recordRun(manifest: IntegrationManifest, result: unknown, evaluatedAt = Date.now()): string {
  ensureTables();
  const id = crypto.randomUUID();
  getDb().prepare(`INSERT INTO integration_quality_runs (id, manifest_id, manifest_version, evaluated_at, result)
    VALUES (?, ?, ?, ?, ?)`)
    .run(id, manifest.id, manifest.version, evaluatedAt, JSON.stringify(result));
  return id;
}

export function latestRun(manifestId: string): IntegrationRun | null {
  ensureTables();
  const row = getDb().prepare(`SELECT id, manifest_id, manifest_version, evaluated_at, result
    FROM integration_quality_runs WHERE manifest_id = ? ORDER BY evaluated_at DESC LIMIT 1`)
    .get(manifestId) as { id: string; manifest_id: string; manifest_version: number; evaluated_at: number; result: string } | undefined;
  return row ? { id: row.id, manifestId: row.manifest_id, version: row.manifest_version, evaluatedAt: row.evaluated_at, result: JSON.parse(row.result) } : null;
}

export function saveOfficialSnapshot(snapshot: OfficialSnapshot): void {
  ensureTables();
  getDb().prepare(`INSERT INTO integration_official_snapshots (id, kind, source, source_url, captured_at, body, digest)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(snapshot.id, snapshot.kind, snapshot.source, snapshot.sourceUrl, snapshot.capturedAt, JSON.stringify(snapshot.body), snapshot.digest);
}

export function latestOfficialSnapshot(kind: "schema" | "changes"): OfficialSnapshot | null {
  ensureTables();
  const row = getDb().prepare(`SELECT id, kind, source, source_url, captured_at, body, digest
    FROM integration_official_snapshots WHERE kind = ? ORDER BY captured_at DESC LIMIT 1`)
    .get(kind) as { id: string; kind: "schema" | "changes"; source: OfficialSnapshot["source"]; source_url: string; captured_at: number; body: string; digest: string } | undefined;
  return row ? { id: row.id, kind: row.kind, source: row.source, sourceUrl: row.source_url, capturedAt: row.captured_at, body: JSON.parse(row.body), digest: row.digest } : null;
}

export type ApiNotice = { id: string; title: string; sourceUrl: string; publishedOn: string | null; effectiveOn: string | null; affectedPaths: string[]; description: string; recordedAt: number; recordedBy: string | null };
export function addApiNotice(notice: ApiNotice): void {
  ensureTables();
  getDb().prepare(`INSERT INTO integration_api_notices
    (id, title, source_url, published_on, effective_on, affected_paths, description, recorded_at, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(notice.id, notice.title, notice.sourceUrl, notice.publishedOn, notice.effectiveOn,
      JSON.stringify(notice.affectedPaths), notice.description, notice.recordedAt, notice.recordedBy);
}

export function listApiNotices(): ApiNotice[] {
  ensureTables();
  return (getDb().prepare("SELECT * FROM integration_api_notices ORDER BY COALESCE(effective_on, '') ASC, recorded_at DESC")
    .all() as Array<Record<string, string | number | null>>).map((row) => ({
    id: String(row.id), title: String(row.title), sourceUrl: String(row.source_url),
    publishedOn: row.published_on ? String(row.published_on) : null,
    effectiveOn: row.effective_on ? String(row.effective_on) : null,
    affectedPaths: JSON.parse(String(row.affected_paths)) as string[], description: String(row.description),
    recordedAt: Number(row.recorded_at), recordedBy: row.recorded_by ? String(row.recorded_by) : null,
  }));
}

export type IntegrationMonitorState = {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastError: string | null;
  runningUntil: number | null;
};

export function getIntegrationMonitorState(): IntegrationMonitorState {
  ensureTables();
  const row = getDb().prepare("SELECT * FROM integration_monitor_state WHERE id = 1")
    .get() as Record<string, string | number | null>;
  return {
    enabled: Boolean(row.enabled), intervalMinutes: Number(row.interval_minutes),
    lastRunAt: row.last_run_at === null ? null : Number(row.last_run_at),
    nextRunAt: row.next_run_at === null ? null : Number(row.next_run_at),
    lastError: row.last_error === null ? null : String(row.last_error),
    runningUntil: row.running_until === null ? null : Number(row.running_until),
  };
}

export function configureIntegrationMonitor(enabled: boolean, intervalMinutes: number, now = Date.now()): void {
  ensureTables();
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 60 || intervalMinutes > 1_440) {
    throw new Error("Monitor interval must be 60–1,440 minutes.");
  }
  getDb().prepare(`UPDATE integration_monitor_state SET enabled = ?, interval_minutes = ?,
    next_run_at = ?, running_until = NULL WHERE id = 1`)
    .run(enabled ? 1 : 0, intervalMinutes, enabled ? now : null);
}

export function claimIntegrationMonitorRun(now = Date.now()): boolean {
  ensureTables();
  const result = getDb().prepare(`UPDATE integration_monitor_state
    SET running_until = ?, next_run_at = ? + interval_minutes * 60000
    WHERE id = 1 AND enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)
      AND (running_until IS NULL OR running_until <= ?)`)
    .run(now + 10 * 60_000, now, now, now);
  return result.changes === 1;
}

export function finishIntegrationMonitorRun(error: string | null, now = Date.now()): void {
  ensureTables();
  getDb().prepare(`UPDATE integration_monitor_state SET last_run_at = ?, last_error = ?, running_until = NULL WHERE id = 1`)
    .run(now, error?.slice(0, 1000) ?? null);
}
