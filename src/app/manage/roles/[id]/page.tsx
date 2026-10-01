import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/aps/auth";
import { cachedProjects } from "@/lib/aps/admin";
import { configProblems } from "@/lib/env";
import { getTable } from "@/lib/dataset";
import { readRoleAssignments, readRoleDirectory } from "@/lib/organization";
import { Card, EmptyState, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";

export const dynamic = "force-dynamic";

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  if (session.hubRole !== "hub_admin") return <Card><EmptyState title="Hub Admin access required." /></Card>;
  const { id } = await params;
  if (!id || id.length > 200) notFound();
  const directory = readRoleDirectory();
  const role = directory.roles.find((item) => item.id === id);
  if (!role) notFound();
  const assignments = readRoleAssignments(id);
  const roleUsersTable = getTable("admin_project_user_roles");
  const projects = new Map(cachedProjects().map((project) => [project.id, project.name]));
  return <div className="space-y-5">
    <div>
      <Link href="/manage?task=roles" className="text-xs text-adsk-link hover:underline">← Roles</Link>
      <h1 className="mt-2 font-legend text-2xl text-adsk-black">{role.name}</h1>
      <p className="mt-1 font-mono text-xs text-adsk-gray">{role.id}</p>
      <p className="mt-2 text-xs text-adsk-gray">Status: {role.status} · {role.projectIds.length} projects · {role.userCount ?? "unknown"} people in snapshot</p>
    </div>
    <div role="note" className="rounded border border-adsk-gold bg-adsk-gold/10 p-3 text-xs">
      Data Connector snapshot: {directory.tableName}.csv imported {formatDateTime(directory.uploadedAt)}{directory.truncated ? " (truncated)" : ""};
      {roleUsersTable ? ` admin_project_user_roles.csv imported ${formatDateTime(roleUsersTable.uploadedAt)}${roleUsersTable.truncated ? " (truncated)" : ""}.` : " user-role assignments unavailable."}
      {directory.trusted ? " Role definitions came from a Lens-ingested APS job." : " Role definition source is unverified."} These associations may have changed in Autodesk.
    </div>
    <Card title={`Projects (${role.projectIds.length})`}>
      {role.projectIds.length ? <ul className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">{role.projectIds.map((projectId) => <li key={projectId} className="rounded border border-adsk-lightgray px-3 py-2">
        {projects.has(projectId) ? <Link href={`/projects/${encodeURIComponent(projectId)}`} className="text-adsk-link hover:underline">{projects.get(projectId)}</Link> : <span>{projectId} <span className="text-adsk-gray">(not in synced inventory)</span></span>}
        <span className="block font-mono text-[10px] text-adsk-gray">{projectId}</span>
      </li>)}</ul> : <p className="text-xs text-adsk-gray">No project associations in the available role definition table.</p>}
    </Card>
    <Card title={`People with this role (${assignments.total ?? "unknown"} project assignments)`} subtitle="Exact role ID in admin_project_user_roles.csv; first 200 rows">
      {assignments.partial && <p className="mb-2 text-xs text-adsk-gray">This table is truncated. Rows shown are a partial snapshot; the total is unknown.</p>}
      {assignments.users.length ? <div className="max-h-[35rem] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-adsk-white"><tr className="border-b border-adsk-lightgray text-[10px] uppercase tracking-wide text-adsk-gray"><th className="py-2 pr-3">Person</th><th className="py-2">Project</th></tr></thead><tbody>{assignments.users.map((item, index) => <tr key={`${item.userId}:${item.projectId}:${index}`} className="border-b border-adsk-offwhite"><td className="py-2 pr-3"><Link href={`/people/${encodeURIComponent(item.userId)}`} className="text-adsk-link hover:underline">{item.name ?? item.email ?? item.userId}</Link>{item.email && <span className="block text-adsk-gray">{item.email}</span>}</td><td className="py-2">{projects.has(item.projectId) ? <Link href={`/projects/${encodeURIComponent(item.projectId)}`} className="text-adsk-link hover:underline">{projects.get(item.projectId)}</Link> : item.projectId}</td></tr>)}</tbody></table></div>
        : assignments.total === null && !assignments.partial ? <p className="text-xs text-adsk-gray">The project user roles table is unavailable or lacks the required columns. Ingest the admin service group to inspect assignments.</p>
          : <p className="text-xs text-adsk-gray">No person assignments for this role ID in the available snapshot rows.</p>}
      {assignments.total !== null && assignments.total > assignments.users.length && <p className="mt-2 text-xs text-adsk-gray">Showing {assignments.users.length} of {assignments.total} assignments.</p>}
    </Card>
    <a href={`/manage/roles/export?roleId=${encodeURIComponent(id)}`} className="text-xs text-adsk-link hover:underline">Export this role&apos;s snapshot inventory CSV →</a>
  </div>;
}
