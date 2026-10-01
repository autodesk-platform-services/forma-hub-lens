import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/aps/auth";
import { cachedProjects } from "@/lib/aps/admin";
import { fetchCompanies } from "@/lib/aps/hubAdmin";
import { companyActivity, companySnapshot, localCompany } from "@/lib/entityProfiles";
import { configProblems } from "@/lib/env";
import { Card, EmptyState, Stat, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const { id } = await params;
  if (id.length > 200) notFound();

  let company: Awaited<ReturnType<typeof fetchCompanies>>[number] | undefined;
  let liveError: string | null = null;
  try {
    company = (await fetchCompanies(session)).find((item) => item.id === id);
  } catch (error) {
    liveError = error instanceof Error ? error.message : "Autodesk company lookup failed.";
  }
  const snapshot = companySnapshot(id);
  const activity = companyActivity(id);
  const local = localCompany(id);
  const syncedProjectIds = new Set(cachedProjects().map((project) => project.id.toLowerCase()));
  if (!company && !liveError && local.state !== "found" && (snapshot.userCount ?? 0) === 0) notFound();

  return <div className="space-y-5">
    <div>
      <Link href="/people" className="text-xs text-adsk-link hover:underline">← People and access</Link>
      <h1 className="mt-2 font-legend text-2xl text-adsk-black">{company?.name ?? (local.state === "found" ? local.company.name : null) ?? id}</h1>
      <p className="mt-1 font-mono text-xs text-adsk-gray">{id}</p>
      <p className="mt-2 max-w-3xl text-sm text-adsk-gray">Company profile combining current Forma company metadata with relationships observed in uploaded Data Connector admin tables.</p>
    </div>

    <nav aria-label="Company workspace" className="flex flex-wrap gap-1.5 rounded-lg border border-adsk-lightgray bg-adsk-white p-2 text-xs">
      <Link href="#company-people" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">People</Link>
      <Link href="#company-projects" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Projects</Link>
      <Link href="#company-roles" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Roles</Link>
      <Link href="#company-activity" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Activity</Link>
      <Link href="#company-permissions" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Permissions</Link>
    </nav>

    {liveError && <div role="alert" className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs">Current Forma company metadata could not be loaded: {liveError}</div>}
    {!company && local.state === "ambiguous" && <div role="alert" className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs">The uploaded company table has duplicate rows for this ID. Lens will not choose a company label from them.</div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="People in upload" value={snapshot.userCount?.toLocaleString() ?? "Unknown"} hint="Exact company ID in admin_users.csv" />
      <Stat label="Projects represented" value={snapshot.projectCount?.toLocaleString() ?? "Unknown"} hint="Via uploaded membership rows" />
      <Stat label="Forma user count" value={company?.userSize?.toLocaleString() ?? "Unknown"} hint="Current Admin API value" />
      <Stat label="Forma project count" value={company?.projectSize?.toLocaleString() ?? "Unknown"} hint="Current Admin API value" />
    </div>

    <Card title="Company details" subtitle={company ? "Current Forma Admin API" : local.state === "found" ? `Uploaded admin_companies.csv · imported ${formatDateTime(local.company.uploadedAt)}${local.company.truncated ? " · truncated" : ""}` : "Current details unavailable"}>
      {company ? <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Status" value={company.status} />
        <Field label="Trade" value={company.trade} />
        <Field label="City" value={company.city} />
        <Field label="Country" value={company.country} />
        <Field label="Website" value={company.websiteUrl} />
      </dl> : local.state === "found" ? <><dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Status" value={local.company.status} />
        <Field label="Trade" value={local.company.trade} />
        <Field label="City" value={local.company.city} />
        <Field label="Country" value={local.company.country} />
        <Field label="Website" value={local.company.websiteUrl} />
      </dl><p className="mt-3 text-xs text-adsk-gray">This is a local upload snapshot; current company status and details have not been verified.</p></>
        : <EmptyState title="Current company details unavailable.">No unambiguous matching company row was found in the uploaded table. The local relationships below may still be inspected.</EmptyState>}
    </Card>

    <div role="note" className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs">
      People and project relationships below are local snapshots, not current access. Company IDs must match exactly.
      {snapshot.sources.map((source) => <span key={source.name} className="ml-2">{source.name}.csv imported {formatDateTime(source.uploadedAt)}{source.truncated ? " (truncated)" : ""}.</span>)}
      {!snapshot.available && " Upload admin_users.csv with a company ID column to show relationships."}
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <div id="company-people" className="scroll-mt-20"><Card title={`People (${snapshot.userCount?.toLocaleString() ?? "unknown"})`} subtitle="First 100 in the uploaded company assignment">
        {snapshot.users.length ? <ul className="max-h-[28rem] space-y-1 overflow-auto text-xs">{snapshot.users.map((person) => <li key={person.id} className="rounded border border-adsk-lightgray px-3 py-2">
          <Link href={`/people/${encodeURIComponent(person.id)}`} className="font-medium text-adsk-link hover:underline">{person.name ?? person.email ?? person.id}</Link>
          {person.email && <span className="ml-2 text-adsk-gray">{person.email}</span>}
        </li>)}</ul> : <EmptyState title="No people in the available snapshot." />}
      </Card></div>
      <div id="company-projects" className="scroll-mt-20"><Card title={`Projects (${snapshot.projectCount?.toLocaleString() ?? "unknown"})`} subtitle="First 100 by observed company membership">
        {snapshot.projects.length ? <ul className="max-h-[28rem] space-y-1 overflow-auto text-xs">{snapshot.projects.map((project) => <li key={project.id} className="flex items-center justify-between gap-3 rounded border border-adsk-lightgray px-3 py-2">
          {syncedProjectIds.has(project.id.toLowerCase()) ? <Link href={`/projects/${encodeURIComponent(project.id)}`} className="text-adsk-link hover:underline">{project.name ?? project.id}</Link> : <span>{project.name ?? project.id} <span className="text-adsk-gray">(not in synced inventory)</span></span>}
          <span className="shrink-0 text-adsk-gray">{project.people.toLocaleString()} people</span>
        </li>)}</ul> : <EmptyState title="No project memberships in the available snapshot." />}
      </Card></div>
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <div id="company-roles" className="scroll-mt-20"><Card title="Roles">
        <p className="text-xs text-adsk-gray">The uploaded <code>admin_project_roles.csv</code> lists role definitions. It does not establish which role each company member holds, so company role counts are unavailable.</p>
        {snapshot.users.length ? <div className="mt-3 text-xs"><p className="font-medium">Check current roles for a person</p><div className="mt-2 flex flex-wrap gap-2">{snapshot.users.slice(0, 6).map((person) => <Link key={person.id} href={`/people/${encodeURIComponent(person.id)}`} className="rounded border border-adsk-lightgray px-2 py-1 text-adsk-link hover:underline">{person.name ?? person.email ?? person.id}</Link>)}</div></div>
          : <p className="mt-3 text-xs text-adsk-gray">Upload company and user records to navigate to a person.</p>}
      </Card></div>

      <div id="company-activity" className="scroll-mt-20"><Card title="Activity" subtitle="Observed local extract events">
        {activity.available ? <dl className="space-y-2 text-xs">
          <Field label="Matched events" value={activity.events?.toLocaleString()} />
          <Field label="Projects with matched events" value={activity.projectCount?.toLocaleString()} />
          <Field label="Last matched event" value={formatDateTime(activity.lastObservedAt)} />
          <Field label="Activity data through" value={formatDateTime(activity.activityDataThrough)} />
        </dl> : <p className="text-xs text-adsk-gray">Unavailable: the uploaded user table needs a company ID plus an Autodesk ID or email for an exact activity join.</p>}
        <p className="mt-3 text-xs text-adsk-gray">Matches use unique company-linked user IDs or emails in the uploaded user table. Mixed or incomplete uploads can omit events; no match does not establish inactivity.</p>
        <Link href="/activity" className="mt-2 inline-block text-xs text-adsk-link hover:underline">Explore activity by person or project →</Link>
      </Card></div>

      <div id="company-permissions" className="scroll-mt-20"><Card title="Docs permissions">
        <p className="text-xs text-adsk-gray">Inspect folder assignments in a project associated with this company. Lens does not calculate effective company-wide access or inherit this company as a filter in the permission explorer.</p>
        <div className="mt-3 flex flex-wrap gap-2">{snapshot.projects.filter((project) => syncedProjectIds.has(project.id.toLowerCase())).slice(0, 8).map((project) => <Link key={project.id} href={`/permissions?project=${encodeURIComponent(project.id)}`} className="rounded border border-adsk-lightgray px-2 py-1 text-xs text-adsk-link hover:underline">{project.name ?? project.id}</Link>)}</div>
        <Link href="/permissions" className="mt-3 inline-block text-xs text-adsk-link hover:underline">Open permission explorer →</Link>
      </Card></div>
    </div>
  </div>;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><dt className="font-medium uppercase tracking-wide text-adsk-gray">{label}</dt><dd className="mt-1 break-all text-adsk-black">{value || "—"}</dd></div>;
}
