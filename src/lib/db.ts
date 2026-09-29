import "server-only";

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

/**
 * Local cache for hub data.
 *
 * Data Connector extracts are asynchronous and rate limited (24 jobs per hub per
 * 24 hours), so the console never queries Autodesk to render a page. It ingests
 * each completed extract once and serves every view from here.
 *
 * Uses the Node 22+ built-in SQLite so the tool has no native dependencies.
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT,
  expires_at     INTEGER NOT NULL,
  scope          TEXT,
  user_id        TEXT,
  user_name      TEXT,
  user_email     TEXT,
  created_at     INTEGER NOT NULL,
  hub_verified_at INTEGER
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);

-- Mirror of Forma Admin API projects, refreshed on demand.
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  status        TEXT,
  type          TEXT,
  platform      TEXT,
  job_number    TEXT,
  member_count  INTEGER,
  sheet_count   INTEGER,
  company_count INTEGER,
  created_at    TEXT,
  updated_at    TEXT,
  last_sign_in  TEXT,
  raw           TEXT NOT NULL,
  synced_at     INTEGER NOT NULL
);

-- Data Connector jobs we know about, plus our own ingest bookkeeping.
CREATE TABLE IF NOT EXISTS extract_jobs (
  job_id            TEXT PRIMARY KEY,
  request_id        TEXT,
  status            TEXT,
  completion_status TEXT,
  created_at        TEXT,
  started_at        TEXT,
  completed_at      TEXT,
  start_date        TEXT,
  end_date          TEXT,
  service_groups    TEXT,
  created_by_email  TEXT,
  ingested_at       INTEGER,
  ingest_error      TEXT,
  activity_rows     INTEGER NOT NULL DEFAULT 0,
  raw               TEXT
);

CREATE TABLE IF NOT EXISTS extract_files (
  job_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  size        INTEGER,
  rows        INTEGER,
  skipped     INTEGER NOT NULL DEFAULT 0,
  ingested_at INTEGER,
  PRIMARY KEY (job_id, name)
);

-- One row per activity event, normalised across the activity CSVs.
CREATE TABLE IF NOT EXISTS activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       TEXT NOT NULL,
  source_file  TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  occurred_ms  INTEGER,
  occurred_at  TEXT,
  project_id   TEXT,
  actor_id     TEXT,
  actor_name   TEXT,
  actor_email  TEXT,
  service      TEXT,
  action       TEXT,
  target_type  TEXT,
  target_name  TEXT,
  raw          TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS activities_fingerprint ON activities (fingerprint);
CREATE INDEX IF NOT EXISTS activities_occurred ON activities (occurred_ms DESC);
CREATE INDEX IF NOT EXISTS activities_project ON activities (project_id, occurred_ms DESC);
CREATE INDEX IF NOT EXISTS activities_actor ON activities (actor_email, occurred_ms DESC);
CREATE INDEX IF NOT EXISTS activities_service ON activities (service, occurred_ms DESC);
CREATE INDEX IF NOT EXISTS activities_action ON activities (action);
CREATE INDEX IF NOT EXISTS activities_job ON activities (job_id);

-- Unrecognised columns are surfaced in the UI so mappings can be tuned.
CREATE TABLE IF NOT EXISTS column_report (
  source_file TEXT NOT NULL,
  column_name TEXT NOT NULL,
  mapped_to   TEXT,
  PRIMARY KEY (source_file, column_name)
);

-- Registry for the uploaded Data Connector extract (see dataset.ts). Created
-- here rather than lazily so a brand-new volume is queryable — the health
-- probe reads this table before anything has been uploaded.
CREATE TABLE IF NOT EXISTS dataset_tables (
  name        TEXT PRIMARY KEY,
  sql_name    TEXT NOT NULL,
  columns     TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  truncated   INTEGER NOT NULL DEFAULT 0,
  uploaded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_uploads (
  id          TEXT PRIMARY KEY,
  file_name   TEXT,
  size        INTEGER,
  tables      INTEGER,
  rows        INTEGER,
  uploaded_at INTEGER NOT NULL,
  notes       TEXT
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __formaDb: DatabaseSync | undefined;
}

/**
 * Columns added after the first release. CREATE TABLE IF NOT EXISTS won't add
 * them to a database that already exists, so bring those forward explicitly.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: "sessions", column: "hub_verified_at", definition: "INTEGER" },
  { table: "dataset_tables", column: "truncated", definition: "INTEGER NOT NULL DEFAULT 0" },
];

function migrate(db: DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
    if (existing.length === 0) continue; // table not created yet; SCHEMA covers it
    if (existing.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  }
}

function open(): DatabaseSync {
  const dir = path.resolve(process.cwd(), env.dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dir, "forma-console.sqlite"));
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalThis.__formaDb) globalThis.__formaDb = open();
  return globalThis.__formaDb;
}

/** Close the process-local SQLite connection, including its WAL file handles. */
export function closeDb(): void {
  if (!globalThis.__formaDb) return;
  globalThis.__formaDb.close();
  globalThis.__formaDb = undefined;
}
