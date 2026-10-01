import { requireHubAdminSession } from "@/lib/aps/auth";
import { csvCell } from "@/lib/csvExport";
import { readRoleDirectory } from "@/lib/organization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try { await requireHubAdminSession(); }
  catch { return new Response("Hub Admin access required", { status: 403 }); }
  const requested = new URL(request.url).searchParams.get("roleId");
  if (requested && requested.length > 200) return new Response("Invalid role ID", { status: 400 });
  const directory = readRoleDirectory();
  const roles = requested ? directory.roles.filter((role) => role.id === requested) : directory.roles;
  if (requested && !roles.length) return new Response("Role ID not found in the local snapshot", { status: 404 });
  const rows = ["role_id,role_name,status,project_id,role_unique_people_in_snapshot,source_table,source_imported_at,source_truncated,source_trusted"];
  for (const role of roles) for (const projectId of role.projectIds.length ? role.projectIds : [""]) {
    rows.push([role.id, role.name, role.status, projectId, role.userCount ?? "", directory.tableName ?? "",
      directory.uploadedAt ? new Date(directory.uploadedAt).toISOString() : "",
      directory.truncated ? "true" : "false", directory.trusted ? "true" : "false"].map((value) => csvCell(String(value))).join(","));
  }
  return new Response(rows.join("\r\n") + "\r\n", { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="forma-hub-lens-roles-${requested ? "selected" : "inventory"}.csv"`,
    "Cache-Control": "no-store",
  } });
}
