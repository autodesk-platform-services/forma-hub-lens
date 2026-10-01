import "server-only";

import { Unzip, UnzipInflate } from "fflate";
import { getDb } from "./db";
import { env } from "./env";
import { parseCsv } from "./csv";

/**
 * Storage for an uploaded Data Connector CSV extract.
 *
 * The Power BI templates load each CSV as `SourceFolder & "\<table>.csv"`, so the
 * file basename *is* the table name (`admin_projects.csv` -> `admin_projects`).
 * Every dashboard spec addresses data by that name.
 *
 * Each CSV becomes its own SQLite table (`ds_<name>`) with TEXT columns, which
 * keeps aggregation in SQL instead of in JS. Identifiers are sanitised on write
 * and every identifier used in a query is resolved through the registry, so no
 * caller-supplied string is ever interpolated raw.
 */

function sanitise(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "col";
}

export type DatasetTable = {
  name: string;
  sqlName: string;
  columns: Array<{ name: string; sqlName: string }>;
  rowCount: number;
  truncated: boolean;
  uploadedAt: number;
};

export function listTables(): DatasetTable[] {
  const rows = getDb()
    .prepare("SELECT name, sql_name, columns, row_count, truncated, uploaded_at FROM dataset_tables ORDER BY name")
    .all() as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    name: row.name as string,
    sqlName: row.sql_name as string,
    columns: JSON.parse(row.columns as string),
    rowCount: Number(row.row_count),
    truncated: Boolean(row.truncated),
    uploadedAt: Number(row.uploaded_at),
  }));
}

export function tableMap(): Map<string, DatasetTable> {
  const map = new Map<string, DatasetTable>();
  for (const table of listTables()) map.set(table.name, table);
  return map;
}

export function getTable(name: string): DatasetTable | undefined {
  const row = getDb()
    .prepare("SELECT name, sql_name, columns, row_count, truncated, uploaded_at FROM dataset_tables WHERE name = ?")
    .get(name) as Record<string, string | number> | undefined;
  if (!row) return undefined;
  return {
    name: row.name as string,
    sqlName: row.sql_name as string,
    columns: JSON.parse(row.columns as string),
    rowCount: Number(row.row_count),
    truncated: Boolean(row.truncated),
    uploadedAt: Number(row.uploaded_at),
  };
}

/** Resolves a logical column to its stored SQL identifier, or undefined. */
export function resolveColumn(table: DatasetTable, column: string): string | undefined {
  const target = sanitise(column);
  const hit =
    table.columns.find((c) => c.name === column) ??
    table.columns.find((c) => c.sqlName === target) ??
    table.columns.find((c) => sanitise(c.name) === target);
  return hit?.sqlName;
}

export type UploadSummary = {
  uploadId: string;
  fileName: string;
  provenance: "unverified_user_upload" | "aps_data_connector_job";
  tables: Array<{ name: string; rows: number; columns: number; truncated: boolean }>;
  truncatedTables: string[];
  skipped: Array<{ name: string; reason: string }>;
  totalRows: number;
};

export type TrustedProjectScope = {
  kind: "all_projects" | "selected_projects";
  projectIds: string[];
  projectStatus: "all" | "active" | "archived" | "unknown";
};

export type TrustedReportingManifest = {
  provenance: "aps_data_connector_job";
  hubId: string;
  jobId: string;
  requestId: string;
  jobCompletedAt: string | null;
  projectScope: TrustedProjectScope;
  serviceGroups: string[];
  expectedFiles: string[];
  skippedFiles: string[];
};

export type TrustedTableSource = Omit<TrustedReportingManifest, "expectedFiles" | "skippedFiles"> & {
  tableName: string;
  sourceFile: string;
  sourceBytes: number;
  rowCount: number;
  truncated: boolean;
  ingestedAt: number;
  uploadId: string;
};

export type TrustedReportingUpload = TrustedReportingManifest & {
  uploadId: string;
  ingestedAt: number;
  totalRows: number;
  totalBytes: number;
  tables: Array<{ name: string; rows: number; columns: number; truncated: boolean; sourceFile: string; sourceBytes: number }>;
};

