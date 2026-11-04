import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems, env } from "@/lib/env";
import { listAccessMatrix, PEOPLE_PAGE_SIZE } from "@/lib/people";
import { DemoActionCenter } from "@/components/DemoActionCenter";
import type { DemoMember } from "@/lib/demoSimulation";
import { cachedProjects } from "@/lib/aps/admin";
import { fetchCompanies, PRODUCT_ACCESS_OPTIONS, PROJECT_TYPES, type Company } from "@/lib/aps/hubAdmin";
import { readRoleDirectory } from "@/lib/organization";
import { memberFollowUpPreset } from "@/lib/recipes";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { Card } from "@/components/ui";
import {
  AddMembersPanel,
  ArchiveProjectsPanel,
  CreateProjectsPanel,
  RemoveMembersPanel,
  Tabs,
} from "@/components/ManagePanels";
import { ActionForm } from "@/components/ActionForm";
import { CompaniesPanel, RolesPanel } from "@/components/OrganizationPanels";
import { refreshProjects } from "../actions";

export const dynamic = "force-dynamic";

export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;
  if (env.demoMode && session.mode === "demo") {
    const members = new Map<string, DemoMember>();
    const first = listAccessMatrix({ page: 1 });
    const rows = [...first.rows];
    for (let page = 2; page <= Math.ceil(first.total / PEOPLE_PAGE_SIZE); page++) {
      rows.push(...listAccessMatrix({ page }).rows);
    }
    for (const row of rows) {
      if (!row.email || !row.projectId) continue;
      const member = members.get(row.email) ?? { email: row.email, name: row.userName ?? row.email, projectIds: [] };
      if (!member.projectIds.includes(row.projectId)) member.projectIds.push(row.projectId);
      members.set(row.email, member);
    }
    const query = await searchParams;
    return <DemoActionCenter initial={{ projects: cachedProjects().map(({ id, name, status }) => ({ id, name, status: status ?? "unknown" })), members: [...members.values()] }}
      initialTask={typeof query.task === "string" ? query.task : undefined}
      initialEmail={typeof query.email === "string" ? query.email.slice(0, 254) : undefined}
      productOptions={PRODUCT_ACCESS_OPTIONS.map((option) => ({ key: option.label, label: option.label }))} />;
  }
  if (session.hubRole !== "hub_admin") {
    return <Card title="Hub Admin access required">
      <p className="text-sm text-adsk-gray">Executive Overview access can view portfolio reports. Hub management actions require Hub Admin access.</p>
    </Card>;
  }

  const params = await searchParams;
  const recipeParam = params.recipe;
  const recipeId = typeof recipeParam === "string" && /^[0-9a-f-]{36}$/i.test(recipeParam)
    ? recipeParam : null;
  const requestedTask = typeof params.task === "string" ? params.task : undefined;
  const preset = recipeId ? memberFollowUpPreset(session, recipeId) : null;
  const invalidRecipe = recipeParam !== undefined && preset === null;

  const projects = cachedProjects().map((p) => ({ id: p.id, name: p.name, status: p.status }));
  const activeCount = projects.filter((p) => p.status === "active").length;

  let companies: Company[] = [];
  let companyError: string | null = null;
  try {
    companies = await fetchCompanies(session);
  } catch (error) {
    companyError = error instanceof Error ? error.message : String(error);
  }

  const roles = readRoleDirectory();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-legend text-2xl text-adsk-black">Admin action center</h1>
          <p className="mt-1 max-w-3xl text-sm text-adsk-gray">
            Plan and review hub changes, then verify the results. Executed actions write to your live hub.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/closeout/profiles" className="text-xs text-adsk-link hover:underline">Turnover profiles →</Link>
          <Link href="/manage/audit" className="text-xs text-adsk-link hover:underline">Administrative audit →</Link>
          <ActionForm action={refreshProjects} label="Sync projects" pendingLabel="Syncing…" />
        </div>
      </div>

      {projects.length === 0 && (
        <p className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-2.5 text-xs text-adsk-black">
          No projects cached yet — press <strong>Sync projects</strong> so the pickers below have
          something to work with.
        </p>
      )}

      {invalidRecipe && (
        <p role="alert" className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-2.5 text-xs text-adsk-black">
          This recipe is unavailable for your Autodesk account. Choose one from Recipes or start a new Manage preview.
        </p>
      )}

      <ol aria-label="Administrative change process" className="flex flex-wrap gap-2 text-xs text-adsk-gray">
        {["Configure", "Preview", "Confirm", "Execute", "Verify in audit"].map((step, index) =>
          <li key={step} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5">
            <span className="mr-1 font-medium text-adsk-black">{index + 1}.</span>{step}
          </li>)}
      </ol>

      <div className="rounded border border-adsk-lightgray bg-adsk-white p-5">
        <Tabs
          key={`${requestedTask ?? "add"}:${preset ? `${preset.id}:${preset.updatedAt}` : "manual"}`}
          defaultActive={requestedTask}
          links={[
            { group: "People", label: "Review people & access", href: "/people" },
            { group: "Projects", label: "Provisioning recipes", href: "/recipes" },
            { group: "History", label: "Administrative audit", href: "/manage/audit" },
          ]}
          tabs={[
            {
              id: "add",
              group: "People",
              label: "Add members & access",
              content: (
                <AddMembersPanel
                  key={preset ? `${preset.id}:${preset.updatedAt}` : "manual"}
                  projects={projects}
                  companies={companies.map((c) => ({ id: c.id, name: c.name ?? c.id }))}
                  productOptions={PRODUCT_ACCESS_OPTIONS}
                  roleOptions={roles.roles.filter((role) => role.status === "active").map((role) => ({ id: role.id, name: role.name, projectIds: role.projectIds }))}
                  roleSourceReady={roles.rolesAssignable}
                  preset={preset}
                />
              ),
            },
            {
              id: "remove",
              group: "People",
              label: "Remove members",
              content: <RemoveMembersPanel projects={projects} />,
            },
            {
              id: "projects",
              group: "Projects",
              label: "Create projects",
              content: <CreateProjectsPanel projectTypes={PROJECT_TYPES} />,
            },
            {
              id: "archive",
              group: "Projects",
              label: `Archive projects (${activeCount})`,
              content: <ArchiveProjectsPanel projects={projects} />,
            },
            {
              id: "companies",
              group: "Organization",
              label: `Companies (${companies.length})`,
              content: <CompaniesPanel companies={companies} error={companyError} />,
            },
            {
              id: "roles",
              group: "Organization",
              label: `Roles (${roles.roles.length})`,
              content: <RolesPanel directory={roles} />,
            },
          ]}
        />
      </div>
    </div>
  );
}
