import "server-only";

import { getDb } from "./db";
import { getTable, resolveColumn, type DatasetTable } from "./dataset";
import { listPeople, PEOPLE_PAGE_SIZE } from "./people";

export type SearchKind = "projects" | "people" | "companies";

export type SearchSource = {
  label: string;
  available: boolean;
  asOf: number | null;
  truncated: boolean;
  note: string;
};

export type ProjectHit = {
  id: string;
  name: string;
  status: string | null;
  type: string | null;
  jobNumber: string | null;
  syncedAt: number;
};

export type PersonHit = {
  id: string | null;
  name: string | null;
  email: string | null;
  status: string | null;
  duplicateId: boolean;
};

export type CompanyHit = {
  id: string | null;
  name: string | null;
  trade: string | null;
  city: string | null;
  country: string | null;
  status: string | null;
};

export type SearchResult<T> = {
  rows: T[];
  total: number;
  page: number;
  source: SearchSource;
};

export type PortfolioResults = {
  projects: SearchResult<ProjectHit>;
  people: SearchResult<PersonHit>;
  companies: SearchResult<CompanyHit>;
};

function quoted(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Invalid dataset identifier");
  return `"${value}"`;
}

function column(table: DatasetTable, name: string): string | null {
  return resolveColumn(table, name) ?? null;
}

function ref(alias: string, name: string | null): string {
  return name ? `${alias}.${quoted(name)}` : "NULL";
}

function pattern(query: string): string {
  return `%${query.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

function boundedPage(page: number): number {
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

export function searchProjects(query: string, page: number): SearchResult<ProjectHit> {
  const term = query.trim().slice(0, 120);
  const currentPage = boundedPage(page);
  const db = getDb();
  const latest = db.prepare("SELECT MAX(synced_at) AS at FROM projects").get() as { at: number | null };
  const source: SearchSource = {
    label: "Forma Admin API project sync",
    available: latest.at !== null,
    asOf: latest.at,
    truncated: false,
    note: "Local project mirror from the last completed sync. A partial or failed sync does not replace the prior inventory.",
  };
  if (!term) return { rows: [], total: 0, page: currentPage, source };
  const like = pattern(term);
  const where = "WHERE name LIKE ? ESCAPE '!' OR id LIKE ? ESCAPE '!' OR job_number LIKE ? ESCAPE '!'";
  const params = [like, like, like];
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM projects ${where}`)
    .get(...params) as { n: number }).n);
  const effectivePage = Math.min(currentPage, Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE)));
  const rows = db.prepare(
    `SELECT id, name, status, type, job_number, synced_at FROM projects ${where}
     ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
  ).all(...params, PEOPLE_PAGE_SIZE, (effectivePage - 1) * PEOPLE_PAGE_SIZE) as Array<{
    id: string; name: string | null; status: string | null; type: string | null;
    job_number: string | null; synced_at: number;
  }>;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      status: row.status,
      type: row.type,
      jobNumber: row.job_number,
      syncedAt: Number(row.synced_at),
    })),
    total,
    page: effectivePage,
    source,
  };
}

export function searchPeople(query: string, page: number): SearchResult<PersonHit> {
  const table = getTable("admin_users");
  const source: SearchSource = {
    label: "admin_users.csv",
    available: Boolean(table),
    asOf: table?.uploadedAt ?? null,
    truncated: table?.truncated ?? false,
    note: "Uploaded Data Connector table. Import time is not the extraction time or a live access check.",
  };
  const currentPage = boundedPage(page);
  if (!query.trim() || !table) return { rows: [], total: 0, page: currentPage, source };
  const result = listPeople(query, currentPage);
  return {
    rows: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      duplicateId: row.duplicateId,
    })),
    total: result.total,
    page: result.page,
    source,
  };
}

export function searchCompanies(query: string, page: number): SearchResult<CompanyHit> {
  const table = getTable("admin_companies");
  const currentPage = boundedPage(page);
  const source: SearchSource = {
    label: "admin_companies.csv",
    available: Boolean(table),
    asOf: table?.uploadedAt ?? null,
    truncated: table?.truncated ?? false,
    note: "Uploaded Data Connector table. Import time is not the extraction time.",
  };
  const term = query.trim().slice(0, 120);
  if (!table || !term) return { rows: [], total: 0, page: currentPage, source };
  const searchable = ["id", "name", "trade", "city", "country"]
    .map((name) => column(table, name))
    .filter((name): name is string => Boolean(name));
  if (searchable.length === 0) return { rows: [], total: 0, page: currentPage, source };
  const where = `WHERE (${searchable.map((name) => `${ref("c", name)} LIKE ? ESCAPE '!'`).join(" OR ")})`;
  const params = searchable.map(() => pattern(term));
  const db = getDb();
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${quoted(table.sqlName)} c ${where}`)
    .get(...params) as { n: number }).n);
  const effectivePage = Math.min(currentPage, Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE)));
  const select = ["id", "name", "trade", "city", "country", "status"]
    .map((name) => `${ref("c", column(table, name))} AS ${quoted(name)}`).join(", ");
  const name = column(table, "name");
  const id = column(table, "id");
  const rows = db.prepare(
    `SELECT ${select} FROM ${quoted(table.sqlName)} c ${where}
     ORDER BY COALESCE(${ref("c", name)}, ${ref("c", id)}, '') COLLATE NOCASE, c.rowid
     LIMIT ? OFFSET ?`,
  ).all(...params, PEOPLE_PAGE_SIZE, (effectivePage - 1) * PEOPLE_PAGE_SIZE) as Array<Record<string, string | null>>;
  return {
    rows: rows.map((row) => ({
      id: textValue(row.id),
      name: textValue(row.name),
      trade: textValue(row.trade),
      city: textValue(row.city),
      country: textValue(row.country),
      status: textValue(row.status),
    })),
    total,
    page: effectivePage,
    source,
  };
}

export function searchPortfolio(query: string, kind: SearchKind | "all", page: number): PortfolioResults {
  // Each query returns at most 50 rows. The overview renders five per source;
  // full result pages paginate one source at a time.
  return {
    projects: searchProjects(query, kind === "projects" ? page : 1),
    people: searchPeople(query, kind === "people" ? page : 1),
    companies: searchCompanies(query, kind === "companies" ? page : 1),
  };
}