function ensureTrustedSources(): void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS dataset_table_sources (
    table_name TEXT PRIMARY KEY,
    upload_id TEXT NOT NULL,
    hub_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    project_scope TEXT NOT NULL,
    service_groups TEXT NOT NULL,
    job_completed_at TEXT,
    source_file TEXT NOT NULL,
    source_bytes INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    truncated INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL
  )`);
}

const MAX_ROWS_PER_TABLE = 400_000;

export const MAX_DATASET_ARCHIVE_BYTES = 256 * 1024 * 1024;
const ZIP_LIMITS = {
  maxArchiveBytes: MAX_DATASET_ARCHIVE_BYTES,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxEntries: 500,
} as const;

type ZipLimits = typeof ZIP_LIMITS | {
  maxArchiveBytes: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
};

/** Count actual inflated bytes, not just ZIP header sizes, before modifying any table. */
export function validateZipSafety(
  bytes: Uint8Array,
  limits: ZipLimits = ZIP_LIMITS,
): Array<{ path: string; data: Uint8Array }> {
  if (bytes.length > limits.maxArchiveBytes) {
    throw new Error(`ZIP archive exceeds the ${Math.floor(limits.maxArchiveBytes / 1024 / 1024)} MB upload limit.`);
  }
  let entryCount = 0;
  let totalBytes = 0;
  let completed = 0;
  const entries: Array<{ path: string; data: Uint8Array }> = [];
  const unzip = new Unzip((file) => {
    if (++entryCount > limits.maxEntries) {
      throw new Error(`ZIP archive contains more than ${limits.maxEntries} entries.`);
    }
    if (file.originalSize !== undefined && file.originalSize > limits.maxEntryBytes) {
      throw new Error(`ZIP entry ${file.name} exceeds the uncompressed per-file limit.`);
    }
    let entryBytes = 0;
    const capture = /\.csv$/i.test(file.name) && !file.name.endsWith("/");
    const chunks: Uint8Array[] = [];
    file.ondata = (error, data, final) => {
      if (error) throw error;
      entryBytes += data?.length ?? 0;
      totalBytes += data?.length ?? 0;
      if (entryBytes > limits.maxEntryBytes) {
        throw new Error(`ZIP entry ${file.name} exceeds the uncompressed per-file limit.`);
      }
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error("ZIP archive exceeds the total uncompressed data limit.");
      }
      if (capture && data?.length) chunks.push(data);
      if (final) {
        completed++;
        const value = new Uint8Array(capture ? entryBytes : 0);
        if (capture) {
          let offset = 0;
          for (const chunk of chunks) {
            value.set(chunk, offset);
            offset += chunk.length;
          }
        }
        entries.push({ path: file.name, data: value });
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Short compressed chunks prevent one inflater callback from expanding an
  // arbitrarily large part of a hostile archive before the counters run.
  for (let offset = 0; offset < bytes.length; offset += 8 * 1024) {
    unzip.push(bytes.subarray(offset, offset + 8 * 1024), offset + 8 * 1024 >= bytes.length);
  }
  if (entryCount === 0 || completed !== entryCount) {
    throw new Error("ZIP archive is empty or incomplete.");
  }
  return entries;
}

export async function ingestZip(
  fileName: string,
  bytes: Uint8Array,
): Promise<UploadSummary> {
  const db = getDb();

  let entries: Array<{ path: string; data: Uint8Array }>;
  try {
    entries = validateZipSafety(bytes);
  } catch (error) {
    throw new Error(
      `Could not read "${fileName}" as a ZIP archive: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const summary: UploadSummary = {
    uploadId: crypto.randomUUID(),
    fileName,
    provenance: "unverified_user_upload",
    tables: [],
    truncatedTables: [],
    skipped: [],
    totalRows: 0,
  };

  for (const { path: entryPath, data } of entries) {
    const base = entryPath.split("/").pop() ?? entryPath;
    if (entryPath.endsWith("/")) continue;
    if (base.startsWith(".") || base.startsWith("__MACOSX")) continue;
    if (!/\.csv$/i.test(base)) {
      summary.skipped.push({ name: base, reason: "not a .csv" });
      continue;
    }

    const tableName = base.replace(/\.csv$/i, "");
    try {
      const rows = await loadCsvTable(tableName, data);
      summary.tables.push(rows);
      if (rows.truncated) summary.truncatedTables.push(rows.name);
      summary.totalRows += rows.rows;
    } catch (error) {
      summary.skipped.push({
        name: base,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  db.prepare(
    `INSERT INTO dataset_uploads (id, file_name, size, tables, rows, uploaded_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    summary.uploadId,
    fileName,
    bytes.length,
    summary.tables.length,
    summary.totalRows,
    Date.now(),
    JSON.stringify({
      provenance: summary.provenance,
      skipped: summary.skipped.slice(0, 40),
      truncatedTables: summary.truncatedTables,
    }),
  );

  return summary;
}

type StagedCsvTable = {
  name: string;
  sqlName: string;
  stageName: string;
  columns: Array<{ name: string; sqlName: string }>;
  rows: number;
  truncated: boolean;
  sourceFile: string;
  sourceBytes: number;
};

async function stageCsvTable(
  tableName: string,
  data: Uint8Array,
  sourceFile = `${tableName}.csv`,
): Promise<StagedCsvTable> {
  const db = getDb();
  const sqlName = "ds_" + sanitise(tableName);
  const collision = db.prepare("SELECT name FROM dataset_tables WHERE sql_name = ? AND name <> ?")
    .get(sqlName, tableName) as { name: string } | undefined;
  if (collision) {
    throw new Error(`Table name collides with an existing source table (${collision.name}).`);
  }
  const stageName = `${sqlName}_stage_${crypto.randomUUID().replace(/-/g, "")}`;

  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
      } else {
        controller.enqueue(data.subarray(offset, offset + 64 * 1024));
        offset += 64 * 1024;
      }
    },
  });

  let columns: Array<{ name: string; sqlName: string }> | null = null;
  let insert: ReturnType<typeof db.prepare> | null = null;
  let count = 0;
  let truncated = false;
  let pending = 0;
  let began = false;

  try {
    for await (const row of parseCsv(stream)) {
      if (!columns) {
        const header = row.map((name, index) =>
          (index === 0 ? name.replace(/^﻿/, "") : name).trim());
        if (!header.length || header.every((name) => !name)) throw new Error("no header row");
        const seen = new Set<string>();
        columns = header.map((name) => {
          let sql = sanitise(name);
          while (seen.has(sql)) sql += "_";
          seen.add(sql);
          return { name, sqlName: sql };
        });

        db.exec(
          `CREATE TABLE "${stageName}" (${columns.map((c) => `"${c.sqlName}" TEXT`).join(", ")})`,
        );
        insert = db.prepare(
          `INSERT INTO "${stageName}" (${columns.map((c) => `"${c.sqlName}"`).join(", ")})
           VALUES (${columns.map(() => "?").join(", ")})`,
        );
        db.exec("BEGIN");
        began = true;
        continue;
      }

      if (row.length === 1 && row[0] === "") continue;

      if (count >= MAX_ROWS_PER_TABLE) {
        truncated = true;
        break;
      }
      const values = columns.map((_, index) => {
        const v = row[index];
        return v === undefined || v === "" ? null : v;
      });
      insert!.run(...values);
      count++;

      if (++pending >= 2_000) {
        db.exec("COMMIT");
        db.exec("BEGIN");
        pending = 0;
      }
    }
    if (began) {
      db.exec("COMMIT");
      began = false;
    }
  } catch (error) {
    if (began) db.exec("ROLLBACK");
    db.exec(`DROP TABLE IF EXISTS "${stageName}"`);
    throw error;
  }

  if (!columns) throw new Error("empty file");
  return { name: tableName, sqlName, stageName, columns, rows: count, truncated,
    sourceFile, sourceBytes: data.length };
}

function swapStagedTables(
  staged: StagedCsvTable[],
  trusted?: { manifest: TrustedReportingManifest; uploadId: string; ingestedAt: number; totalBytes: number },
): void {
  ensureTrustedSources();
  const db = getDb();
  let swapping = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    swapping = true;
    const updateRegistry = db.prepare(
      `INSERT INTO dataset_tables (name, sql_name, columns, row_count, truncated, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         sql_name = excluded.sql_name, columns = excluded.columns,
         row_count = excluded.row_count, truncated = excluded.truncated,
         uploaded_at = excluded.uploaded_at`,
    );
    const deleteSource = db.prepare("DELETE FROM dataset_table_sources WHERE table_name = ?");
    const insertSource = db.prepare(`INSERT INTO dataset_table_sources
      (table_name, upload_id, hub_id, job_id, request_id, project_scope, service_groups,
       job_completed_at, source_file, source_bytes, row_count, truncated, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const table of staged) {
      db.exec(`DROP TABLE IF EXISTS "${table.sqlName}"`);
      db.exec(`ALTER TABLE "${table.stageName}" RENAME TO "${table.sqlName}"`);
      for (const fk of ["project_id", "bim360_project_id", "company_id", "user_id", "created_by"]) {
        const hit = table.columns.find((c) => c.sqlName === fk);
        if (hit) db.exec(`CREATE INDEX IF NOT EXISTS "${table.sqlName}_${fk}" ON "${table.sqlName}" ("${hit.sqlName}")`);
      }
      updateRegistry.run(table.name, table.sqlName, JSON.stringify(table.columns),
        table.rows, table.truncated ? 1 : 0, trusted?.ingestedAt ?? Date.now());
      deleteSource.run(table.name);
      if (trusted) {
        const manifest = trusted.manifest;
        insertSource.run(table.name, trusted.uploadId, manifest.hubId, manifest.jobId,
          manifest.requestId, JSON.stringify(manifest.projectScope), JSON.stringify(manifest.serviceGroups),
          manifest.jobCompletedAt, table.sourceFile, table.sourceBytes, table.rows,
          table.truncated ? 1 : 0, trusted.ingestedAt);
      }
    }
    if (trusted) {
      const totalRows = staged.reduce((sum, table) => sum + table.rows, 0);
      db.prepare(`INSERT INTO dataset_uploads (id, file_name, size, tables, rows, uploaded_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        trusted.uploadId, `APS job ${trusted.manifest.jobId}`, trusted.totalBytes,
        staged.length, totalRows, trusted.ingestedAt,
        JSON.stringify({ ...trusted.manifest, tables: staged.map((table) => ({
          name: table.name, rows: table.rows, columns: table.columns.length,
          truncated: table.truncated, sourceFile: table.sourceFile, sourceBytes: table.sourceBytes,
        })) }),
      );
    }
    db.exec("COMMIT");
    swapping = false;
  } catch (error) {
    if (swapping) db.exec("ROLLBACK");
    throw error;
  }
}

async function loadCsvTable(
  tableName: string,
  data: Uint8Array,
): Promise<{ name: string; rows: number; columns: number; truncated: boolean }> {
  const table = await stageCsvTable(tableName, data);
  try {
    swapStagedTables([table]);
  } finally {
    getDb().exec(`DROP TABLE IF EXISTS "${table.stageName}"`);
  }
  return { name: table.name, rows: table.rows, columns: table.columns.length, truncated: table.truncated };
}

function trustedTableName(fileName: string): string {
  if (!fileName || fileName.length > 256 || fileName.includes("\\") ||
      fileName.split("/").some((part) => !part || part === "." || part === ".." ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part))) {
    throw new Error("APS returned an invalid reporting file name.");
  }
  const base = fileName.split("/").pop()!;
  if (!/\.csv$/i.test(base)) throw new Error("Reporting ingest accepts CSV files only.");
  return base.slice(0, -4);
}

/** All files stage first; table swaps, lineage, and upload record commit together. */
export async function ingestTrustedCsvFiles(
  manifest: TrustedReportingManifest,
  files: AsyncIterable<{ name: string; bytes: Uint8Array }>,
): Promise<UploadSummary> {
  if (manifest.provenance !== "aps_data_connector_job" || manifest.hubId !== env.hubId || !manifest.jobId ||
      !manifest.requestId || !manifest.serviceGroups.length || !manifest.expectedFiles.length ||
      manifest.expectedFiles.length > 500 ||
      !["all_projects", "selected_projects"].includes(manifest.projectScope.kind) ||
      !["all", "active", "archived", "unknown"].includes(manifest.projectScope.projectStatus)) {
    throw new Error("Trusted reporting manifest is incomplete.");
  }
  const expected = new Set(manifest.expectedFiles);
  const sqlNames = new Set<string>();
  for (const name of expected) {
    const sqlName = "ds_" + sanitise(trustedTableName(name));
    if (sqlNames.has(sqlName)) throw new Error("APS reporting files have colliding table names.");
    sqlNames.add(sqlName);
  }
  if (expected.size !== manifest.expectedFiles.length) throw new Error("APS reporting file listing contains duplicates.");
  const stages: StagedCsvTable[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  try {
    for await (const file of files) {
      if (!expected.has(file.name) || seen.has(file.name)) {
        throw new Error("Downloaded reporting file is not in the APS job listing or is duplicated.");
      }
      seen.add(file.name);
      if (file.bytes.length > 128 * 1024 * 1024) throw new Error("A reporting CSV exceeds 128 MB.");
      totalBytes += file.bytes.length;
      if (totalBytes > 512 * 1024 * 1024) throw new Error("Reporting CSVs exceed 512 MB in total.");
      stages.push(await stageCsvTable(trustedTableName(file.name), file.bytes, file.name));
    }
    if (seen.size !== expected.size) throw new Error("The APS reporting file listing was not fully downloaded.");
    const uploadId = crypto.randomUUID();
    const ingestedAt = Date.now();
    swapStagedTables(stages, { manifest, uploadId, ingestedAt, totalBytes });
    return {
      uploadId, fileName: `APS job ${manifest.jobId}`, provenance: "aps_data_connector_job",
      tables: stages.map((table) => ({ name: table.name, rows: table.rows,
        columns: table.columns.length, truncated: table.truncated })),
      truncatedTables: stages.filter((table) => table.truncated).map((table) => table.name),
      skipped: manifest.skippedFiles.map((name) => ({ name, reason: "not a CSV" })),
      totalRows: stages.reduce((sum, table) => sum + table.rows, 0),
    };
  } finally {
    for (const table of stages) getDb().exec(`DROP TABLE IF EXISTS "${table.stageName}"`);
  }
}

/** Current table provenance; null means user upload or no verified APS source. */
export function getTrustedTableSource(tableName: string): TrustedTableSource | null {
  ensureTrustedSources();
  const row = getDb().prepare(`SELECT s.*, t.name AS current_name FROM dataset_table_sources s
    JOIN dataset_tables t ON t.name = s.table_name WHERE s.table_name = ?`).get(tableName) as
    Record<string, string | number | null> | undefined;
  if (!row || row.hub_id !== env.hubId) return null;
  return {
    provenance: "aps_data_connector_job", tableName: row.table_name as string,
    hubId: row.hub_id as string, jobId: row.job_id as string,
    requestId: row.request_id as string,
    projectScope: JSON.parse(row.project_scope as string) as TrustedProjectScope,
    serviceGroups: JSON.parse(row.service_groups as string) as string[],
    jobCompletedAt: row.job_completed_at as string | null,
    sourceFile: row.source_file as string, sourceBytes: Number(row.source_bytes),
    rowCount: Number(row.row_count), truncated: Boolean(row.truncated),
    ingestedAt: Number(row.ingested_at), uploadId: row.upload_id as string,
  };
}

/** Historical successful APS reporting ingests; current table lineage may be newer. */
export function trustedReportingUploads(limit = 30): TrustedReportingUpload[] {
  const rows = getDb().prepare(`SELECT id, uploaded_at, rows, size, notes FROM dataset_uploads
    ORDER BY uploaded_at DESC LIMIT 500`).all() as Array<{
    id: string; uploaded_at: number; rows: number; size: number; notes: string | null;
  }>;
  const uploads: TrustedReportingUpload[] = [];
  for (const row of rows) {
    try {
      const notes = JSON.parse(row.notes ?? "{}") as TrustedReportingManifest & { tables?: TrustedReportingUpload["tables"] };
      if (notes.provenance !== "aps_data_connector_job" || notes.hubId !== env.hubId ||
          !notes.jobId || !notes.requestId || !Array.isArray(notes.tables)) continue;
      uploads.push({ ...notes, uploadId: row.id, ingestedAt: row.uploaded_at,
        totalRows: row.rows, totalBytes: row.size, tables: notes.tables });
      if (uploads.length >= Math.min(Math.max(1, limit), 500)) break;
    } catch { /* Ignore an unreadable historical note. */ }
  }
  return uploads;
}

export function clearDataset(): number {
  const db = getDb();
  ensureTrustedSources();
  const tables = listTables();
  for (const table of tables) db.exec(`DROP TABLE IF EXISTS "${table.sqlName}"`);
  db.exec("DELETE FROM dataset_tables");
  db.exec("DELETE FROM dataset_uploads");
  db.exec("DELETE FROM dataset_table_sources");
  return tables.length;
}

export type UploadRecord = {
  id: string;
  fileName: string;
  size: number;
  tables: number;
  rows: number;
  uploadedAt: number;
};

export function recentUploads(limit = 5): UploadRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, file_name, size, tables, rows, uploaded_at
       FROM dataset_uploads ORDER BY uploaded_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    id: row.id as string,
    fileName: (row.file_name as string) ?? "(unnamed)",
    size: Number(row.size ?? 0),
    tables: Number(row.tables ?? 0),
    rows: Number(row.rows ?? 0),
    uploadedAt: Number(row.uploaded_at),
  }));
}
