import "server-only";

import { getDb } from "./db";
import { getTable, getTrustedTableSource, resolveColumn, type DatasetTable } from "./dataset";
import { env } from "./env";

export type RoleSummary = {
  id: string;
  name: string;
  status: "active" | "inactive" | "mixed" | "unknown";
  projectIds: string[];
  userCount: number | null;
};

export type RoleDirectory = {
  roles: RoleSummary[];
  tableName: string | null;
  uploadedAt: number | null;
  truncated: boolean;
  trusted: boolean;
  rolesAssignable: boolean;
  userRolesAvailable: boolean;
};

function column(table: DatasetTable, ...names: string[]): string | null {
  for (const name of names) {
    const found = resolveColumn(table, name);
    if (found) return `"${found}"`;
  }
  return null;
}

/** Only known, active definitions from a trusted APS job can be used for a write. */
export function assignableRoleIds(directory: RoleDirectory, projectIds: string[]): string[] {
  if (!directory.rolesAssignable || !projectIds.length) return [];
  return directory.roles.filter((role) => role.status === "active"
    && projectIds.every((projectId) => role.projectIds.includes(projectId))).map((role) => role.id);
}

export function readRoleDirectory(): RoleDirectory {
  const table = getTable("admin_project_roles") ?? getTable("admin_roles");
  const empty: RoleDirectory = { roles: [], tableName: table?.name ?? null,
    uploadedAt: table?.uploadedAt ?? null, truncated: table?.truncated ?? false,
    trusted: false, rolesAssignable: false, userRolesAvailable: Boolean(getTable("admin_project_user_roles")) };
  if (!table) return empty;
  const idCol = column(table, "role_id", "id");
  const nameCol = column(table, "name", "role_name");
  if (!idCol || !nameCol) return empty;
  const statusCol = column(table, "status");
  const projectCol = column(table, "bim360_project_id", "project_id");
  const source = getTrustedTableSource(table.name);
  const trusted = Boolean(source?.hubId === env.hubId && !source.truncated && !table.truncated);
  const roles = new Map<string, { id: string; name: string; statuses: Set<string>; projects: Set<string> }>();
  const rows = getDb().prepare(`SELECT ${idCol} AS id, ${nameCol} AS name,
    ${statusCol ?? "NULL"} AS status, ${projectCol ?? "NULL"} AS project_id
    FROM "${table.sqlName}" WHERE ${idCol} IS NOT NULL AND ${nameCol} IS NOT NULL`).all() as
    Array<{ id: string; name: string; status: string | null; project_id: string | null }>;
  for (const row of rows) {
    const id = String(row.id).trim();
    const name = String(row.name).trim();
    if (!id || !name) continue;
    const group = roles.get(id) ?? { id, name, statuses: new Set<string>(), projects: new Set<string>() };
    if (name !== group.name) group.statuses.add("conflicting-name");
    group.statuses.add(row.status?.trim().toLowerCase() || "unknown");
    if (row.project_id) group.projects.add(String(row.project_id).trim());
    roles.set(id, group);
  }

  const userRoles = getTable("admin_project_user_roles");
  const userRoleCol = userRoles ? column(userRoles, "role_id") : null;
  const userIdCol = userRoles ? column(userRoles, "user_id") : null;
  const userRolesUsable = Boolean(userRoles && userRoleCol && userIdCol);
  const userCounts = new Map<string, number>();
  if (userRoles && userRoleCol && userIdCol && !userRoles.truncated) {
      const counts = getDb().prepare(`SELECT ${userRoleCol} AS role_id, COUNT(DISTINCT ${userIdCol}) AS count
        FROM "${userRoles.sqlName}" WHERE ${userRoleCol} IS NOT NULL GROUP BY ${userRoleCol}`).all() as
        Array<{ role_id: string; count: number }>;
      for (const row of counts) userCounts.set(String(row.role_id), Number(row.count));
  }
  return {
    roles: [...roles.values()].map((group): RoleSummary => ({
      id: group.id, name: group.name,
      status: group.statuses.size === 1 && group.statuses.has("active") ? "active"
        : group.statuses.size === 1 && group.statuses.has("inactive") ? "inactive"
          : group.statuses.size === 1 && group.statuses.has("unknown") ? "unknown" : "mixed",
      projectIds: [...group.projects].sort(), userCount: userRolesUsable && !userRoles?.truncated ? (userCounts.get(group.id) ?? 0) : null,
    })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    tableName: table.name, uploadedAt: table.uploadedAt, truncated: table.truncated,
    trusted, rolesAssignable: trusted && table.name === "admin_project_roles" && Boolean(statusCol && projectCol),
    userRolesAvailable: userRolesUsable,
  };
}

export type RoleUserAssignment = { userId: string; projectId: string; name: string | null; email: string | null };

/** Snapshot associations are exact role IDs, never inferred from role name. */
export function readRoleAssignments(roleId: string, limit = 200): { total: number | null; users: RoleUserAssignment[]; partial: boolean } {
  const table = getTable("admin_project_user_roles");
  if (!table) return { total: null, users: [], partial: false };
  const roleCol = column(table, "role_id");
  const userCol = column(table, "user_id");
  const projectCol = column(table, "project_id", "bim360_project_id");
  if (!roleCol || !userCol || !projectCol) return { total: null, users: [], partial: false };
  const db = getDb();
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM "${table.sqlName}" WHERE ${roleCol} = ?`)
    .get(roleId) as { count: number }).count);
  const rows = db.prepare(`SELECT ${userCol} AS user_id, ${projectCol} AS project_id
    FROM "${table.sqlName}" WHERE ${roleCol} = ? ORDER BY ${projectCol}, ${userCol} LIMIT ?`)
    .all(roleId, Math.min(Math.max(limit, 1), 1000)) as Array<{ user_id: string; project_id: string }>;
  const names = new Map<string, { name: string | null; email: string | null }>();
  const usersTable = getTable("admin_users");
  if (usersTable && rows.length) {
    const idCol = column(usersTable, "id", "user_id");
    const nameCol = column(usersTable, "name");
    const firstCol = column(usersTable, "first_name");
    const lastCol = column(usersTable, "last_name");
    const emailCol = column(usersTable, "email");
    if (idCol) {
      const ids = [...new Set(rows.map((row) => String(row.user_id)))];
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const found = db.prepare(`SELECT ${idCol} AS id, ${nameCol ?? "NULL"} AS name,
          ${firstCol ?? "NULL"} AS first_name, ${lastCol ?? "NULL"} AS last_name,
          ${emailCol ?? "NULL"} AS email FROM "${usersTable.sqlName}"
          WHERE ${idCol} IN (${batch.map(() => "?").join(",")})`).all(...batch) as
          Array<{ id: string; name: string | null; first_name: string | null; last_name: string | null; email: string | null }>;
        for (const user of found) names.set(String(user.id), {
          name: user.name || [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
          email: user.email || null,
        });
      }
    }
  }
  return { total: table.truncated ? null : total, partial: table.truncated,
    users: rows.map((row) => ({ userId: String(row.user_id), projectId: String(row.project_id),
      name: names.get(String(row.user_id))?.name ?? null, email: names.get(String(row.user_id))?.email ?? null })) };
}
