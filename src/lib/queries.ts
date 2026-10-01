import "server-only";

import { getDb } from "./db";
import { projectNameMap } from "./aps/admin";
import { resolveUserIdentities } from "./entityProfiles";
import { actionLabel, actorDisplay, serviceLabel } from "./activityPresentation";

export type ActivityFilters = {
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive, end of day)
  projectIds?: string[];
  services?: string[];
  actions?: string[];
  actor?: string; // substring match on name or email
  search?: string; // substring match on target name
};

type Where = { sql: string; params: Array<string | number> };

function containsPattern(value: string): string {
  // Treat user-entered % and _ as text rather than SQLite LIKE wildcards.
  return `%${value.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

function buildWhere(filters: ActivityFilters): Where {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.from) {
    const ms = Date.parse(`${filters.from}T00:00:00.000Z`);
    if (Number.isFinite(ms)) {
      clauses.push("occurred_ms >= ?");
      params.push(ms);
    }
  }
  if (filters.to) {
    const ms = Date.parse(`${filters.to}T23:59:59.999Z`);
    if (Number.isFinite(ms)) {
      clauses.push("occurred_ms <= ?");
      params.push(ms);
    }
  }
  if (filters.projectIds?.length) {
    clauses.push(`project_id IN (${filters.projectIds.map(() => "?").join(",")})`);
    params.push(...filters.projectIds.map((id) => id.toLowerCase()));
  }
  if (filters.services?.length) {
    clauses.push(`service IN (${filters.services.map(() => "?").join(",")})`);
    params.push(...filters.services);
  }
  if (filters.actions?.length) {
    clauses.push(`action IN (${filters.actions.map(() => "?").join(",")})`);
    params.push(...filters.actions);
  }
  if (filters.actor?.trim()) {
    clauses.push("(actor_name LIKE ? ESCAPE '!' OR actor_email LIKE ? ESCAPE '!' OR actor_id LIKE ? ESCAPE '!')");
    const like = containsPattern(filters.actor.trim());
    params.push(like, like, like);
  }
  if (filters.search?.trim()) {
    clauses.push("(target_name LIKE ? ESCAPE '!' OR action LIKE ? ESCAPE '!' OR raw LIKE ? ESCAPE '!')");
    const like = containsPattern(filters.search.trim());
    params.push(like, like, like);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export type ActivityRow = {
  id: number;
  occurredAt: string | null;
  occurredMs: number | null;
  projectId: string | null;
  projectName: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorResolvedName: string | null;
  actorResolvedId: string | null;
  service: string | null;
  action: string | null;
  targetType: string | null;
  targetName: string | null;
  raw: Record<string, string>;
};

export function listActivities(
  filters: ActivityFilters,
  page: { limit: number; offset: number },
): { rows: ActivityRow[]; total: number } {
  const db = getDb();
  const where = buildWhere(filters);
  const names = projectNameMap();

  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM activities ${where.sql}`).get(...where.params) as {
      n: number;
    }).n,
  );

  const rows = db
    .prepare(
      `SELECT id, occurred_at, occurred_ms, project_id, actor_id, actor_name, actor_email,
              service, action, target_type, target_name, raw
       FROM activities ${where.sql}
       ORDER BY occurred_ms DESC NULLS LAST, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...where.params, page.limit, page.offset) as Array<Record<string, string | number | null>>;
  const identities = resolveUserIdentities(rows.flatMap((row) =>
    [row.actor_id, row.actor_name].filter((value): value is string => typeof value === "string" && Boolean(value))));

  return {
    total,
    rows: rows.map((row) => {
      const projectId = row.project_id as string | null;
      let raw: Record<string, string> = {};
      try {
        const parsed: unknown = JSON.parse((row.raw as string) ?? "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          raw = parsed as Record<string, string>;
        } else {
          console.warn(`Activity row ${row.id} has a non-object raw payload`);
        }
      } catch {
        console.warn(`Activity row ${row.id} has invalid raw JSON`);
      }
      return {
        id: Number(row.id),
        occurredAt: row.occurred_at as string | null,
        occurredMs: row.occurred_ms === null ? null : Number(row.occurred_ms),
        projectId,
        projectName: projectId ? (names.get(projectId) ?? shortId(projectId)) : "—",
        actorId: row.actor_id as string | null,
        actorName: row.actor_name as string | null,
        actorEmail: row.actor_email as string | null,
        actorResolvedName: identities.get(String(row.actor_id ?? ""))?.name ?? identities.get(String(row.actor_name ?? ""))?.name ?? null,
        actorResolvedId: identities.get(String(row.actor_id ?? ""))?.sourceId ?? identities.get(String(row.actor_name ?? ""))?.sourceId ?? null,
        service: row.service as string | null,
        action: row.action as string | null,
        targetType: row.target_type as string | null,
        targetName: row.target_name as string | null,
        raw,
      };
    }),
  };
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export type Bucket = { key: string; label: string; count: number };

export function countByDay(filters: ActivityFilters): Array<{ day: string; count: number }> {
  const where = buildWhere(filters);
  const rows = getDb()
    .prepare(
      `SELECT date(occurred_ms / 1000, 'unixepoch') AS day, COUNT(*) AS n
       FROM activities ${where.sql}
       ${where.sql ? "AND" : "WHERE"} occurred_ms IS NOT NULL
       GROUP BY day ORDER BY day`,
    )
    .all(...where.params) as Array<{ day: string; n: number }>;
  return rows.map((row) => ({ day: row.day, count: Number(row.n) }));
}

const GROUP_COLUMNS = {
  project_id: "project_id",
  service: "service",
  action: "action",
} as const;

function groupBy(
  column: keyof typeof GROUP_COLUMNS,
  filters: ActivityFilters,
  limit: number,
): Array<{ key: string; count: number }> {
  const sqlColumn = GROUP_COLUMNS[column];
  if (!sqlColumn) throw new Error(`Unsupported group column: ${column}`);
  const where = buildWhere(filters);
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(NULLIF(${sqlColumn}, ''), '(unspecified)') AS k, COUNT(*) AS n
       FROM activities ${where.sql}
       GROUP BY k ORDER BY n DESC LIMIT ?`,
    )
    .all(...where.params, limit) as Array<{ k: string; n: number }>;
  return rows.map((row) => ({ key: row.k, count: Number(row.n) }));
}

