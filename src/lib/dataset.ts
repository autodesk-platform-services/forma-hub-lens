import "server-only";

import { unzipSync } from "fflate";
import { getDb } from "./db";
import { parseCsvRecords } from "./csv";

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
  uploadedAt: number;
};

export function listTables(): DatasetTable[] {
  const rows = getDb()
    .prepare("SELECT name, sql_name, columns, row_count, uploaded_at FROM dataset_tables ORDER BY name")
    .all() as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    name: row.name as string,
    sqlName: row.sql_name as string,
    columns: JSON.parse(row.columns as string),
    rowCount: Number(row.row_count),
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
    .prepare("SELECT name, sql_name, columns, row_count, uploaded_at FROM dataset_tables WHERE name = ?")
    .get(name) as Record<string, string | number> | undefined;
  if (!row) return undefined;
  return {
    name: row.name as string,
    sqlName: row.sql_name as string,
    columns: JSON.parse(row.columns as string),
    rowCount: Number(row.row_count),
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
  tables: Array<{ name: string; rows: number; columns: number }>;
  skipped: Array<{ name: string; reason: string }>;
  totalRows: number;
};

const MAX_ROWS_PER_TABLE = 400_000;

export async function ingestZip(
  fileName: string,
  bytes: Uint8Array,
): Promise<UploadSummary> {
  const db = getDb();

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
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
    tables: [],
    skipped: [],
    totalRows: 0,
  };

  for (const [entryPath, data] of Object.entries(entries)) {
    const base = entryPath.split("/").pop() ?? entryPath;
    if (entryPath.endsWith("/") || data.length === 0) continue;
    if (base.startsWith(".") || base.startsWith("__MACOSX")) continue;
    if (!/\.csv$/i.test(base)) {
      summary.skipped.push({ name: base, reason: "not a .csv" });
      continue;
    }

    const tableName = base.replace(/\.csv$/i, "");
    try {
      const rows = await loadCsvTable(tableName, data);
      summary.tables.push(rows);
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
    summary.skipped.length ? JSON.stringify(summary.skipped.slice(0, 40)) : null,
  );

  return summary;
}

async function loadCsvTable(
  tableName: string,
  data: Uint8Array,
): Promise<{ name: string; rows: number; columns: number }> {
  const db = getDb();
  const sqlName = "ds_" + sanitise(tableName);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  let columns: Array<{ name: string; sqlName: string }> | null = null;
  let insert: ReturnType<typeof db.prepare> | null = null;
  let count = 0;
  let pending = 0;
  let began = false;

  try {
    for await (const record of parseCsvRecords(stream)) {
      if (!columns) {
        const seen = new Set<string>();
        columns = Object.keys(record).map((name) => {
          let sql = sanitise(name);
          while (seen.has(sql)) sql += "_";
          seen.add(sql);
          return { name, sqlName: sql };
        });
        if (columns.length === 0) throw new Error("no header row");

        db.exec(`DROP TABLE IF EXISTS "${sqlName}"`);
        db.exec(
          `CREATE TABLE "${sqlName}" (${columns.map((c) => `"${c.sqlName}" TEXT`).join(", ")})`,
        );
        insert = db.prepare(
          `INSERT INTO "${sqlName}" (${columns.map((c) => `"${c.sqlName}"`).join(", ")})
           VALUES (${columns.map(() => "?").join(", ")})`,
        );
        db.exec("BEGIN");
        began = true;
      }

      if (count >= MAX_ROWS_PER_TABLE) break;
      const values = columns.map((c) => {
        const v = record[c.name];
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
    throw error;
  }

  if (!columns) throw new Error("empty file");

  // Index the columns dashboards join on, when present.
  for (const fk of ["project_id", "bim360_project_id", "company_id", "user_id", "created_by"]) {
    const hit = columns.find((c) => c.sqlName === fk);
    if (hit) {
      db.exec(
        `CREATE INDEX IF NOT EXISTS "${sqlName}_${fk}" ON "${sqlName}" ("${hit.sqlName}")`,
      );
    }
  }

  db.prepare(
    `INSERT INTO dataset_tables (name, sql_name, columns, row_count, uploaded_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       sql_name = excluded.sql_name, columns = excluded.columns,
       row_count = excluded.row_count, uploaded_at = excluded.uploaded_at`,
  ).run(tableName, sqlName, JSON.stringify(columns), count, Date.now());

  return { name: tableName, rows: count, columns: columns.length };
}

export function clearDataset(): number {
  const db = getDb();
  const tables = listTables();
  for (const table of tables) db.exec(`DROP TABLE IF EXISTS "${table.sqlName}"`);
  db.exec("DELETE FROM dataset_tables");
  db.exec("DELETE FROM dataset_uploads");
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
