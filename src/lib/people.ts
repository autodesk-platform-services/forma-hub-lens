import "server-only";

import { getDb } from "./db";
import { getTable, resolveColumn, type DatasetTable } from "./dataset";

/** The directory and matrix describe uploaded Data Connector data, not live access. */
export const PEOPLE_PAGE_SIZE = 50;

type SourceName = "admin_users" | "admin_project_users" | "admin_project_user_products" | "admin_projects" | "admin_companies";
const SOURCE_NAMES: SourceName[] = [
  "admin_users",
  "admin_project_users",
  "admin_project_user_products",
  "admin_projects",
  "admin_companies",
];

export type PeopleSource = {
  name: SourceName;
  rows: number;
  uploadedAt: number;
  truncated: boolean;
  missingColumns: string[];
};

export type PeopleSourceStatus = {
  sources: PeopleSource[];
  warnings: string[];
  directoryReady: boolean;
  matrixReady: boolean;
  productsReady: boolean;
};

function column(table: DatasetTable | undefined, ...names: string[]): string | null {
  if (!table) return null;
  for (const name of names) {
    const hit = resolveColumn(table, name);
    if (hit) return hit;
  }
  return null;
}

function identifier(value: string): string {
  // The dataset registry creates only these identifiers. Check again at the
  // query boundary so a corrupt registry row cannot become SQL syntax.
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Invalid dataset identifier");
  return `"${value}"`;
}

function ref(tableAlias: string, name: string | null): string {
  return name ? `${tableAlias}.${identifier(name)}` : "NULL";
}

