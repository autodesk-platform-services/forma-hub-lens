import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { requireAccountAdmin } from "@/lib/aps/hubAdmin";
import { cachedProjects } from "@/lib/aps/admin";
import { inspectOffboarding, normaliseTargetEmail, projectRemovalIds, type OffboardingAssociation, type OffboardingSummary } from "@/lib/offboarding";
import { configProblems } from "@/lib/env";
import { Card, EmptyState, Pill, formatDateTime } from "@/components/ui";
import { OffboardingRemovePanel } from "@/components/OffboardingRemovePanel";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { ActionForm } from "@/components/ActionForm";
import { refreshProjects } from "@/app/actions";

export const dynamic = "force-dynamic";

function namesForProject(items: OffboardingAssociation[], projectId: string): string {
  return items.filter((item) => item.projectIds?.includes(projectId))
    .map((item) => item.name ?? item.key ?? item.id ?? "Unnamed")
    .join(", ") || "—";
}

export default async function OffboardingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const params = await searchParams;
  const input = typeof params.email === "string" ? params.email.slice(0, 256) : "";
  if (session.hubRole !== "hub_admin") return <Card title="Hub Admin access required"><p className="text-sm text-adsk-gray">This access investigation is available to Hub Admins. Executive Overview can use the read-only People snapshot.</p></Card>;

  let summary: OffboardingSummary | null = null;
  let error: string | null = null;
  if (input) {
    try {
      const email = normaliseTargetEmail(input);
      await requireAccountAdmin(session);
      summary = await inspectOffboarding(session, email);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "The access investigation failed.";
    }
  }

  const cached = new Set(cachedProjects().map((project) => project.id.toLowerCase()));
  const removableIds = summary ? projectRemovalIds(summary.projects).filter((id) => cached.has(id.toLowerCase())) : [];
  const notCached = summary ? projectRemovalIds(summary.projects).length - removableIds.length : 0;
  const batches: string[][] = [];
  for (let offset = 0; offset < removableIds.length; offset += 50) batches.push(removableIds.slice(offset, offset + 50));

  return <div className="space-y-5">
    <div>
      <h1 className="font-legend text-2xl text-adsk-black">Offboarding and access cleanup</h1>
      <p className="mt-1 max-w-3xl text-sm text-adsk-gray">Inspect a person&apos;s current project, product, and role associations in Autodesk before planning project membership removal.</p>
    </div>
    <Card title="Find a hub member" subtitle="Exact email match in the live Autodesk account directory">
      <form method="get" action="/offboarding" className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-adsk-gray">Email address
          <input type="email" name="email" required maxLength={255} defaultValue={input} className="mt-1 block w-80 max-w-full rounded border border-adsk-lightgray px-3 py-1.5 text-sm text-adsk-black" />
        </label>
        <button type="submit" className="rounded border border-adsk-gold bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black">Inspect access</button>
      </form>
      {error && <p role="alert" className="mt-3 rounded border border-adsk-linkvisited px-3 py-2 text-xs text-adsk-linkvisited">{error}</p>}
      {input && !summary && !error && <p className="mt-3 text-xs text-adsk-gray">No exact hub member matches this email.</p>}
    </Card>
    {summary && <>
      <Card title={summary.name ?? summary.email} subtitle={`Live access checked ${formatDateTime(summary.checkedAt)}`}>
        <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-adsk-gray">Email</dt><dd className="mt-1 text-adsk-black">{summary.email}</dd></div>
          <div><dt className="text-adsk-gray">Company</dt><dd className="mt-1 text-adsk-black">{summary.company ?? "Unknown"}</dd></div>
          <div><dt className="text-adsk-gray">Hub status</dt><dd className="mt-1 text-adsk-black">{summary.status ?? "Unknown"}</dd></div>
          <div><dt className="text-adsk-gray">Project associations</dt><dd className="mt-1 text-adsk-black">{summary.projects.length}</dd></div>
          <div><dt className="text-adsk-gray">Product associations</dt><dd className="mt-1 text-adsk-black">{summary.products.length}</dd></div>
          <div><dt className="text-adsk-gray">Role associations</dt><dd className="mt-1 text-adsk-black">{summary.roles.length}</dd></div>
          <div><dt className="text-adsk-gray">Last observed activity</dt><dd className="mt-1 text-adsk-black">{formatDateTime(summary.lastObservedActivityAt)}</dd></div>
          <div><dt className="text-adsk-gray">Activity data through</dt><dd className="mt-1 text-adsk-black">{formatDateTime(summary.activityDataThrough)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-adsk-gray">Activity comes from ingested extracts and may be incomplete. No observed event does not establish that a person has been inactive. Project access is live; this check does not deprovision an Autodesk organization account.</p>
      </Card>
      <Card title={`Current project associations (${summary.projects.length})`}>
        {summary.projects.length ? <div className="max-h-[32rem] overflow-auto"><table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-adsk-white text-adsk-gray"><tr className="border-b border-adsk-lightgray"><th className="py-2 pr-3">Project</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Access</th><th className="py-2 pr-3">Products</th><th className="py-2">Roles</th></tr></thead>
          <tbody>{summary.projects.map((project) => <tr key={project.id} className="border-b border-adsk-offwhite align-top">
            <td className="py-2 pr-3">
              {cached.has(project.id.toLowerCase())
                ? <Link href={`/projects/${encodeURIComponent(project.id)}`} className="font-medium text-adsk-link hover:underline">{project.name ?? project.id}</Link>
                : <span className="font-medium text-adsk-black">{project.name ?? project.id} <span className="text-adsk-gray">(not in local project inventory)</span></span>}
              <div className="font-mono text-[10px] text-adsk-gray">{project.id}</div>
            </td>
            <td className="py-2 pr-3"><Pill>{project.status ?? "Unknown"}</Pill></td>
            <td className="py-2 pr-3">{project.accessLevels?.projectAdmin ? "Project Admin" : project.accessLevels?.projectMember ? "Member" : "Unknown"}</td>
            <td className="py-2 pr-3">{namesForProject(summary.products, project.id)}</td>
            <td className="py-2">{namesForProject(summary.roles, project.id)}</td>
          </tr>)}</tbody>
        </table></div> : <EmptyState title="No project associations returned." />}
      </Card>
      <Card title="Removal plan" subtitle="Each batch uses the audited Manage preview and execution workflow">
        <p className="mb-3 text-xs text-adsk-gray">Removal affects project memberships only. Product and role associations shown above are tied to those projects; organization-wide Autodesk User Management must be handled separately. Export the operation record after execution.</p>
        {notCached > 0 && <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs"><span>{notCached} live project{notCached === 1 ? " is" : "s are"} missing from the synced project list. Sync projects before previewing all removals.</span><ActionForm action={refreshProjects} label="Sync projects" pendingLabel="Syncing…" /></div>}
        {batches.length ? <div className="space-y-3">{batches.map((ids, index) => <OffboardingRemovePanel key={index} email={summary.email} projectIds={ids} batch={index + 1} batches={batches.length} />)}</div> : <p className="text-xs text-adsk-gray">No project memberships in the synced hub list are ready for a removal preview.</p>}
      </Card>
    </>}
  </div>;
}