export function topProjects(filters: ActivityFilters, limit = 12): Bucket[] {
  const names = projectNameMap();
  return groupBy("project_id", filters, limit).map((row) => ({
    key: row.key,
    label: names.get(row.key) ?? (row.key === "(unspecified)" ? row.key : shortId(row.key)),
    count: row.count,
  }));
}

export function topActors(filters: ActivityFilters, limit = 12): Bucket[] {
  const where = buildWhere(filters);
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(NULLIF(actor_name, ''), NULLIF(actor_email, ''), NULLIF(actor_id, ''), '(unknown)') AS k,
              COALESCE(NULLIF(actor_email, ''), '') AS email,
              COALESCE(NULLIF(actor_id, ''), '') AS actor_id,
              COUNT(*) AS n
       FROM activities ${where.sql}
       GROUP BY k, email, actor_id ORDER BY n DESC LIMIT ?`,
    )
    .all(...where.params, limit) as Array<{ k: string; email: string; actor_id: string; n: number }>;
  const identities = resolveUserIdentities(rows.flatMap((row) => [row.actor_id, row.k].filter(Boolean)));
  return rows.map((row) => ({
    key: row.email || row.actor_id || row.k,
    label: (() => {
      const display = actorDisplay(row.k, row.email || null, row.actor_id || null,
        identities.get(row.actor_id)?.name ?? identities.get(row.k)?.name);
      return display.label === "Unknown person" || display.label === "Unresolved actor"
        ? `${display.label} · ${shortId(row.actor_id || row.k)}` : display.label;
    })(),
    count: Number(row.n),
  }));
}

export function topServices(filters: ActivityFilters, limit = 12): Bucket[] {
  return groupBy("service", filters, limit).map((row) => ({
    key: row.key,
    label: serviceLabel(row.key),
    count: row.count,
  }));
}

export function topActions(filters: ActivityFilters, limit = 15): Bucket[] {
  return groupBy("action", filters, limit).map((row) => ({
    key: row.key,
    label: actionLabel(row.key),
    count: row.count,
  }));
}

export type Coverage = {
  totalRows: number;
  distinctProjects: number;
  distinctActors: number;
  earliest: number | null;
  latest: number | null;
  ingestedJobs: number;
};

export function coverage(): Coverage {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT project_id) AS projects,
              COUNT(DISTINCT COALESCE(actor_email, actor_id, actor_name)) AS actors,
              MIN(occurred_ms) AS earliest,
              MAX(occurred_ms) AS latest
       FROM activities`,
    )
    .get() as Record<string, number | null>;
  const jobs = db
    .prepare("SELECT COUNT(*) AS n FROM extract_jobs WHERE ingested_at IS NOT NULL")
    .get() as { n: number };

  return {
    totalRows: Number(row.total ?? 0),
    distinctProjects: Number(row.projects ?? 0),
    distinctActors: Number(row.actors ?? 0),
    earliest: row.earliest === null ? null : Number(row.earliest),
    latest: row.latest === null ? null : Number(row.latest),
    ingestedJobs: Number(jobs.n ?? 0),
  };
}

