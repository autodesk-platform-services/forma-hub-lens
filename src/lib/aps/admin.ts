import "server-only";

import { getDb } from "../db";
import { env } from "../env";
import type { Session } from "./auth";
import { apsPaginate } from "./client";

/**
 * Forma Hub Admin API.
 *
 * GET /construction/admin/v1/accounts/:accountId/projects returns every project in
 * the hub when the caller is a hub admin or executive, which is exactly the
 * cross-project frame this console needs. Scope: account:read.
 */

const PROJECT_FIELDS = [
  "name",
  "status",
  "type",
  "platform",
  "jobNumber",
  "memberCount",
  "sheetCount",
  "companyCount",
  "createdAt",
  "updatedAt",
  "lastSignIn",
  "products",
  "city",
  "country",
  "startDate",
  "endDate",
].join(",");

export type AdminProject = {
  id: string;
  name?: string;
  status?: string;
  type?: string;
  platform?: string;
  jobNumber?: string;
  memberCount?: number;
  sheetCount?: number;
  companyCount?: number;
  createdAt?: string;
  updatedAt?: string;
  lastSignIn?: string;
  products?: Array<{ key?: string; name?: string; status?: string }>;
};

export async function fetchProjects(session: Session): Promise<AdminProject[]> {
  return apsPaginate<AdminProject>(
    session,
    `/construction/admin/v1/accounts/${env.hubId}/projects`,
    {
      regional: true,
      limit: 100,
      searchParams: { fields: PROJECT_FIELDS },
    },
  );
}

export type SyncResult = { count: number; syncedAt: number };

export async function syncProjects(session: Session): Promise<SyncResult> {
  const projects = await fetchProjects(session);
  const db = getDb();
  const ids = new Set<string>();
  for (const project of projects) {
    if (!project || typeof project.id !== "string" || !project.id.trim() || ids.has(project.id)) {
      throw new Error("Autodesk returned an incomplete or duplicate project list; the cached inventory was not changed.");
    }
    ids.add(project.id);
  }
  // The timestamp doubles as this sync's generation marker. Make it distinct
  // even when two syncs happen within one millisecond.
  const previous = db.prepare("SELECT MAX(synced_at) AS latest FROM projects")
    .get() as { latest: number | null };
  const syncedAt = Math.max(Date.now(), Number(previous.latest ?? 0) + 1);

  const upsert = db.prepare(
    `INSERT INTO projects (id, name, status, type, platform, job_number, member_count,
                           sheet_count, company_count, created_at, updated_at, last_sign_in,
                           raw, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, status = excluded.status, type = excluded.type,
       platform = excluded.platform, job_number = excluded.job_number,
       member_count = excluded.member_count, sheet_count = excluded.sheet_count,
       company_count = excluded.company_count, created_at = excluded.created_at,
       updated_at = excluded.updated_at, last_sign_in = excluded.last_sign_in,
       raw = excluded.raw, synced_at = excluded.synced_at`,
  );

  db.exec("BEGIN");
  try {
    for (const project of projects) {
      upsert.run(
        project.id,
        project.name ?? null,
        project.status ?? null,
        project.type ?? null,
        project.platform ?? null,
        project.jobNumber ?? null,
        project.memberCount ?? null,
        project.sheetCount ?? null,
        project.companyCount ?? null,
        project.createdAt ?? null,
        project.updatedAt ?? null,
        project.lastSignIn ?? null,
        JSON.stringify(project),
        syncedAt,
      );
    }
    // `fetchProjects` only returns after a complete pagination pass. Remove
    // records no longer in that response so action pickers cannot use stale IDs.
    db.prepare("DELETE FROM projects WHERE synced_at <> ?").run(syncedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { count: projects.length, syncedAt };
}

export type CachedProject = {
  id: string;
  name: string;
  status: string | null;
  type: string | null;
  platform: string | null;
  jobNumber: string | null;
  memberCount: number | null;
  sheetCount: number | null;
  companyCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSignIn: string | null;
  syncedAt: number;
};

export function cachedProjects(): CachedProject[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, status, type, platform, job_number, member_count, sheet_count,
              company_count, created_at, updated_at, last_sign_in, synced_at
       FROM projects ORDER BY name COLLATE NOCASE`,
    )
    .all() as Array<Record<string, string | number | null>>;

  return rows.map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? "(unnamed project)",
    status: row.status as string | null,
    type: row.type as string | null,
    platform: row.platform as string | null,
    jobNumber: row.job_number as string | null,
    memberCount: row.member_count as number | null,
    sheetCount: row.sheet_count as number | null,
    companyCount: row.company_count as number | null,
    createdAt: row.created_at as string | null,
    updatedAt: row.updated_at as string | null,
    lastSignIn: row.last_sign_in as string | null,
    syncedAt: Number(row.synced_at),
  }));
}

export function projectNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const project of cachedProjects()) map.set(project.id.toLowerCase(), project.name);
  return map;
}

/**
 * Reflects an archive in the local project mirror straight away, so the UI
 * updates without waiting for the next full Sync projects.
 */
export function markProjectsArchived(projectIds: string[]): void {
  if (projectIds.length === 0) return;
  const db = getDb();
  const update = db.prepare("UPDATE projects SET status = 'archived' WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const id of projectIds) update.run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
