import "server-only";

import { cachedProjects } from "./aps/admin";
import { getDb } from "./db";
import { getTable, resolveColumn, type DatasetTable } from "./dataset";
import type { FolderPermission } from "./permissions";

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Invalid dataset identifier");
  return `"${value}"`;
}

function column(table: DatasetTable | undefined, ...names: string[]): string | null {
  if (!table) return null;
  for (const name of names) {
    const found = resolveColumn(table, name);
    if (found) return found;
  }
  return null;
}

function cell(value: unknown): string | null {
  if (value == null) return null;
  return String(value).trim() || null;
}

export type CompanySnapshot = {
  available: boolean;
  userCount: number | null;
  projectCount: number | null;
  users: Array<{ id: string; name: string | null; email: string | null }>;
  projects: Array<{ id: string; name: string | null; people: number }>;
  sources: Array<{ name: string; uploadedAt: number; truncated: boolean }>;
};

export type LocalCompany = {
  id: string;
  name: string | null;
  status: string | null;
  trade: string | null;
  city: string | null;
  country: string | null;
  websiteUrl: string | null;
  uploadedAt: number;
  truncated: boolean;
};

export type LocalCompanyLookup =
  | { state: "found"; company: LocalCompany }
  | { state: "ambiguous" | "missing" | "unavailable"; company: null };

/** Exact source-ID lookup; duplicate company IDs are never assigned an arbitrary label. */
export function localCompany(companyId: string): LocalCompanyLookup {
  const table = getTable("admin_companies");
  const id = column(table, "id");
  if (!table || !id) return { state: "unavailable", company: null };
  const fields = {
    name: column(table, "name"),
    status: column(table, "status"),
    trade: column(table, "trade"),
    city: column(table, "city"),
    country: column(table, "country"),
    website_url: column(table, "website_url", "websiteUrl"),
  };
  const select = Object.entries(fields).map(([alias, source]) =>
    `${source ? identifier(source) : "NULL"} AS ${identifier(alias)}`).join(", ");
  const rows = getDb().prepare(`SELECT ${select} FROM ${identifier(table.sqlName)}
    WHERE ${identifier(id)} = ? LIMIT 2`).all(companyId) as Array<Record<string, unknown>>;
  if (!rows.length) return { state: "missing", company: null };
  if (rows.length > 1) return { state: "ambiguous", company: null };
  return { state: "found", company: {
    id: companyId,
    name: cell(rows[0].name), status: cell(rows[0].status), trade: cell(rows[0].trade),
    city: cell(rows[0].city), country: cell(rows[0].country), websiteUrl: cell(rows[0].website_url),
    uploadedAt: table.uploadedAt, truncated: table.truncated,
  } };
}

export type CompanyActivity = {
  available: boolean;
  events: number | null;
  projectCount: number | null;
  lastObservedAt: number | null;
  activityDataThrough: number | null;
  identityUploadedAt: number | null;
};

