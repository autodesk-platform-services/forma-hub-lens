import Link from "next/link";
import { DemoWatchButton } from "@/components/DemoPreferences";
import { savedViewsOwner } from "@/lib/savedViews";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/aps/auth";
import { fetchProjectUsers, type ProjectUser } from "@/lib/aps/hubAdmin";
import { configProblems } from "@/lib/env";
import { resolveUserIdentities, type UserIdentity } from "@/lib/entityProfiles";
import { serviceLabel } from "@/lib/activityPresentation";
import { archiveAssessment, governanceFindings, projectEvidence } from "@/lib/governance";
import { Card, Pill, Stat, formatDate, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { demoProjectMembers } from "@/lib/demoData";

export const dynamic = "force-dynamic";

export default async function ProjectScorecardPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const { id } = await params;
  const item = projectEvidence().find((row) => row.project.id.toLowerCase() === id.toLowerCase());
  if (!item) notFound();
  const { project, activity } = item;
  const demoMode = session.mode === "demo";
  const sampleMembers = demoMode ? demoProjectMembers(project.id) : [];
  const query = await searchParams;
  const liveRequested = !demoMode && query.live === "1" && session.hubRole === "hub_admin";
  let liveMembers: ProjectUser[] | null = null;
  let liveError: string | null = null;
  let checkedAt: number | null = null;
  if (liveRequested) {
    try {
      liveMembers = await fetchProjectUsers(session, project.id);
      checkedAt = Date.now();
    } catch (error) {
      liveError = error instanceof Error ? error.message : "Could not load current project members.";
    }
  }
  const liveIdentities = liveMembers
    ? resolveUserIdentities(liveMembers.flatMap((member) => [member.id, member.autodeskId].filter((id): id is string => Boolean(id))))
    : new Map();
  const archive = archiveAssessment(item);
  const review = governanceFindings().findings.filter((finding) => finding.projectId === project.id);

  return <div className="space-y-5">
    <div id="project-overview" className="scroll-mt-20">
      <Link href="/projects" className="text-xs text-adsk-link hover:underline">← Projects</Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="font-legend text-2xl text-adsk-black">{project.name}</h1>
        <DemoWatchButton owner={savedViewsOwner(session)} kind="project" targetId={project.id} label={project.name ?? project.id} />
        <Pill tone={project.status === "active" ? "good" : "default"}>{project.status ?? "Unknown status"}</Pill>
      </div>
      <p className="mt-1 font-mono text-xs text-adsk-gray">{project.id}</p>
      <p className="mt-2 max-w-3xl text-sm text-adsk-gray">{demoMode
        ? "Synthetic project scorecard with sample activity, administration, workflow, and lifecycle evidence. No value here reflects a live Autodesk project."
        : "Portfolio scorecard with separate activity, administration, data, workflow, and lifecycle evidence. Counts describe loaded data and are not a live clearance check."}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <Link href={`/people?view=matrix&project=${encodeURIComponent(project.id)}`} className="text-adsk-link hover:underline">Explore people and access →</Link>
        <Link href={`/permissions?project=${encodeURIComponent(project.id)}`} className="text-adsk-link hover:underline">Inspect Docs permissions →</Link>
      </div>
    </div>

    <nav aria-label="Project workspace" className="flex flex-wrap gap-1.5 rounded-lg border border-adsk-lightgray bg-adsk-white p-2 text-xs">
      <Link href="#project-overview" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Overview</Link>
      <Link href="#project-people" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">People</Link>
      <Link href={`/activity?project=${encodeURIComponent(project.id)}`} className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Activity</Link>
      <Link href="/tools" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Tools</Link>
      <Link href={`/permissions?project=${encodeURIComponent(project.id)}`} className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Permissions</Link>
      <Link href="#project-governance" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Governance</Link>
      <Link href="#project-data" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Data</Link>
      <Link href={`/closeout/${encodeURIComponent(project.id)}`} className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Closeout</Link>
      <Link href={`/integrations/schema?project=${encodeURIComponent(project.id)}`} className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Integration readiness</Link>
      <span className="basis-full px-2 text-[11px] text-adsk-gray">{demoMode
        ? "Sample Tools dashboards show the synthetic portfolio; they do not inherit this project selection."
        : "Tools dashboards currently show portfolio-wide uploads; they do not inherit this project selection."}</span>
    </nav>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Observed events" value={activity || item.activityCoverage.scopeKnown ? String(activity?.events ?? 0) : "Unknown"} hint={demoMode ? "Synthetic activity window" : "In ingested activity window"} />
      <Stat label="Observed people" value={activity || item.activityCoverage.scopeKnown ? String(activity?.actors ?? 0) : "Unknown"} hint={demoMode ? "Sample actors" : "Distinct actors in extracts"} />
      <Stat label={demoMode ? "Sample members" : "Project members"} value={project.memberCount?.toLocaleString() ?? "Unknown"} hint={demoMode ? "Distinct synthetic people" : "Last hub sync"} />
      <Stat label="Days since observed event" value={item.daysSinceObservedEvent?.toLocaleString() ?? "Unknown"} hint={demoMode ? "Synthetic activity coverage" : "Depends on extract coverage"} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Adoption">
        <dl className="space-y-2 text-xs">
          <Row label="Services observed" value={item.observedServices.length ? item.observedServices.map(serviceLabel).join(", ") : "None in loaded activity"} />
          <Row label="Last observed event" value={formatDateTime(item.lastObservedEventAt)} />
          <Row label="Sheets" value={project.sheetCount?.toLocaleString() ?? "Unknown"} />
          <Row label="Recent 14 days" value={item.trend.available ? item.trend.current!.toLocaleString() : "Unavailable"} />
          <Row label="Prior 14 days" value={item.trend.available ? item.trend.previous!.toLocaleString() : "Unavailable"} />
        </dl>
        <p className="mt-2 text-xs text-adsk-gray">{item.trend.reason}{item.trend.available && <> Compared over {item.trend.periodStart} to {item.trend.periodEnd}.</>}</p>
        <Link href={`/activity?project=${encodeURIComponent(project.id)}`} className="mt-3 inline-block text-xs text-adsk-link hover:underline">Investigate activity →</Link>
      </Card>
      <Card title="Administration">
        <dl className="space-y-2 text-xs">
          <Row label="Job number" value={project.jobNumber || "Missing"} />
          <Row label="Type" value={project.type || "Unknown"} />
          <Row label="Companies" value={project.companyCount?.toLocaleString() ?? "Unknown"} />
          <Row label={demoMode ? "Sample inventory time" : "Last hub sync"} value={formatDateTime(project.syncedAt)} />
        </dl>
      </Card>
      <div id="project-data" className="scroll-mt-20"><Card title="Data completeness">
        <dl className="space-y-2 text-xs">
          <Row label="Project activity ingested" value={formatDateTime(item.activityCoverage.latestIngestedAt)} />
          <Row label="Observed extract range" value={`${item.activityCoverage.earliestWindow ?? "unknown"} → ${item.activityCoverage.latestWindow ?? "unknown"}`} />
          <Row label="Project-scoped windows" value={String(item.activityCoverage.windowCount)} />
          <Row label={demoMode ? "Sample project inventory" : "Project admin sync"} value={formatDateTime(project.syncedAt)} />
        </dl>
        <p className="mt-2 text-xs text-adsk-gray">The range may contain gaps. It only includes jobs whose stored request definition includes this project.</p>
        {item.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-adsk-linkvisited">{item.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </Card></div>
      <Card title="Workflow backlog and lifecycle">
        <dl className="space-y-2 text-xs">
          <Row label="End date" value={formatDate(item.endDate)} />
          <Row label="Archive status" value={project.status ?? "Unknown"} />
          {item.workflowBacklog.map((backlog) => <Row key={backlog.key} label={`Observed open ${backlog.label.toLowerCase()}`} value={backlog.observedOpen === null ? "Unavailable" : `${backlog.observedOpen.toLocaleString()} · ${demoMode ? "sample" : "upload"} ${formatDateTime(backlog.uploadedAt)}`} />)}
        </dl>
        {item.workflowBacklog.some((backlog) => backlog.caveat) && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-adsk-gray">{item.workflowBacklog.filter((backlog) => backlog.caveat).map((backlog) => <li key={backlog.key}>{backlog.label}: {backlog.caveat}</li>)}</ul>}
        <p className="mt-3 text-xs text-adsk-gray">{demoMode
          ? "Open counts use project IDs and statuses in synthetic sample tables. This archive review is an example only."
          : "Open counts use project IDs and known statuses in uploaded Data Connector tables. Confirm live work in Forma before deciding to archive."}</p>
      </Card>
    </div>

    {demoMode && <div id="project-people" className="scroll-mt-20"><Card title="Sample project people" subtitle="Distinct synthetic people linked by exact sample project and user IDs">
      <p className="mb-3 text-xs text-adsk-gray">These fictional memberships illustrate project access. No current Autodesk membership lookup is performed.</p>
      {sampleMembers.length ? <div className="max-h-[30rem] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-adsk-white text-[11px] uppercase tracking-wide text-adsk-gray"><tr className="border-b border-adsk-lightgray"><th className="py-2 pr-3">Person</th><th className="py-2 pr-3">Sample access</th><th className="py-2 pr-3">Company</th><th className="py-2">Sample products</th></tr></thead><tbody>
        {sampleMembers.map((member) => <tr key={member.id} className="border-b border-adsk-offwhite align-top">
          <td className="py-2 pr-3"><Link href={`/people/${encodeURIComponent(member.id)}`} className="font-medium text-adsk-link hover:underline">{member.name}</Link>{member.email && <div className="text-adsk-gray">{member.email}</div>}</td>
          <td className="py-2 pr-3">{member.accessLevel}</td>
          <td className="py-2 pr-3">{member.companyId ? <Link href={`/companies/${encodeURIComponent(member.companyId)}`} className="text-adsk-link hover:underline">{member.companyName}</Link> : "—"}</td>
          <td className="py-2">{member.products.join(", ") || "Not modeled"}</td>
        </tr>)}
      </tbody></table></div> : <p className="text-xs text-adsk-gray">No sample people are linked to this project.</p>}
    </Card></div>}
    {!demoMode && session.hubRole === "hub_admin" && <div id="project-people" className="scroll-mt-20"><Card title="Current project members" subtitle="On-demand Forma Admin API read">
      <p className="text-xs text-adsk-gray">The snapshot member count above may differ from current project access. Open this live check when reviewing a project or a person.</p>
      <Link href={`/projects/${encodeURIComponent(project.id)}?live=1`} className="mt-3 inline-block rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-xs text-adsk-link hover:underline">{liveRequested ? "Refresh current members" : "Check current members"}</Link>
      {checkedAt && <p className="mt-2 text-xs text-adsk-gray">Checked {formatDateTime(checkedAt)} · {liveMembers?.length.toLocaleString()} members returned</p>}
      {liveError && <p role="alert" className="mt-2 text-xs text-adsk-linkvisited">{liveError}</p>}
      {liveMembers && <div className="mt-3 max-h-[30rem] overflow-auto">
        {liveMembers.length ? <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-adsk-white text-[11px] uppercase tracking-wide text-adsk-gray"><tr className="border-b border-adsk-lightgray"><th className="py-2 pr-3">Person</th><th className="py-2 pr-3">Access</th><th className="py-2 pr-3">Company</th><th className="py-2">Products</th></tr></thead><tbody>
          {liveMembers.slice(0, 200).map((member) => <tr key={member.id} className="border-b border-adsk-offwhite align-top">
            <td className="py-2 pr-3"><Link href={memberHref(member, liveIdentities)} className="font-medium text-adsk-link hover:underline">{member.name ?? member.email ?? member.id}</Link>{member.email && <div className="text-adsk-gray">{member.email}</div>}</td>
            <td className="py-2 pr-3">{Object.entries(member.accessLevels ?? {}).filter(([, enabled]) => enabled).map(([level]) => level).join(", ") || "—"}</td>
            <td className="py-2 pr-3">{member.companyId ? <Link href={`/companies/${encodeURIComponent(member.companyId)}`} className="text-adsk-link hover:underline">{member.companyName ?? member.companyId}</Link> : "—"}</td>
            <td className="py-2">{member.products?.map((product) => product.key).join(", ") || "—"}</td>
          </tr>)}
        </tbody></table> : <p className="text-xs text-adsk-gray">No current project members were returned.</p>}
        {liveMembers.length > 200 && <p className="mt-2 text-xs text-adsk-gray">Showing first 200 of {liveMembers.length.toLocaleString()} members.</p>}
      </div>}
    </Card></div>}
    {!demoMode && session.hubRole !== "hub_admin" && <div id="project-people" className="scroll-mt-20"><Card title="People">Current project membership requires Hub Admin access. The count above is from the latest hub sync.</Card></div>}

    <Card title="Archive review">
      {archive.blockers.length > 0 ? <div className="text-xs"><strong className="text-adsk-linkvisited">Observed blockers</strong><ul className="mt-1 list-disc pl-4">{archive.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div> : <p className="text-xs text-adsk-gray">{demoMode ? "No sample open workflow item matched. This is not a real closeout decision." : "No open workflow item was observed in the available uploads. This does not confirm closeout."}</p>}
      <strong className="mt-3 block text-xs">Checks before archiving</strong>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-adsk-gray">{archive.checks.map((check) => <li key={check}>{check}</li>)}</ul>
      {(session.hubRole === "hub_admin" || demoMode) && <Link href={demoMode ? "/manage?task=archive" : "/manage"} className="mt-3 inline-block text-xs text-adsk-link hover:underline">{demoMode ? "Open simulated archive preview →" : "Open Manage, then Archive projects →"}</Link>}
    </Card>

    <div id="project-governance" className="scroll-mt-20"><Card title={`Governance review (${review.length})`}>
      {review.length ? <ul className="space-y-2">{review.map((finding) => <li key={finding.key} className="rounded border border-adsk-lightgray px-3 py-2 text-xs">
        <strong>{finding.label}</strong><p className="mt-1 text-adsk-gray">{finding.explanation}</p>
      </li>)}</ul> : <p className="text-xs text-adsk-gray">No current rule matched this project.</p>}
      <Link href="/governance" className="mt-3 inline-block text-xs text-adsk-link hover:underline">Open governance review →</Link>
    </Card></div>
  </div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><dt className="shrink-0 text-adsk-gray">{label}</dt><dd className="text-right text-adsk-black">{value}</dd></div>;
}

function memberHref(member: ProjectUser, identities: Map<string, UserIdentity>): string {
  const byId = identities.get(member.id);
  const byAutodesk = member.autodeskId ? identities.get(member.autodeskId) : undefined;
  const person = byId && byAutodesk && byId.sourceId !== byAutodesk.sourceId
    ? null : byId ?? byAutodesk;
  return person
    ? `/people/${encodeURIComponent(person.sourceId)}`
    : `/people?q=${encodeURIComponent(member.email ?? member.id)}`;
}
