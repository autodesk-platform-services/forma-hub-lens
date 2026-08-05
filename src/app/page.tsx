import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems, env } from "@/lib/env";
import { cachedProjects } from "@/lib/aps/admin";
import { jobsInLastDay, storedJobs } from "@/lib/aps/dataConnector";
import {
  countByDay,
  coverage,
  projectActivity,
  topActions,
  topActors,
  topProjects,
  topServices,
} from "@/lib/queries";
import { BarList, Card, DailyChart, EmptyState, Pill, Stat, formatDateTime, relativeTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { ActionForm } from "@/components/ActionForm";
import { refreshJobs, refreshProjects } from "./actions";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const stats = coverage();
  const projects = cachedProjects();
  const jobs = storedJobs();
  const lastDayJobs = jobsInLastDay();

  // Everything ingested; the chart covers whatever window the extracts span.
  const filters = {};
  const daily = countByDay(filters);
  const pendingIngest = jobs.filter(
    (job) => job.status === "complete" && job.completionStatus !== "failed" && !job.ingestedAt,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Hub overview</h1>
          <p className="mt-0.5 font-mono text-xs text-adsk-gray">{env.hubId}</p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <ActionForm action={refreshProjects} label="Sync projects" pendingLabel="Syncing…" />
          <ActionForm action={refreshJobs} label="Refresh jobs" pendingLabel="Refreshing…" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Projects in hub"
          value={projects.length.toLocaleString()}
          hint={
            projects.length > 0
              ? `synced ${relativeTime(Math.max(...projects.map((p) => p.syncedAt)))}`
              : "not synced yet"
          }
        />
        <Stat label="Activity events" value={stats.totalRows.toLocaleString()} hint="in local cache" />
        <Stat
          label="Projects with activity"
          value={stats.distinctProjects.toLocaleString()}
          hint={
            projects.length > 0
              ? `${Math.round((stats.distinctProjects / projects.length) * 100)}% of hub`
              : undefined
          }
        />
        <Stat label="Distinct actors" value={stats.distinctActors.toLocaleString()} />
        <Stat
          label="Extract jobs today"
          value={`${lastDayJobs} / 24`}
          tone={lastDayJobs >= 20 ? "warn" : "default"}
          hint="Autodesk hub limit per 24h"
        />
      </div>

      {stats.totalRows === 0 ? (
        <Card title="No activity data yet">
          <EmptyState title="Nothing has been extracted into the local cache.">
            <p>
              Forma exposes cross-project activity through the asynchronous Data Connector API, not
              a live endpoint. Head to{" "}
              <Link href="/extracts" className="text-adsk-link hover:underline">
                Extracts
              </Link>{" "}
              to submit a request for the <code>activities</code> service group, wait for the job to
              complete, then ingest it here.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <>
          {pendingIngest.length > 0 && (
            <div className="rounded-lg border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs text-adsk-black">
              {pendingIngest.length} completed extract{pendingIngest.length === 1 ? "" : "s"} not
              ingested yet.{" "}
              <Link href="/extracts" className="text-adsk-link hover:underline">
                Ingest now
              </Link>
            </div>
          )}

          <Card
            title="Events per day"
            subtitle={`${formatDateTime(stats.earliest)} → ${formatDateTime(stats.latest)} · ${stats.ingestedJobs} extract${stats.ingestedJobs === 1 ? "" : "s"} ingested`}
          >
            <DailyChart data={daily} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <Card title="Busiest projects">
              <BarList items={topProjects(filters, 10)} />
            </Card>
            <Card title="Most active people">
              <BarList items={topActors(filters, 10)} />
            </Card>
            <Card title="By service">
              <BarList items={topServices(filters, 10)} />
            </Card>
            <Card title="Top actions">
              <BarList items={topActions(filters, 10)} />
            </Card>
          </div>

          <Card
            title="Quiet projects"
            subtitle="In the hub project list, but with no events in the ingested window"
          >
            <QuietProjects />
          </Card>
        </>
      )}
    </div>
  );
}

function QuietProjects() {
  const quiet = projectActivity({}).filter((row) => row.events === 0);

  if (quiet.length === 0) {
    return <p className="text-xs text-adsk-gray">Every known project has activity in this window.</p>;
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {quiet.slice(0, 24).map((project) => (
        <li
          key={project.projectId}
          className="flex items-center justify-between gap-2 rounded border border-adsk-lightgray px-2.5 py-1.5 text-xs"
        >
          <span className="truncate text-adsk-black" title={project.name}>
            {project.name}
          </span>
          {project.status && (
            <Pill tone={project.status === "active" ? "default" : "warn"}>{project.status}</Pill>
          )}
        </li>
      ))}
      {quiet.length > 24 && (
        <li className="px-2.5 py-1.5 text-xs text-adsk-gray">+{quiet.length - 24} more</li>
      )}
    </ul>
  );
}