function containsPattern(value: string): string {
  return `%${value.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

function boundedPage(page: number): number {
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
}

function sourceTable(name: SourceName): DatasetTable | undefined {
  return getTable(name);
}

export function peopleSourceStatus(): PeopleSourceStatus {
  const tables = Object.fromEntries(SOURCE_NAMES.map((name) => [name, sourceTable(name)])) as
    Record<SourceName, DatasetTable | undefined>;
  const requirements: Record<SourceName, Array<{ label: string; names: string[] }>> = {
    admin_users: [{ label: "id", names: ["id"] }],
    admin_project_users: [
      { label: "user_id", names: ["user_id"] },
      { label: "bim360_project_id/project_id", names: ["bim360_project_id", "project_id"] },
    ],
    admin_project_user_products: [
      { label: "user_id", names: ["user_id"] },
      { label: "bim360_project_id/project_id", names: ["bim360_project_id", "project_id"] },
      { label: "product_key", names: ["product_key"] },
    ],
    admin_projects: [{ label: "id", names: ["id"] }],
    admin_companies: [{ label: "id", names: ["id"] }, { label: "name", names: ["name"] }],
  };
  const sources: PeopleSource[] = [];
  const warnings: string[] = [];
  for (const name of SOURCE_NAMES) {
    const table = tables[name];
    if (!table) {
      if (name !== "admin_companies") warnings.push(`${name}.csv has not been uploaded.`);
      continue;
    }
    const missingColumns = requirements[name]
      .filter(({ names }) => !column(table, ...names))
      .map(({ label }) => label);
    sources.push({
      name,
      rows: table.rowCount,
      uploadedAt: table.uploadedAt,
      truncated: table.truncated,
      missingColumns,
    });
    if (table.truncated) warnings.push(`${name}.csv reached the import row limit; results are incomplete.`);
    if (missingColumns.length) warnings.push(`${name}.csv lacks ${missingColumns.join(", ")}; related joins are unavailable.`);
  }
  const dates = sources.map((source) => source.uploadedAt);
  if (dates.length > 1 && Math.max(...dates) - Math.min(...dates) > 5 * 60_000) {
    warnings.push("These tables were imported at different times and may represent different extracts.");
  }
  return {
    sources,
    warnings,
    directoryReady: Boolean(tables.admin_users),
    matrixReady: Boolean(
      column(tables.admin_project_users, "user_id") &&
      column(tables.admin_project_users, "bim360_project_id", "project_id"),
    ),
    productsReady: Boolean(
      column(tables.admin_project_user_products, "user_id") &&
      column(tables.admin_project_user_products, "bim360_project_id", "project_id") &&
      column(tables.admin_project_user_products, "product_key"),
    ),
  };
}

export type PersonRow = {
  id: string | null;
  autodeskId: string | null;
  name: string | null;
  email: string | null;
  status: string | null;
  companyId: string | null;
  lastSignIn: string | null;
  memberships: number | null;
  duplicateId: boolean;
};

/** Local extract observation, separate from the uploaded Admin user snapshot. */
export function personActivityObservation(person: PersonRow): {
  lastObservedAt: number | null;
  activityDataThrough: number | null;
} {
  const ids = [...new Set([person.id, person.autodeskId].filter((id): id is string => Boolean(id)))];
  const conditions = [
    ...(person.email ? ["LOWER(actor_email) = ?"] : []),
    ...ids.map(() => "actor_id = ?"),
  ];
  const params = [...(person.email ? [person.email.toLowerCase()] : []), ...ids];
  const db = getDb();
  const latest = conditions.length
    ? (db.prepare(`SELECT MAX(occurred_ms) AS at FROM activities WHERE ${conditions.join(" OR ")}`)
      .get(...params) as { at: number | null }).at
    : null;
  const through = (db.prepare("SELECT MAX(occurred_ms) AS at FROM activities")
    .get() as { at: number | null }).at;
  return {
    lastObservedAt: latest === null ? null : Number(latest),
    activityDataThrough: through === null ? null : Number(through),
  };
}

type PersonRecord = Record<string, string | number | null>;

function personSelect(table: DatasetTable): string {
  return [
    `${ref("u", column(table, "id"))} AS id`,
    `${ref("u", column(table, "autodesk_id"))} AS autodesk_id`,
    `${ref("u", column(table, "name"))} AS name`,
    `${ref("u", column(table, "email"))} AS email`,
    `${ref("u", column(table, "status"))} AS status`,
    `${ref("u", column(table, "default_company_id", "company_id"))} AS company_id`,
    `${ref("u", column(table, "last_sign_in"))} AS last_sign_in`,
  ].join(", ");
}

function stringValue(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function personFromRecord(row: PersonRecord): PersonRow {
  return {
    id: stringValue(row.id),
    autodeskId: stringValue(row.autodesk_id),
    name: stringValue(row.name),
    email: stringValue(row.email),
    status: stringValue(row.status),
    companyId: stringValue(row.company_id),
    lastSignIn: stringValue(row.last_sign_in),
    memberships: null,
    duplicateId: false,
  };
}

export function listPeople(search: string, page: number): { rows: PersonRow[]; total: number; page: number } {
  const table = sourceTable("admin_users");
  const currentPage = boundedPage(page);
  if (!table) return { rows: [], total: 0, page: currentPage };

  const query = search.trim().slice(0, 120);
  const searchable = ["name", "email", "id", "autodesk_id"]
    .map((name) => column(table, name))
    .filter((name): name is string => Boolean(name));
  const where = query && searchable.length
    ? `WHERE (${searchable.map((name) => `${ref("u", name)} LIKE ? ESCAPE '!'`).join(" OR ")})`
    : "";
  const params = where ? searchable.map(() => containsPattern(query)) : [];
  const db = getDb();
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${identifier(table.sqlName)} u ${where}`)
    .get(...params) as { n: number }).n);
  const effectivePage = Math.min(currentPage, Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE)));
  const id = column(table, "id");
  const name = column(table, "name");
  const email = column(table, "email");
  const order = `COALESCE(NULLIF(${ref("u", name)}, ''), NULLIF(${ref("u", email)}, ''), ${ref("u", id)}, '')`;
  const raw = db.prepare(
    `SELECT ${personSelect(table)} FROM ${identifier(table.sqlName)} u ${where}
     ORDER BY ${order} COLLATE NOCASE, u.rowid LIMIT ? OFFSET ?`,
  ).all(...params, PEOPLE_PAGE_SIZE, (effectivePage - 1) * PEOPLE_PAGE_SIZE) as PersonRecord[];
  const rows = raw.map(personFromRecord);
  enrichPeople(rows, table);
  return { rows, total, page: effectivePage };
}

