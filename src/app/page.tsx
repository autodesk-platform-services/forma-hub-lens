import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems, env } from "@/lib/env";
import { cachedProjects } from "@/lib/aps/admin";
import { jobsInLastDay, storedJobs } from "@/lib/aps/dataConnector";
import { isFailedJob, isPendingActivityIngest } from "@/lib/dataHealth";
import { listTables } from "@/lib/dataset";
import { TOOL_SPECS } from "@/lib/dashboards/specs";
import { governanceFindings } from "@/lib/governance";
import { governanceDecisions } from "@/lib/reviewDecisions";
import { toolFavoritesKey } from "@/lib/toolFavorites";
import { listManifests, latestRun } from "@/lib/integrationStore";
import { isIntegrationPreflightStale, type IntegrationPreflight } from "@/lib/integrationAnalysis";
import { closeoutPortfolioStatus } from "@/lib/closeoutPortfolio";
import { countByDay, coverage, topActions, topActors, topProjects, topServices } from "@/lib/queries";
import { BarList, Card, DailyChart, EmptyState, Stat, formatDateTime, relativeTime } from "@/components/ui";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { FavoriteTools } from "@/components/FavoriteTools";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { ActionForm } from "@/components/ActionForm";
import { listSavedViews, listWatchItems, savedViewsOwner } from "@/lib/savedViews";
import { refreshJobs, refreshProjects } from "./actions";

export const dynamic = "force-dynamic";

type AttentionItem = {
  key: string; value: string; title: string; detail: string;
  href: string; action: string; tone: "warn" | "bad";
};
const STALE_AFTER_MS = 72 * 60 * 60 * 1000; // Lens review threshold, not an Autodesk SLA.