/** Local Data Connector relationships. Counts are bounded by the imported CSVs. */
export function companySnapshot(companyId: string): CompanySnapshot {
  const users = getTable("admin_users");
  const members = getTable("admin_project_users");
  const userId = column(users, "id");
  const company = column(users, "default_company_id", "company_id");
  const projectId = column(members, "bim360_project_id", "project_id");
  const memberUserId = column(members, "user_id");
  const sources = [users, members].filter((table): table is DatasetTable => Boolean(table))
    .map((table) => ({ name: table.name, uploadedAt: table.uploadedAt, truncated: table.truncated }));
  if (!users || !userId || !company) {
    return { available: false, userCount: null, projectCount: null, users: [], projects: [], sources };
  }

  const db = getDb();
  const usersTable = identifier(users.sqlName);
  const companyRef = identifier(company);
  const userCount = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${usersTable} WHERE ${companyRef} = ?`)
    .get(companyId) as { n: number }).n);
  const name = column(users, "name");
  const email = column(users, "email");
  const people = db.prepare(`SELECT ${identifier(userId)} AS id,
      ${name ? identifier(name) : "NULL"} AS name,
      ${email ? identifier(email) : "NULL"} AS email
      FROM ${usersTable} WHERE ${companyRef} = ?
      ORDER BY ${name ? identifier(name) : identifier(userId)} COLLATE NOCASE LIMIT 100`)
    .all(companyId) as Array<{ id: unknown; name: unknown; email: unknown }>;
  const result: CompanySnapshot = {
    available: true, userCount, projectCount: null,
    users: people.filter((row) => cell(row.id)).map((row) => ({
      id: cell(row.id)!, name: cell(row.name), email: cell(row.email),
    })),
    projects: [], sources,
  };
  if (!members || !projectId || !memberUserId) return result;

  const membershipTable = identifier(members.sqlName);
  const join = `FROM ${membershipTable} m JOIN ${usersTable} u ON m.${identifier(memberUserId)} = u.${identifier(userId)}
    WHERE u.${companyRef} = ? AND m.${identifier(projectId)} IS NOT NULL AND m.${identifier(projectId)} <> ''`;
  result.projectCount = Number((db.prepare(`SELECT COUNT(DISTINCT m.${identifier(projectId)}) AS n ${join}`)
    .get(companyId) as { n: number }).n);
  const projectRows = db.prepare(`SELECT m.${identifier(projectId)} AS id,
      COUNT(DISTINCT m.${identifier(memberUserId)}) AS people ${join}
      GROUP BY m.${identifier(projectId)} ORDER BY people DESC, id COLLATE NOCASE LIMIT 100`)
    .all(companyId) as Array<{ id: unknown; people: number }>;
  const projects = new Map(cachedProjects().map((project) => [project.id, project.name]));
  result.projects = projectRows.filter((row) => cell(row.id)).map((row) => ({
    id: cell(row.id)!, name: projects.get(cell(row.id)!) ?? null, people: Number(row.people),
  }));
  return result;
}

/** Observed activity for uniquely company-mapped email or Autodesk IDs in the uploaded user table. */
export function companyActivity(companyId: string): CompanyActivity {
  const users = getTable("admin_users");
  const company = column(users, "default_company_id", "company_id");
  const autodeskId = column(users, "autodesk_id");
  const email = column(users, "email");
  const coverage = getDb().prepare("SELECT MAX(occurred_ms) AS latest FROM activities")
    .get() as { latest: number | null };
  const unavailable: CompanyActivity = {
    available: false, events: null, projectCount: null, lastObservedAt: null,
    activityDataThrough: coverage.latest == null ? null : Number(coverage.latest),
    identityUploadedAt: users?.uploadedAt ?? null,
  };
  if (!users || !company || (!autodeskId && !email)) return unavailable;
  const table = identifier(users.sqlName);
  const companyColumn = identifier(company);
  const branches: string[] = [];
  if (autodeskId) {
    const idColumn = identifier(autodeskId);
    branches.push(`SELECT a.id, a.project_id, a.occurred_ms FROM activities a JOIN (
      SELECT TRIM(${idColumn}) AS identity_value FROM ${table}
      WHERE ${idColumn} IS NOT NULL AND TRIM(${idColumn}) <> ''
      GROUP BY identity_value
      HAVING COUNT(DISTINCT COALESCE(${companyColumn}, '')) = 1 AND MIN(${companyColumn}) = ?
    ) u ON a.actor_id = u.identity_value`);
  }
  if (email) {
    const emailColumn = identifier(email);
    branches.push(`SELECT a.id, a.project_id, a.occurred_ms FROM activities a JOIN (
      SELECT LOWER(TRIM(${emailColumn})) AS identity_value FROM ${table}
      WHERE ${emailColumn} IS NOT NULL AND TRIM(${emailColumn}) <> ''
      GROUP BY identity_value
      HAVING COUNT(DISTINCT COALESCE(${companyColumn}, '')) = 1 AND MIN(${companyColumn}) = ?
    ) u ON LOWER(TRIM(a.actor_email)) = u.identity_value`);
  }
  const row = getDb().prepare(`SELECT COUNT(*) AS events, COUNT(DISTINCT project_id) AS projects,
    MAX(occurred_ms) AS latest FROM (${branches.join(" UNION ")})`)
    .get(...branches.map(() => companyId)) as { events: number; projects: number; latest: number | null };
  return {
    available: true, events: Number(row.events), projectCount: Number(row.projects),
    lastObservedAt: row.latest == null ? null : Number(row.latest),
    activityDataThrough: unavailable.activityDataThrough,
    identityUploadedAt: users.uploadedAt,
  };
}

export type SubjectIdentity = { name: string; href: string | null; detail?: string };
export type UserIdentity = { name: string; sourceId: string; email?: string };

/** Resolve a page of company IDs in one query; duplicate source IDs stay unresolved. */
export function resolveCompanyNames(ids: string[]): Map<string, string> {
  const table = getTable("admin_companies");
  const id = column(table, "id");
  const name = column(table, "name");
  if (!table || !id || !name || !ids.length) return new Map();
  const uniqueIds = [...new Set(ids)];
  const resolved = new Map<string, string>();
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    const batch = uniqueIds.slice(offset, offset + 200);
    const rows = getDb().prepare(`SELECT ${identifier(id)} AS id, MAX(${identifier(name)}) AS name
      FROM ${identifier(table.sqlName)} WHERE ${identifier(id)} IN (${batch.map(() => "?").join(",")})
      GROUP BY ${identifier(id)} HAVING COUNT(*) = 1`).all(...batch) as Array<{ id: string; name: string | null }>;
    for (const row of rows) if (cell(row.name)) resolved.set(row.id, cell(row.name)!);
  }
  return resolved;
}

function lookupNames(
  tableName: string,
  ids: string[],
  idCandidates: string[],
  nameCandidates: string[],
  detailCandidates: string[] = [],
): Map<string, { name: string; sourceId: string; detail?: string }> {
  const table = getTable(tableName);
  const idColumns = idCandidates.map((name) => column(table, name)).filter((name): name is string => Boolean(name));
  const nameColumns = nameCandidates.map((name) => column(table, name)).filter((name): name is string => Boolean(name));
  const detailColumns = detailCandidates.map((name) => column(table, name)).filter((name): name is string => Boolean(name));
  if (!table || !idColumns.length || !nameColumns.length || !ids.length) return new Map();
  const uniqueIds = [...new Set(ids)];
  const select = idColumns.map((name) => `${identifier(name)} AS ${identifier("key_" + name)}`).join(", ");
  const labelParts = nameColumns.map((name) => `NULLIF(TRIM(${identifier(name)}), '')`);
  const label = labelParts.length === 1 ? labelParts[0] : `COALESCE(${labelParts.join(", ")})`;
  const detailParts = detailColumns.map((name) => `NULLIF(TRIM(${identifier(name)}), '')`);
  const detail = detailParts.length === 0 ? "NULL" : detailParts.length === 1 ? detailParts[0] : `COALESCE(${detailParts.join(", ")})`;
  const candidates = new Map<string, Map<number, { name: string; sourceId: string; detail?: string }>>();
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    const batch = uniqueIds.slice(offset, offset + 200);
    const batchSet = new Set(batch);
    const where = idColumns.map((name) => `${identifier(name)} IN (${batch.map(() => "?").join(",")})`).join(" OR ");
    const rows = getDb().prepare(`SELECT rowid AS source_row_id, ${select}, ${label} AS label, ${detail} AS detail
        FROM ${identifier(table.sqlName)} WHERE ${where}`)
      .all(...idColumns.flatMap(() => batch)) as Array<Record<string, unknown>>;
    for (const row of rows) {
    const label = cell(row.label);
    const detail = cell(row.detail);
    const sourceId = cell(row["key_" + idColumns[0]]);
    const rowId = Number(row.source_row_id);
    if (!label || !sourceId || !Number.isSafeInteger(rowId)) continue;
    for (const name of idColumns) {
      const key = cell(row["key_" + name]);
      if (key && batchSet.has(key)) {
        const values = candidates.get(key) ?? new Map<number, { name: string; sourceId: string; detail?: string }>();
        values.set(rowId, { name: label, sourceId, ...(detail ? { detail } : {}) });
        candidates.set(key, values);
      }
    }
    }
  }
  return new Map([...candidates].filter(([, names]) => names.size === 1)
    .map(([id, names]) => [id, [...names.values()][0]]));
}

/** Resolve exact Data Connector user or Autodesk IDs when the match is unambiguous. */
export function resolveUserIdentities(ids: string[]): Map<string, UserIdentity> {
  const rows = lookupNames("admin_users", ids, ["id", "autodesk_id"], ["name", "email"], ["email"]);
  return new Map([...rows].map(([id, row]) => [id, {
    name: row.name,
    sourceId: row.sourceId,
    ...(row.detail ? { email: row.detail } : {}),
  }]));
}

/** Exact ID matches only; an ambiguous local identity stays as its raw APS ID. */
export function permissionSubjectIdentities(
  entries: FolderPermission[],
  liveCompanies: Array<{ id: string; name?: string }> = [],
): Map<string, SubjectIdentity> {
  const grouped = { user: [] as string[], company: [] as string[], role: [] as string[] };
  for (const entry of entries) {
    const type = entry.subjectType.toLowerCase();
    if (type.includes("user")) grouped.user.push(entry.subjectId);
    else if (type.includes("company")) grouped.company.push(entry.subjectId);
    else if (type.includes("role")) grouped.role.push(entry.subjectId);
  }
  const userNames = resolveUserIdentities(grouped.user);
  const companyNames = lookupNames("admin_companies", grouped.company, ["id"], ["name"]);
  for (const company of liveCompanies) if (company.id && company.name) companyNames.set(company.id, { name: company.name, sourceId: company.id });
  const roleNames = lookupNames("admin_project_roles", grouped.role, ["id", "role_id"], ["name", "role_name"]);
  const identities = new Map<string, SubjectIdentity>();
  for (const entry of entries) {
    const type = entry.subjectType.toLowerCase();
    const id = entry.subjectId;
    if (type.includes("user") && userNames.has(id)) {
      const user = userNames.get(id)!;
      identities.set(`${entry.subjectType}:${id}`, { name: user.name, href: `/people/${encodeURIComponent(user.sourceId)}`, detail: user.email });
    } else if (type.includes("company") && companyNames.has(id)) {
      identities.set(`${entry.subjectType}:${id}`, { name: companyNames.get(id)!.name, href: `/companies/${encodeURIComponent(id)}` });
    } else if (type.includes("role") && roleNames.has(id)) {
      identities.set(`${entry.subjectType}:${id}`, { name: roleNames.get(id)!.name, href: null });
    }
  }
  return identities;
}