function enrichPeople(rows: PersonRow[], usersTable: DatasetTable): void {
  const ids = [...new Set(rows.map((row) => row.id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const userId = column(usersTable, "id");
  if (!userId) return;
  const duplicates = db.prepare(
    `SELECT ${identifier(userId)} AS id, COUNT(*) AS n FROM ${identifier(usersTable.sqlName)}
     WHERE ${identifier(userId)} IN (${placeholders}) GROUP BY ${identifier(userId)}`,
  ).all(...ids) as Array<{ id: string; n: number }>;
  const counts = new Map(duplicates.map((row) => [row.id, Number(row.n)]));

  const membersTable = sourceTable("admin_project_users");
  const memberId = column(membersTable, "user_id");
  let memberships = new Map<string, number>();
  if (membersTable && memberId) {
    const results = db.prepare(
      `SELECT ${identifier(memberId)} AS id, COUNT(*) AS n FROM ${identifier(membersTable.sqlName)}
       WHERE ${identifier(memberId)} IN (${placeholders}) GROUP BY ${identifier(memberId)}`,
    ).all(...ids) as Array<{ id: string; n: number }>;
    memberships = new Map(results.map((row) => [row.id, Number(row.n)]));
  }
  for (const row of rows) {
    if (!row.id) continue;
    row.duplicateId = (counts.get(row.id) ?? 0) > 1;
    if (membersTable && memberId && !row.duplicateId) row.memberships = memberships.get(row.id) ?? 0;
  }
}

export type PersonLookup =
  | { state: "found"; person: PersonRow }
  | { state: "missing" | "ambiguous" | "unavailable" };

export function getPerson(id: string): PersonLookup {
  const table = sourceTable("admin_users");
  const idColumn = column(table, "id");
  if (!table || !idColumn) return { state: "unavailable" };
  const rows = getDb().prepare(
    `SELECT ${personSelect(table)} FROM ${identifier(table.sqlName)} u
     WHERE ${ref("u", idColumn)} = ? LIMIT 2`,
  ).all(id) as PersonRecord[];
  if (rows.length === 0) return { state: "missing" };
  if (rows.length > 1) return { state: "ambiguous" };
  const person = personFromRecord(rows[0]);
  enrichPeople([person], table);
  return { state: "found", person };
}

export type MatrixRow = {
  rowId: number;
  userId: string | null;
  userName: string | null;
  email: string | null;
  identity: "matched" | "missing" | "ambiguous" | "unavailable";
  projectId: string | null;
  projectName: string | null;
  membershipStatus: string | null;
  accessLevel: string | null;
  products: Array<{ key: string; access: string | null }> | null;
};

export type MatrixFilters = {
  search?: string;
  project?: string;
  status?: string;
  userId?: string;
  page: number;
};

export function listAccessMatrix(filters: MatrixFilters): {
  rows: MatrixRow[];
  total: number;
  page: number;
} {
  const table = sourceTable("admin_project_users");
  const userId = column(table, "user_id");
  const projectId = column(table, "bim360_project_id", "project_id");
  const currentPage = boundedPage(filters.page);
  if (!table || !userId || !projectId) return { rows: [], total: 0, page: currentPage };

  const users = sourceTable("admin_users");
  const usersId = column(users, "id");
  const projects = sourceTable("admin_projects");
  const projectsId = column(projects, "id");
  const where: string[] = [];
  const params: string[] = [];
  const memberUser = ref("m", userId);
  const memberProject = ref("m", projectId);

  if (filters.userId) {
    where.push(`${memberUser} = ?`);
    params.push(filters.userId);
  }
  const search = filters.search?.trim().slice(0, 120);
  if (search) {
    const clauses = [`${memberUser} LIKE ? ESCAPE '!'`];
    params.push(containsPattern(search));
    if (users && usersId) {
      const names = [column(users, "name"), column(users, "email"), column(users, "autodesk_id")]
        .filter((name): name is string => Boolean(name));
      if (names.length) {
        clauses.push(`${memberUser} IN (SELECT ${identifier(usersId)} FROM ${identifier(users.sqlName)} u
          WHERE ${names.map((name) => `${ref("u", name)} LIKE ? ESCAPE '!'`).join(" OR ")})`);
        params.push(...names.map(() => containsPattern(search)));
      }
    }
    where.push(`(${clauses.join(" OR ")})`);
  }
  const projectSearch = filters.project?.trim().slice(0, 120);
  if (projectSearch) {
    const clauses = [`${memberProject} LIKE ? ESCAPE '!'`];
    params.push(containsPattern(projectSearch));
    const name = column(projects, "name");
    if (projects && projectsId && name) {
      clauses.push(`${memberProject} IN (SELECT ${identifier(projectsId)} FROM ${identifier(projects.sqlName)} p
        WHERE ${ref("p", name)} LIKE ? ESCAPE '!')`);
      params.push(containsPattern(projectSearch));
    }
    where.push(`(${clauses.join(" OR ")})`);
  }
  const status = filters.status?.trim().slice(0, 40);
  const statusColumn = column(table, "status");
  if (status && !statusColumn) return { rows: [], total: 0, page: currentPage };
  if (status && statusColumn) {
    where.push(`${ref("m", statusColumn)} = ?`);
    params.push(status);
  }

  const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const db = getDb();
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${identifier(table.sqlName)} m ${predicate}`)
    .get(...params) as { n: number }).n);
  const effectivePage = Math.min(currentPage, Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE)));
  const accessLevel = column(table, "access_level");
  const records = db.prepare(
    `SELECT m.rowid AS row_id, ${memberUser} AS user_id, ${memberProject} AS project_id,
            ${ref("m", statusColumn)} AS status, ${ref("m", accessLevel)} AS access_level
     FROM ${identifier(table.sqlName)} m ${predicate}
     ORDER BY ${memberProject} COLLATE NOCASE, ${memberUser} COLLATE NOCASE, m.rowid
     LIMIT ? OFFSET ?`,
  ).all(...params, PEOPLE_PAGE_SIZE, (effectivePage - 1) * PEOPLE_PAGE_SIZE) as Array<{
    row_id: number; user_id: string | null; project_id: string | null;
    status: string | null; access_level: string | null;
  }>;
  const rows: MatrixRow[] = records.map((record) => ({
    rowId: Number(record.row_id),
    userId: stringValue(record.user_id),
    userName: null,
    email: null,
    identity: users && usersId ? "missing" : "unavailable",
    projectId: stringValue(record.project_id),
    projectName: null,
    membershipStatus: stringValue(record.status),
    accessLevel: stringValue(record.access_level),
    products: null,
  }));
  enrichMatrix(rows, users, usersId, projects, projectsId);
  return { rows, total, page: effectivePage };
}

function enrichMatrix(
  rows: MatrixRow[],
  users: DatasetTable | undefined,
  usersId: string | null,
  projects: DatasetTable | undefined,
  projectsId: string | null,
): void {
  const db = getDb();
  const userIds = [...new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];
  if (users && usersId && userIds.length) {
    const names = db.prepare(
      `SELECT ${identifier(usersId)} AS id,
              ${ref("u", column(users, "name"))} AS name,
              ${ref("u", column(users, "email"))} AS email
       FROM ${identifier(users.sqlName)} u
       WHERE ${ref("u", usersId)} IN (${userIds.map(() => "?").join(",")})`,
    ).all(...userIds) as Array<{ id: string; name: string | null; email: string | null }>;
    const matches = new Map<string, Array<{ name: string | null; email: string | null }>>();
    for (const item of names) matches.set(item.id, [...(matches.get(item.id) ?? []), item]);
    for (const row of rows) {
      const found = row.userId ? matches.get(row.userId) : undefined;
      if (found?.length === 1) {
        row.userName = stringValue(found[0].name);
        row.email = stringValue(found[0].email);
        row.identity = "matched";
      } else if (found && found.length > 1) {
        row.identity = "ambiguous";
      }
    }
  }

  const projectIds = [...new Set(rows.map((row) => row.projectId).filter((id): id is string => Boolean(id)))];
  if (projects && projectsId && projectIds.length) {
    const names = db.prepare(
      `SELECT ${identifier(projectsId)} AS id, ${ref("p", column(projects, "name"))} AS name
       FROM ${identifier(projects.sqlName)} p
       WHERE ${ref("p", projectsId)} IN (${projectIds.map(() => "?").join(",")})`,
    ).all(...projectIds) as Array<{ id: string; name: string | null }>;
    const matches = new Map<string, string[]>();
    for (const item of names) matches.set(item.id, [...(matches.get(item.id) ?? []), item.name ?? ""]);
    for (const row of rows) {
      const found = row.projectId ? matches.get(row.projectId) : undefined;
      if (found?.length === 1) row.projectName = stringValue(found[0]);
    }
  }

  const products = sourceTable("admin_project_user_products");
  const productUserId = column(products, "user_id");
  const productProjectId = column(products, "bim360_project_id", "project_id");
  const productKey = column(products, "product_key");
  if (!products || !productUserId || !productProjectId || !productKey) return;
  for (const row of rows) row.products = [];
  const pairs = [...new Set(rows.filter((row) => row.userId && row.projectId)
    .map((row) => JSON.stringify([row.userId, row.projectId])))].map((pair) => JSON.parse(pair) as [string, string]);
  if (pairs.length === 0) return;
  const where = pairs.map(() => `(${identifier(productUserId)} = ? AND ${identifier(productProjectId)} = ?)`).join(" OR ");
  const records = db.prepare(
    `SELECT ${identifier(productUserId)} AS user_id, ${identifier(productProjectId)} AS project_id,
            ${identifier(productKey)} AS product_key,
            ${ref("p", column(products, "access_level"))} AS access_level
     FROM ${identifier(products.sqlName)} p WHERE ${where}`,
  ).all(...pairs.flat()) as Array<{
    user_id: string; project_id: string; product_key: string; access_level: string | null;
  }>;
  const byPair = new Map<string, Map<string, { key: string; access: string | null }>>();
  for (const item of records) {
    const pair = JSON.stringify([item.user_id, item.project_id]);
    const entry = byPair.get(pair) ?? new Map();
    const key = stringValue(item.product_key);
    if (key) entry.set(`${key}\0${item.access_level ?? ""}`, { key, access: stringValue(item.access_level) });
    byPair.set(pair, entry);
  }
  for (const row of rows) {
    if (row.userId && row.projectId) {
      row.products = [...(byPair.get(JSON.stringify([row.userId, row.projectId]))?.values() ?? [])]
        .sort((a, b) => a.key.localeCompare(b.key));
    }
  }
}