export default async function OverviewPage() {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;

  const now = Date.now();
  const stats = coverage();
  const projects = cachedProjects();
  const jobs = storedJobs();
  const tables = listTables();
  const savedOwner = savedViewsOwner(session);
  const { source, findings } = governanceFindings({}, now);
  const decisions = savedOwner ? governanceDecisions(savedOwner, now) : new Map();
  const openFindings = findings.filter((finding) => !decisions.has(`${finding.rule}:${finding.projectId.toLowerCase()}`));
  const pendingIngest = jobs.filter(isPendingActivityIngest);
  const failedJobs = jobs.filter((job) => isFailedJob(job) || Boolean(job.ingestError));
  const latestZipImport = tables.length ? Math.max(...tables.map((table) => table.uploadedAt)) : null;
  const savedViews = savedOwner ? listSavedViews(savedOwner) : [];
  const watched = savedOwner ? listWatchItems(savedOwner) : [];
  const watchedProjects = watched.filter((item) => item.kind === "project").length;
  const watchedPeople = watched.filter((item) => item.kind === "person").length;
  const todayJobs = jobsInLastDay();

  const attention: AttentionItem[] = [];
  const integrationRuns = listManifests().map((manifest) => ({ manifest, run: latestRun(manifest.id) }));
  const integrationBlockers = integrationRuns.filter(({ manifest, run }) => run?.version === manifest.version && !isIntegrationPreflightStale(manifest, run.result as IntegrationPreflight) && (run.result as { status?: string }).status === "blocked").length;
  if (integrationBlockers) attention.push({ key: "integration-contracts", value: String(integrationBlockers), title: "Integration preflights have blockers",
    detail: "Latest saved contract checks found missing data or incompatible dependencies. Review their evidence and check times.",
    href: "/integrations", action: "Review integration health", tone: "bad" });
  const closeoutBlocked = closeoutPortfolioStatus().counts.blockers;
  if (closeoutBlocked) attention.push({ key: "closeout-blockers", value: String(closeoutBlocked), title: "Projects have closeout blockers",
    detail: "Saved closeout assessments identify incomplete turnover requirements. Open the project evidence before preparing a handover.",
    href: "/closeout", action: "Review closeout readiness", tone: "bad" });
  if (failedJobs.length) attention.push({
    key: "failed-jobs", value: String(failedJobs.length), title: "Extract jobs need investigation",
    detail: "Failed job status or an activity ingestion error is recorded locally.",
    href: "/data-health", action: "Review job health", tone: "bad",
  });
  if (pendingIngest.length) attention.push({
    key: "pending-ingest", value: String(pendingIngest.length), title: "Completed activity extracts await ingest",
    detail: "These known activity jobs completed but have not updated the local activity cache.",
    href: "/extracts", action: "Review extracts", tone: "warn",
  });
  if (!source.projectSyncedAt) attention.push({
    key: "project-sync-missing", value: "—", title: "Project inventory is unavailable",
    detail: session.hubRole === "hub_admin"
      ? "Run a project sync before interpreting portfolio counts or governance prompts."
      : "A Hub Admin needs to sync projects before portfolio counts or governance prompts are reliable.",
    href: "/projects", action: "Open projects", tone: "warn",
  });
  else if (source.projectSyncedAt && now - source.projectSyncedAt > STALE_AFTER_MS) attention.push({
    key: "project-sync-old", value: `${Math.floor((now - source.projectSyncedAt) / 86_400_000)}d`, title: "Project inventory may be old",
    detail: `The last local project sync is more than 72 hours old.${session.hubRole === "hub_admin" ? " Refresh it before relying on project counts." : " Ask a Hub Admin to refresh it."}`,
    href: "/projects", action: "Review projects", tone: "warn",
  });
  if (!source.activityIngestedAt) attention.push({
    key: "activity-missing", value: "—", title: "No activity extract is ingested",
    detail: "Activity trends and quiet-project rules need a known, project-scoped extract window.",
    href: "/extracts", action: "Open extracts", tone: "warn",
  });
  else if (source.activityIngestedAt && now - source.activityIngestedAt > STALE_AFTER_MS) attention.push({
    key: "activity-old", value: `${Math.floor((now - source.activityIngestedAt) / 86_400_000)}d`, title: "Activity cache may be old",
    detail: "The latest local activity ingest is more than 72 hours old; this is a Lens review rule.",
    href: "/data-health", action: "Review data health", tone: "warn",
  });
  if (!latestZipImport) attention.push({
    key: "zip-missing", value: "—", title: "Tool dataset is unavailable",
    detail: "Tool dashboards and some people views need a separate Insight Data Connector ZIP.",
    href: "/data-health#reporting-dataset", action: "Manage reporting dataset", tone: "warn",
  });
  else if (latestZipImport && now - latestZipImport > STALE_AFTER_MS) attention.push({
    key: "zip-old", value: `${Math.floor((now - latestZipImport) / 86_400_000)}d`, title: "Uploaded tables may be old",
    detail: "The latest local ZIP import is more than 72 hours old; its source hub is unverified.",
    href: "/data-health", action: "Review data health", tone: "warn",
  });
  const ruleLabels: Record<string, string> = {
    "past-end-date": "Projects past stated end date",
    "no-project-members": "Projects with no members recorded",
    "missing-job-number": "Projects missing job numbers",
    "quiet-project": "Possible quiet projects",
    "large-membership": "Projects with large membership",
  };
  for (const [rule, title] of Object.entries(ruleLabels)) {
    const count = openFindings.filter((finding) => finding.rule === rule).length;
    if (!count) continue;
    attention.push({
      key: `governance-${rule}`, value: String(count), title,
      detail: "A cached-data review rule matched. Check evidence before deciding whether to act.",
      href: `/governance?rule=${encodeURIComponent(rule)}`, action: "Review projects", tone: "warn",
    });
  }

  const filters = {};
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-legend text-2xl text-adsk-black">Admin home</h1>
          <p className="mt-1 max-w-3xl text-sm text-adsk-gray">Start with items that may need review, then explore portfolio activity and administration data.</p>
          <p className="mt-1 font-mono text-[11px] text-adsk-gray">Hub {env.hubId}</p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {session.hubRole === "hub_admin" && <ActionForm action={refreshProjects} label="Sync projects" pendingLabel="Syncing…" />}
          <ActionForm action={refreshJobs} label="Refresh jobs" pendingLabel="Refreshing…" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Projects in hub" value={projects.length.toLocaleString()}
            hint={source.projectSyncedAt ? `synced ${relativeTime(source.projectSyncedAt)}` : "not synced yet"} />
          <Stat label="Activity events" value={stats.totalRows.toLocaleString()} hint="in local cache" />
          <Stat label="Projects with activity" value={stats.distinctProjects.toLocaleString()} hint="observed in loaded extracts" />
          <Stat label="Distinct actors" value={stats.distinctActors.toLocaleString()} hint="from loaded activity" />
          <Stat label="Extract jobs today" value={`${todayJobs} / 24`} tone={todayJobs >= 20 ? "warn" : "default"} hint="Autodesk hub limit per 24h" />
      </div>

      <Card title={`Needs review (${attention.length})`}
        subtitle="Local job state and review rules. Open each item to inspect its evidence before taking action."
        action={<Link href="/governance" className="text-xs text-adsk-link hover:underline">All governance rules →</Link>}>
        {attention.length ? (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {attention.map((item) => (
              <li key={item.key} className={`rounded border p-3 ${item.tone === "bad" ? "border-adsk-linkvisited bg-adsk-linkvisited/5" : "border-adsk-gold bg-adsk-gold/5"}`}>
                <div className="flex items-start gap-3">
                  <span className="tnum min-w-8 font-legend text-xl text-adsk-black">{item.value}</span>
                  <div>
                    <h3 className="text-xs font-semibold text-adsk-black">{item.title}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-adsk-gray">{item.detail}</p>
                    <Link href={item.href} className="mt-2 inline-block text-[11px] text-adsk-link hover:underline">{item.action} →</Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-adsk-gray">No current Lens review prompts. Source coverage and Autodesk state can still change.</p>}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-adsk-lightgray pt-3" aria-label="Data sources">
            {source.projectSyncedAt && <ProvenanceBadge source="project-sync" asOf={source.projectSyncedAt} />}
            {source.activityIngestedAt && <ProvenanceBadge source="activity-ingest" asOf={source.activityIngestedAt} />}
            {tables.length > 0 && <ProvenanceBadge source="user-zip" asOf={latestZipImport} />}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="My tools" subtitle="Browser-local favorites for this Autodesk identity and hub."
          action={<Link href="/tools" className="text-xs text-adsk-link hover:underline">Browse tools →</Link>}>
          <FavoriteTools tools={TOOL_SPECS.map(({ id, name }) => ({ id, name }))}
            storageKey={toolFavoritesKey(env.hubId, savedOwner)} />
        </Card>
        <Card title="My saved portfolio" subtitle="Local bookmarks; no alerts or automatic monitoring."
          action={<Link href="/views" className="text-xs text-adsk-link hover:underline">Open Saved →</Link>}>
          {savedOwner ? (
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div><span className="tnum block text-xl font-semibold">{savedViews.length}</span> saved views</div>
              <div><span className="tnum block text-xl font-semibold">{watchedProjects}</span> projects</div>
              <div><span className="tnum block text-xl font-semibold">{watchedPeople}</span> people</div>
            </div>
          ) : <p className="text-xs text-adsk-gray">Autodesk did not provide a stable identity for saved items.</p>}
        </Card>
      </div>

      {stats.totalRows === 0 ? (
        <Card title="No activity data yet">
          <EmptyState title="Nothing has been ingested into the local activity cache.">
              Request the <code>activities</code> service group on <Link href="/extracts" className="text-adsk-link hover:underline">Extracts</Link>, then ingest the completed job. Activity is an asynchronous Data Connector snapshot.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Events per day"
            subtitle={`${formatDateTime(stats.earliest)} → ${formatDateTime(stats.latest)} · ${stats.ingestedJobs} ingested extract${stats.ingestedJobs === 1 ? "" : "s"}`}>
            <DailyChart data={countByDay(filters)} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <Card title="Busiest projects"><BarList items={topProjects(filters, 10)} /></Card>
            <Card title="Most active people"><BarList items={topActors(filters, 10)} /></Card>
            <Card title="By service"><BarList items={topServices(filters, 10)} /></Card>
            <Card title="Top actions"><BarList items={topActions(filters, 10)} /></Card>
          </div>
          <p className="text-xs text-adsk-gray">Activity charts reflect only the loaded extract window. For possible quiet projects, use the coverage-aware <Link href="/governance" className="text-adsk-link hover:underline">Governance review</Link>.</p>
        </>
      )}
    </div>
  );
}
