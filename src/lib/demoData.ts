import "server-only";
import { getDb } from "./db";
import { getTable } from "./dataset";
import { env } from "./env";

/** Read the already-remapped synthetic rows so demo page links use exact seeded IDs. */
export function demoTableRows(name: string): Array<Record<string, unknown>> {
  if (!env.demoMode) return [];
  const table = getTable(name);
  if (!table || !/^[a-z][a-z0-9_]*$/.test(table.sqlName)) return [];
  const rows = getDb().prepare(`SELECT * FROM "${table.sqlName}"`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => Object.fromEntries(table.columns.map((column) =>
    [column.name, row[column.sqlName]])));
}

function cell(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export type DemoProjectMember = {
  id: string;
  name: string;
  email: string;
  companyId: string;
  companyName: string;
  accessLevel: "Project Admin" | "Member";
  products: string[];
};

/** Distinct sample people for one exact seeded project ID; not a live access check. */
export function demoProjectMembers(projectId: string): DemoProjectMember[] {
  const users = new Map(demoTableRows("admin_users").map((row) => [cell(row.id), row]));
  const companies = new Map(demoTableRows("admin_companies").map((row) => [cell(row.id), cell(row.name)]));
  const productRows = demoTableRows("admin_project_user_products")
    .filter((row) => cell(row.bim360_project_id) === projectId);
  const members = new Map<string, DemoProjectMember>();
  for (const row of demoTableRows("admin_project_users")) {
    if (cell(row.bim360_project_id) !== projectId) continue;
    const id = cell(row.user_id);
    const user = users.get(id);
    if (!id || !user) continue;
    const companyId = cell(user.default_company_id);
    const previous = members.get(id);
    const products = [...new Set(productRows.filter((product) => cell(product.user_id) === id)
      .map((product) => cell(product.product_key)).filter(Boolean))].sort();
    members.set(id, {
      id,
      name: cell(user.name) || cell(user.email) || id,
      email: cell(user.email),
      companyId,
      companyName: companies.get(companyId) || companyId,
      accessLevel: previous?.accessLevel === "Project Admin" || cell(row.access_level) === "admin"
        ? "Project Admin" : "Member",
      products,
    });
  }
  return [...members.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type DemoAssociation = { key: string; name: string; projectIds: string[] };

export function demoPersonAssociations(userId: string): { products: DemoAssociation[]; roles: DemoAssociation[] } {
  function group(name: string, keyField: string, labelField: string): DemoAssociation[] {
    const entries = new Map<string, { name: string; projects: Set<string> }>();
    for (const row of demoTableRows(name)) {
      if (cell(row.user_id) !== userId) continue;
      const key = cell(row[keyField]);
      const projectId = cell(row.bim360_project_id);
      if (!key || !projectId) continue;
      const entry = entries.get(key) ?? { name: cell(row[labelField]) || key, projects: new Set<string>() };
      entry.projects.add(projectId);
      entries.set(key, entry);
    }
    return [...entries].map(([key, entry]) => ({ key, name: entry.name, projectIds: [...entry.projects] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    products: group("admin_project_user_products", "product_key", "product_key"),
    roles: group("admin_project_user_roles", "role_id", "name"),
  };
}
