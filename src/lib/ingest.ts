import "server-only";

import { createHash } from "node:crypto";
import { getDb } from "./db";
import { parseCsvRecords } from "./csv";
import {
  isActivityFile,
  mapColumns,
  parseTimestamp,
  serviceFromFileName,
  type Canonical,
  type Mapping,
} from "./activitySchema";
import type { Session } from "./aps/auth";
import { requireLiveApsSession } from "./aps/client";
import { listExtractFiles, signedUrlFor } from "./aps/dataConnector";

/**
 * Turns a completed Data Connector extract into rows in the local `activities`
 * table. Column mapping lives in ./activitySchema.
 */

export type IngestSummary = {
  jobId: string;
  files: Array<{ name: string; rows: number; skipped: boolean; failed?: boolean; reason?: string }>;
  totalRows: number;
};

export async function ingestJob(session: Session, jobId: string): Promise<IngestSummary> {
  requireLiveApsSession(session);
  const db = getDb();
  const summary: IngestSummary = { jobId, files: [], totalRows: 0 };

  const recordFile = db.prepare(
    `INSERT INTO extract_files (job_id, name, size, rows, skipped, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id, name) DO UPDATE SET
       size = excluded.size, rows = excluded.rows,
       skipped = excluded.skipped, ingested_at = excluded.ingested_at`,
  );

  try {
    const files = await listExtractFiles(session, jobId);
    const failures: string[] = [];
    let successfulFiles = 0;
    for (const file of files) {
      const size = Number(file.size) || 0;

      if (!isActivityFile(file.name)) {
        recordFile.run(jobId, file.name, size, 0, 1, Date.now());
        summary.files.push({
          name: file.name,
          rows: 0,
          skipped: true,
          reason: "not an activity CSV",
        });
        continue;
      }

      try {
        const rows = await ingestFile(session, jobId, file.name);
        recordFile.run(jobId, file.name, size, rows, 0, Date.now());
        summary.files.push({ name: file.name, rows, skipped: false });
        summary.totalRows += rows;
        successfulFiles++;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        recordFile.run(jobId, file.name, size, 0, 1, Date.now());
        summary.files.push({ name: file.name, rows: 0, skipped: true, failed: true, reason });
        failures.push(`${file.name}: ${reason}`);
      }
    }

    db.prepare(
      `UPDATE extract_jobs
       SET ingested_at = CASE WHEN ? THEN ? ELSE ingested_at END,
           ingest_error = ?,
           activity_rows = (SELECT COUNT(*) FROM activities WHERE job_id = ?)
       WHERE job_id = ?`,
    ).run(successfulFiles > 0 ? 1 : 0, Date.now(), failures.length ? failures.join("; ").slice(0, 2000) : null, jobId, jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare("UPDATE extract_jobs SET ingest_error = ? WHERE job_id = ?").run(message, jobId);
    throw error;
  }

  return summary;
}

const MAX_ROWS_PER_ACTIVITY_FILE = 400_000;

async function ingestFile(session: Session, jobId: string, name: string): Promise<number> {
  const { signedUrl } = await signedUrlFor(session, jobId, name);
  const res = await fetch(signedUrl, { cache: "no-store" });
  if (!res.ok || !res.body) {
    throw new Error(`Downloading ${name} failed with HTTP ${res.status}`);
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO activities
       (job_id, source_file, fingerprint, occurred_ms, occurred_at, project_id,
        actor_id, actor_name, actor_email, service, action, target_type, target_name, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const reportColumn = db.prepare(
    `INSERT INTO column_report (source_file, column_name, mapped_to) VALUES (?, ?, ?)
     ON CONFLICT(source_file, column_name) DO UPDATE SET mapped_to = excluded.mapped_to`,
  );

  const fallbackService = serviceFromFileName(name);
  let mapping: Mapping | null = null;
  let inserted = 0;

  // Keep each file atomic so a download, parse, or row-limit error leaves no
  // misleading partial import for that file.
  db.exec("BEGIN");
  try {
    for await (const record of parseCsvRecords(res.body)) {
      if (inserted >= MAX_ROWS_PER_ACTIVITY_FILE) {
        throw new Error(`more than ${MAX_ROWS_PER_ACTIVITY_FILE.toLocaleString()} activity rows; this file was not imported`);
      }
      if (!mapping) {
        mapping = mapColumns(Object.keys(record));
        const reverse = new Map<string, string>();
        for (const [canonical, header] of Object.entries(mapping)) {
          if (header && canonical !== "idColumn") reverse.set(header, canonical);
        }
        for (const column of Object.keys(record)) {
          reportColumn.run(name, column, reverse.get(column) ?? null);
        }
      }

      const value = (canonical: Canonical): string | null => {
        const header = mapping?.[canonical];
        if (!header) return null;
        const raw = record[header];
        return raw && raw.trim() ? raw.trim() : null;
      };

      const occurredRaw = value("occurred_at");
      const occurredMs = parseTimestamp(occurredRaw ?? undefined);
      const rawJson = JSON.stringify(record);

      const identity = mapping?.idColumn ? record[mapping.idColumn] : "";
      const fingerprint = createHash("sha1")
        .update(name)
        .update("\0")
        .update(identity || rawJson)
        .digest("hex");

      insert.run(
        jobId,
        name,
        fingerprint,
        occurredMs,
        occurredMs ? new Date(occurredMs).toISOString() : occurredRaw,
        value("project_id")?.toLowerCase() ?? null,
        value("actor_id"),
        value("actor_name"),
        value("actor_email")?.toLowerCase() ?? null,
        value("service") ?? fallbackService,
        value("action"),
        value("target_type"),
        value("target_name"),
        rawJson,
      );

      inserted++;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return inserted;
}

export type ColumnReportRow = { sourceFile: string; column: string; mappedTo: string | null };

export function columnReport(): ColumnReportRow[] {
  const rows = getDb()
    .prepare("SELECT source_file, column_name, mapped_to FROM column_report ORDER BY source_file, column_name")
    .all() as Array<Record<string, string | null>>;
  return rows.map((row) => ({
    sourceFile: row.source_file as string,
    column: row.column_name as string,
    mappedTo: row.mapped_to,
  }));
}
