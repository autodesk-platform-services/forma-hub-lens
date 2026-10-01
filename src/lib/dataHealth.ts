import "server-only";

import { storedJobs, type StoredJob } from "./aps/dataConnector";
import { listTables, recentUploads, type DatasetTable, type UploadRecord } from "./dataset";
import { TOOL_SPECS } from "./dashboards/specs";
import { getDb } from "./db";

const STALE_AFTER_MS = 72 * 60 * 60 * 1_000;

export type SchemaChange = {
  table: string;
  kind: "table added" | "table removed" | "columns changed";
  addedColumns: string[];
  removedColumns: string[];
};

type SchemaSnapshot = Record<string, string[]>;

export type DataHealth = {
  evaluatedAt: number;
  jobs: StoredJob[];
  failedJobs: StoredJob[];
  activityIngestErrors: StoredJob[];
  pendingActivityJobs: StoredJob[];
  tables: DatasetTable[];
  uploads: UploadRecord[];
  latestTableUploadAt: number | null;
  latestActivityIngestAt: number | null;
  latestProjectSyncAt: number | null;
  staleTables: DatasetTable[];
  truncatedTables: DatasetTable[];
  missingSourceTools: Array<{ id: string; name: string; missing: string[] }>;
  readyToolCount: number;
  mixedSnapshot: boolean | null;
  unknownTableLineage: string[];
  schemaBaselineAt: number;
  schemaChanges: SchemaChange[];
};

export function diffSchema(before: SchemaSnapshot, after: SchemaSnapshot): SchemaChange[] {
  const changes: SchemaChange[] = [];
  for (const table of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!(table in before)) {
      changes.push({ table, kind: "table added", addedColumns: after[table], removedColumns: [] });
      continue;
    }
    if (!(table in after)) {
      changes.push({ table, kind: "table removed", addedColumns: [], removedColumns: before[table] });
      continue;
    }
    const oldColumns = new Set(before[table]);
    const newColumns = new Set(after[table]);
    const addedColumns = [...newColumns].filter((name) => !oldColumns.has(name)).sort();
    const removedColumns = [...oldColumns].filter((name) => !newColumns.has(name)).sort();
    if (addedColumns.length || removedColumns.length) {
      changes.push({ table, kind: "columns changed", addedColumns, removedColumns });
    }
  }
  return changes;
}

export function schemaSnapshot(tables: DatasetTable[]): SchemaSnapshot {
  return Object.fromEntries(
    tables.map((table) => [table.name, table.columns.map((column) => column.name)]),
  );
}

/**
 * Registry timestamps are recorded while each CSV is loaded; the upload row is
 * recorded after the ZIP finishes. Associate each table with the next upload.
 * An unmapped table makes lineage unknown, rather than falsely declaring a
 * consistent snapshot. This is a local heuristic, not source project coverage.
 */
export function classifySnapshotLineage(
  tables: DatasetTable[],
  uploads: UploadRecord[],
): { mixed: boolean | null; unknownTables: string[] } {
  if (tables.length === 0) return { mixed: null, unknownTables: [] };
  const ascending = [...uploads].sort((a, b) => a.uploadedAt - b.uploadedAt);
  const ids = new Set<string>();
  const unknownTables: string[] = [];
  for (const table of tables) {
    const upload = ascending.find((candidate) => candidate.uploadedAt >= table.uploadedAt);
    if (upload) ids.add(upload.id);
    else unknownTables.push(table.name);
  }
  return {
    mixed: unknownTables.length > 0 ? null : ids.size > 1,
    unknownTables,
  };
}

export function isFailedJob(job: StoredJob): boolean {
  return job.status === "failed" || job.status === "cancelled" ||
    (job.completionStatus !== null && job.completionStatus !== "success");
}

export function isPendingActivityIngest(job: StoredJob): boolean {
  return job.status === "complete" && (job.completionStatus === null || job.completionStatus === "success") &&
    !job.ingestedAt && Boolean(job.serviceGroups?.split(",").map((group) => group.trim()).includes("activities"));
}

function ensureSchemaBaseline(tables: DatasetTable[], now: number): { at: number; snapshot: SchemaSnapshot } {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS data_health_schema_baseline (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot TEXT NOT NULL,
    captured_at INTEGER NOT NULL
  )`);
  let row = db.prepare("SELECT snapshot, captured_at FROM data_health_schema_baseline WHERE id = 1")
    .get() as { snapshot: string; captured_at: number } | undefined;
  if (!row) {
    const snapshot = schemaSnapshot(tables);
    db.prepare("INSERT INTO data_health_schema_baseline (id, snapshot, captured_at) VALUES (1, ?, ?)")
      .run(JSON.stringify(snapshot), now);
    row = { snapshot: JSON.stringify(snapshot), captured_at: now };
  }
  return { at: row.captured_at, snapshot: JSON.parse(row.snapshot) as SchemaSnapshot };
}

/** Acknowledgement moves the local comparison point to the current registry. */
export function acknowledgeSchemaChanges(now = Date.now()): void {
  const tables = listTables();
  ensureSchemaBaseline(tables, now);
  getDb().prepare("UPDATE data_health_schema_baseline SET snapshot = ?, captured_at = ? WHERE id = 1")
    .run(JSON.stringify(schemaSnapshot(tables)), now);
}

export function getDataHealth(now = Date.now()): DataHealth {
  const jobs = storedJobs();
  const tables = listTables();
  // All upload records are needed to associate a retained table with its ZIP.
  const uploads = recentUploads(100_000);
  const baseline = ensureSchemaBaseline(tables, now);
  const tableNames = new Set(tables.map((table) => table.name));
  const missingSourceTools = TOOL_SPECS.flatMap((spec) => {
    const missing = spec.requires.filter((name) => !tableNames.has(name));
    return missing.length ? [{ id: spec.id, name: spec.name, missing }] : [];
  });
  const lineage = classifySnapshotLineage(tables, uploads);
  const latestProjectSyncRow = getDb().prepare("SELECT MAX(synced_at) AS latest FROM projects")
    .get() as { latest: number | null };

  return {
    evaluatedAt: now,
    jobs,
    failedJobs: jobs.filter(isFailedJob),
    activityIngestErrors: jobs.filter((job) => Boolean(job.ingestError)),
    pendingActivityJobs: jobs.filter(isPendingActivityIngest),
    tables,
    uploads: uploads.slice(0, 10),
    latestTableUploadAt: tables.length ? Math.max(...tables.map((table) => table.uploadedAt)) : null,
    latestActivityIngestAt: jobs.reduce<number | null>((latest, job) =>
      job.ingestedAt && (!latest || job.ingestedAt > latest) ? job.ingestedAt : latest, null),
    latestProjectSyncAt: latestProjectSyncRow.latest,
    staleTables: tables.filter((table) => now - table.uploadedAt > STALE_AFTER_MS),
    truncatedTables: tables.filter((table) => table.truncated),
    missingSourceTools,
    readyToolCount: TOOL_SPECS.length - missingSourceTools.length,
    mixedSnapshot: lineage.mixed,
    unknownTableLineage: lineage.unknownTables,
    schemaBaselineAt: baseline.at,
    schemaChanges: diffSchema(baseline.snapshot, schemaSnapshot(tables)),
  };
}
