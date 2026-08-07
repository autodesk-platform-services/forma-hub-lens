import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { cachedProjects } from "@/lib/aps/admin";
import { fetchCompanies, PRODUCT_ACCESS_OPTIONS, PROJECT_TYPES, type Company } from "@/lib/aps/hubAdmin";
import { getTable } from "@/lib/dataset";
import { getDb } from "@/lib/db";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import {
  AddMembersPanel,
  ArchiveProjectsPanel,
  CreateProjectsPanel,
  RemoveMembersPanel,
  Tabs,
} from "@/components/ManagePanels";
import { ActionForm } from "@/components/ActionForm";
import { refreshProjects } from "../actions";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const projects = cachedProjects().map((p) => ({ id: p.id, name: p.name, status: p.status }));
  const activeCount = projects.filter((p) => p.status === "active").length;

  let companies: Company[] = [];
  let companyError: string | null = null;
  try {
    companies = await fetchCompanies(session);
  } catch (error) {
    companyError = error instanceof Error ? error.message : String(error);
  }

  const roles = readRoles();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-legend text-2xl text-adsk-black">Hub management</h1>
          <p className="mt-1 max-w-3xl text-sm text-adsk-gray">
            Bulk membership and project operations against the Forma Admin API. These write to your
            live hub.
          </p>
        </div>
        <ActionForm action={refreshProjects} label="Sync projects" pendingLabel="Syncing…" />
      </div>

      {projects.length === 0 && (
        <p className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-2.5 text-xs text-adsk-black">
          No projects cached yet — press <strong>Sync projects</strong> so the pickers below have
          something to work with.
        </p>
      )}

      <div className="rounded border border-adsk-lightgray bg-adsk-white p-5">
        <Tabs
          tabs={[
            {
              id: "add",
              label: "Add members",
              content: (
                <AddMembersPanel
                  projects={projects}
                  companies={companies.map((c) => ({ id: c.id, name: c.name ?? c.id }))}
                  productOptions={PRODUCT_ACCESS_OPTIONS}
                />
              ),
            },
            {
              id: "remove",
              label: "Remove members",
              content: <RemoveMembersPanel projects={projects} />,
            },
            {
              id: "projects",
              label: "Create projects",
              content: <CreateProjectsPanel projectTypes={PROJECT_TYPES} />,
            },
            {
              id: "archive",
              label: `Archive projects (${activeCount})`,
              content: <ArchiveProjectsPanel projects={projects} />,
            },
            {
              id: "companies",
              label: `Companies (${companies.length})`,
              content: <CompaniesTable companies={companies} error={companyError} />,
            },
            {
              id: "roles",
              label: `Roles (${roles.length})`,
              content: <RolesTable roles={roles} />,
            },
          ]}
        />
      </div>
    </div>
  );
}

function CompaniesTable({ companies, error }: { companies: Company[]; error: string | null }) {
  if (error) {
    return (
      <p className="rounded border border-adsk-lightgray px-4 py-3 text-xs text-adsk-linkvisited">
        Could not load companies: {error}
      </p>
    );
  }
  if (companies.length === 0) {
    return <p className="text-xs text-adsk-gray">No companies returned for this hub.</p>;
  }
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-adsk-white">
          <tr className="border-b border-adsk-lightgray font-legend text-[10px] uppercase tracking-wide text-adsk-gray">
            <th className="py-2 pr-3">Company</th>
            <th className="py-2 pr-3">Trade</th>
            <th className="py-2 pr-3">Location</th>
            <th className="py-2 pr-3 text-right">Projects</th>
            <th className="py-2 pr-3 text-right">Users</th>
            <th className="py-2 pr-3">Status</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {companies.map((company) => (
            <tr key={company.id} className="border-b border-adsk-offwhite">
              <td className="py-1.5 pr-3 text-adsk-black">{company.name ?? "—"}</td>
              <td className="py-1.5 pr-3 text-adsk-gray">{company.trade ?? "—"}</td>
              <td className="py-1.5 pr-3 text-adsk-gray">
                {[company.city, company.country].filter(Boolean).join(", ") || "—"}
              </td>
              <td className="py-1.5 pr-3 text-right text-adsk-gray">{company.projectSize ?? "—"}</td>
              <td className="py-1.5 pr-3 text-right text-adsk-gray">{company.userSize ?? "—"}</td>
              <td className="py-1.5 pr-3 text-adsk-gray">{company.status ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Role = { id: string; name: string; status: string | null; projects: number };

/**
 * The Admin API has no hub-wide "list roles" endpoint, so roles come from the
 * uploaded extract (`admin_project_roles.csv` / `admin_roles.csv`) when present.
 */
function readRoles(): Role[] {
  const table = getTable("admin_project_roles") ?? getTable("admin_roles");
  if (!table) return [];
  const db = getDb();
  const hasProject = table.columns.some((c) => c.sqlName === "bim360_project_id");
  const idCol = table.columns.find((c) => c.sqlName === "role_id" || c.sqlName === "id");
  const nameCol = table.columns.find((c) => c.sqlName === "name");
  if (!idCol || !nameCol) return [];

  try {
    const rows = db
      .prepare(
        `SELECT "${idCol.sqlName}" AS id, "${nameCol.sqlName}" AS name,
                MAX(COALESCE("status", '')) AS status,
                ${hasProject ? `COUNT(DISTINCT "bim360_project_id")` : "1"} AS projects
         FROM "${table.sqlName}"
         WHERE "${nameCol.sqlName}" IS NOT NULL
         GROUP BY id, name ORDER BY name COLLATE NOCASE LIMIT 500`,
      )
      .all() as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      status: (row.status as string) || null,
      projects: Number(row.projects ?? 0),
    }));
  } catch {
    return [];
  }
}

function RolesTable({ roles }: { roles: Role[] }) {
  if (roles.length === 0) {
    return (
      <p className="max-w-prose text-xs text-adsk-gray">
        The Forma Admin API has no hub-wide endpoint that lists roles, so this view reads
        <code className="mx-1 rounded bg-adsk-offwhite px-1">admin_project_roles.csv</code>
        from the uploaded Data Connector extract. Upload an extract that includes the{" "}
        <strong>admin</strong> service group and the roles will appear here.
      </p>
    );
  }
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-adsk-white">
          <tr className="border-b border-adsk-lightgray font-legend text-[10px] uppercase tracking-wide text-adsk-gray">
            <th className="py-2 pr-3">Role</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3 text-right">Projects</th>
            <th className="py-2 pr-3">Role ID</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {roles.map((role) => (
            <tr key={role.id + role.name} className="border-b border-adsk-offwhite">
              <td className="py-1.5 pr-3 text-adsk-black">{role.name}</td>
              <td className="py-1.5 pr-3 text-adsk-gray">{role.status ?? "—"}</td>
              <td className="py-1.5 pr-3 text-right text-adsk-gray">{role.projects}</td>
              <td className="py-1.5 pr-3 font-mono text-[10px] text-adsk-gray">{role.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