/** Per-project rollup joining the Admin API mirror with ingested activity. */
export type ProjectActivityRow = {
  projectId: string;
  name: string;
  status: string | null;
  type: string | null;
  memberCount: number | null;
  sheetCount: number | null;
  lastSignIn: string | null;
  events: number;
  actors: number;
  lastEventMs: number | null;
  services: string | null;
};

export function projectActivity(filters: ActivityFilters): ProjectActivityRow[] {
  const db = getDb();
  const where = buildWhere(filters);

  const activity = db
    .prepare(
      `SELECT project_id AS pid,
              COUNT(*) AS events,
              COUNT(DISTINCT COALESCE(actor_email, actor_id, actor_name)) AS actors,
              MAX(occurred_ms) AS last_ms,
              GROUP_CONCAT(DISTINCT service) AS services
       FROM activities ${where.sql}
       GROUP BY pid`,
    )
    .all(...where.params) as Array<Record<string, string | number | null>>;

  const byProject = new Map<string, Record<string, string | number | null>>();
  for (const row of activity) {
    if (row.pid) byProject.set(String(row.pid).toLowerCase(), row);
  }

  const projects = db
    .prepare(
      `SELECT id, name, status, type, member_count, sheet_count, last_sign_in
       FROM projects`,
    )
    .all() as Array<Record<string, string | number | null>>;

  const rows: ProjectActivityRow[] = projects.map((project) => {
    const id = String(project.id).toLowerCase();
    const stats = byProject.get(id);
    byProject.delete(id);
    return {
      projectId: project.id as string,
      name: (project.name as string) ?? "(unnamed project)",
      status: project.status as string | null,
      type: project.type as string | null,
      memberCount: project.member_count === null ? null : Number(project.member_count),
      sheetCount: project.sheet_count === null ? null : Number(project.sheet_count),
      lastSignIn: project.last_sign_in as string | null,
      events: Number(stats?.events ?? 0),
      actors: Number(stats?.actors ?? 0),
      lastEventMs: stats?.last_ms ? Number(stats.last_ms) : null,
      services: (stats?.services as string) ?? null,
    };
  });

  // Activity for projects the Admin API didn't return (e.g. deleted since extract).
  for (const [id, stats] of byProject) {
    rows.push({
      projectId: id,
      name: `${shortId(id)} (not in hub project list)`,
      status: null,
      type: null,
      memberCount: null,
      sheetCount: null,
      lastSignIn: null,
      events: Number(stats.events ?? 0),
      actors: Number(stats.actors ?? 0),
      lastEventMs: stats.last_ms ? Number(stats.last_ms) : null,
      services: (stats.services as string) ?? null,
    });
  }

  rows.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  return rows;
}

export function distinctValues(column: "service" | "action"): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT ${column} AS v FROM activities
       WHERE ${column} IS NOT NULL AND ${column} != '' ORDER BY v`,
    )
    .all() as Array<{ v: string }>;
  return rows.map((row) => row.v);
}
