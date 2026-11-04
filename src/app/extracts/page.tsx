import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { cachedProjects } from "@/lib/aps/admin";
import { configProblems, env } from "@/lib/env";
import { trustedReportingUploads } from "@/lib/dataset";
import { jobsInLastDay, storedJobs, storedRequests, type StoredJob } from "@/lib/aps/dataConnector";
import { columnReport } from "@/lib/ingest";
import { Card, EmptyState, Pill, relativeTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { ActionForm } from "@/components/ActionForm";
import { ExtractRequestForm } from "@/components/ExtractRequestForm";
import { RecurringRequestForm } from "@/components/RecurringRequestForm";
import { ingestExtract, refreshJobs, refreshSchedules } from "../actions";
import { ingestReportingExtract } from "./reportingActions";

export const dynamic = "force-dynamic";

export default async function ExtractsPage() {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const demoMode = env.demoMode;
  const jobs = storedJobs();
  const schedules = storedRequests().filter((request) =>
    request.scheduleInterval && request.scheduleInterval !== "ONE_TIME");
  const lastDay = jobsInLastDay();
  const columns = columnReport();
  const reportingJobs = new Set(trustedReportingUploads(100).map((upload) => upload.jobId));
  const projects = cachedProjects().map(({ id, name }) => ({ id, name }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Data Connector extracts</h1>
          <p className="mt-0.5 max-w-prose text-xs text-adsk-gray">
            {demoMode
              ? "Explore synthetic request, schedule, job, and ingestion examples. This demo does not submit or refresh Autodesk Data Connector jobs."
              : "Forma has no live cross-project activity endpoint. Activity is delivered as asynchronous CSV extracts: submit a request, Autodesk spawns a job, then the finished extract is ingested into this console's local cache."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/data-health" className="text-xs text-adsk-link underline">Data health</Link>
          {!demoMode && <ActionForm action={refreshJobs} label="Refresh jobs" pendingLabel="Refreshing…" />}
        </div>
      </div>

      {!demoMode && <section aria-label="Data Connector job use" className="rounded border border-adsk-lightgray bg-adsk-white px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <strong className="text-adsk-black">Data Connector jobs</strong>
          <span className="tnum text-adsk-gray">{lastDay} / 24 known jobs in the last 24 hours</span>
        </div>
        <progress className="mt-2 h-2 w-full accent-adsk-yellow" max={24} value={Math.min(lastDay, 24)}
          aria-label="Known Data Connector jobs in the last 24 hours" />
        <p className="mt-1 text-[11px] text-adsk-gray">Based on jobs cached in Lens. Refresh jobs for the latest known APS status.</p>
      </section>}

      {!demoMode ? <><Card
        title="New data request"
        subtitle="One-time request, executed immediately. Hub limit is 24 jobs per 24 hours."
      >
        <ExtractRequestForm jobsLastDay={lastDay} projects={projects} />
      </Card>

      <Card title="Recurring APS request" subtitle="APS schedules future extract jobs. Ingestion into Lens remains a manual action.">
        <RecurringRequestForm jobsLastDay={lastDay} projects={projects} />
      </Card></> : <Card title="Read-only sample workflow">
        <p className="text-xs text-adsk-gray">The requests and jobs below are synthetic examples. Request creation, schedule changes, refresh, and ingestion are unavailable in this demo.</p>
      </Card>}

      <Card title="Recurring schedules"
        subtitle={demoMode ? "Synthetic examples of scheduled extract requests." : "Cached APS request definitions. Refresh to see schedules created or changed outside Lens."}
        action={demoMode ? undefined : <ActionForm action={refreshSchedules} label="Refresh schedules" pendingLabel="Refreshing…" />}>
        {schedules.length === 0 ? (
          <EmptyState title={demoMode ? "No sample schedules are available." : "No recurring schedules cached."}>
            {demoMode ? "The demo owner can restore the synthetic data set." : "Create one above or refresh APS request definitions."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
                <tr className="border-b border-adsk-lightgray">
                  <th className="py-2 pr-3 font-medium">Request</th>
                  <th className="py-2 pr-3 font-medium">Repeat</th>
                  <th className="py-2 pr-3 font-medium">Active</th>
                  <th className="py-2 pr-3 font-medium">Window</th>
                  <th className="py-2 pr-3 font-medium">Latest known job</th>
                  <th className="py-2 font-medium">Cached</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((request) => {
                  const latest = jobs.find((job) => job.requestId === request.id);
                  return <tr key={request.id} className="border-b border-adsk-offwhite align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{request.description || "Untitled request"}</span>
                      <span className="block font-mono text-[10px] text-adsk-gray">{request.id}</span>
                      <span className="block text-[10px] text-adsk-gray">
                        {Array.isArray(request.serviceGroups) ? request.serviceGroups.join(", ") : "Service groups not returned"}
                      </span>
                      <span className="block text-[10px] text-adsk-gray">
                        {Array.isArray(request.projectIdList)
                          ? `${request.projectIdList.length} selected projects`
                          : typeof request.projectIdList === "string" && request.projectIdList.trim()
                            ? `${request.projectIdList.split(",").length} selected projects`
                          : request.projectId ? "One selected project" : "Hub-wide"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {request.scheduleInterval}
                      {request.reoccuringInterval && request.reoccuringInterval !== 1 ? " × " + request.reoccuringInterval : ""}
                    </td>
                    <td className="py-2 pr-3">
                      {!request.seenInLastRefresh ? <Pill tone="warn">{demoMode ? "not in sample refresh" : "not returned by APS"}</Pill> :
                        request.isActive === true ? <Pill tone="good">active</Pill> :
                        request.isActive === false ? <Pill tone="warn">inactive</Pill> : <Pill>unknown</Pill>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-adsk-gray">
                      {request.effectiveFrom?.slice(0, 16).replace("T", " ") ?? "?"} UTC
                      <span className="block">to {request.effectiveTo?.slice(0, 10) ?? "?"}</span>
                      <span className="block">{request.dateRange ?? "Relative range unknown"} for activities</span>
                    </td>
                    <td className="py-2 pr-3">{latest ? (latest.completionStatus ?? latest.status ?? "unknown") : "No job in local cache"}</td>
                    <td className="whitespace-nowrap py-2">{relativeTime(request.lastSeenAt)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-adsk-gray">{demoMode
              ? "These sample schedules and job outcomes are simulated. No APS next-run time or live schedule state is shown."
              : "APS does not provide a verified next-run time in this view. Refresh jobs separately to update outcomes. Pause or delete controls are unavailable because Lens has not requested the APS data:write scope."}</p>
          </div>
        )}
      </Card>

      <Card title="Jobs" subtitle={demoMode ? `${jobs.length} synthetic examples` : `${jobs.length} known · ${lastDay} created in the last 24h`}>
        <p className="mb-3 text-xs text-adsk-gray">{demoMode
          ? "These statuses and ingestion results are sample records. No job on this page belongs to a real Autodesk hub."
          : "Activity ingest refreshes Lens activity views. Reporting ingest imports every CSV in a completed APS job into Tools and records its verified hub, request, project scope, and service groups. Both are manual actions."}</p>
        {jobs.length === 0 ? (
          <EmptyState title={demoMode ? "No sample jobs are available." : "No jobs yet."}>
            <p>{demoMode ? "The demo owner can restore the synthetic data set." : <>Submit a request above, or press <strong>Refresh jobs</strong> to pull in jobs that were created outside this console.</>}</p>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
                <tr className="border-b border-adsk-lightgray">
                  <th className="py-2 pr-3 font-medium">Job</th>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Window</th>
                  <th className="py-2 pr-3 text-right font-medium">Rows</th>
                  <th className="py-2 pr-3 font-medium">Ingest</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {jobs.map((job) => (
                  <tr key={job.jobId} className="border-b border-adsk-offwhite align-top hover:bg-adsk-offwhite">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-[10px] text-adsk-gray">{job.jobId}</span>
                      {job.serviceGroups && (
                        <span className="mt-0.5 block text-[10px] text-adsk-lightgray">
                          {job.serviceGroups}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-adsk-black">
                      {job.createdAt ? job.createdAt.replace("T", " ").slice(0, 16) : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <JobStatus job={job} />
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-adsk-gray">
                      {job.startDate ? (
                        <>
                          {job.startDate.slice(0, 10)} → {job.endDate?.slice(0, 10) ?? "?"}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right text-adsk-black">
                      {job.activityRows > 0 ? job.activityRows.toLocaleString() : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {demoMode ? <div className="space-y-1 text-[11px] text-adsk-gray">
                        <p>{job.ingestedAt ? `Sample ingestion ${relativeTime(job.ingestedAt)}` : "Not ingested in the sample"}</p>
                        {job.ingestError && <p className="max-w-[24rem] text-adsk-linkvisited">{job.ingestError}</p>}
                      </div> : <div className="space-y-2">
                      {job.ingestedAt ? (
                        <div className="space-y-1">
                          <span className="text-[11px] text-adsk-black">
                            ingested {relativeTime(job.ingestedAt)}
                          </span>
                          <ActionForm
                            action={ingestExtract}
                            label="Re-ingest"
                            pendingLabel="Ingesting…"
                            hidden={{ jobId: job.jobId }}
                          />
                        </div>
                      ) : (
                        <ActionForm
                          action={ingestExtract}
                          label="Ingest"
                          pendingLabel="Ingesting…"
                          variant="primary"
                          hidden={{ jobId: job.jobId }}
                        />
                      )}
                      {job.ingestError && (
                        <p className="mt-1 max-w-[24rem] text-[10px] text-adsk-linkvisited">{job.ingestError}</p>
                      )}
                      {session.hubRole === "hub_admin" && job.status === "complete" &&
                        (!job.completionStatus || job.completionStatus === "success") && <ActionForm
                          action={ingestReportingExtract}
                          label={reportingJobs.has(job.jobId) ? "Re-ingest reporting" : "Ingest reporting"}
                          pendingLabel="Importing reporting…"
                          hidden={{ jobId: job.jobId }}
                        />}
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {columns.length > 0 && (
        <Card
          title="Advanced"
          subtitle="Data mappings and raw source columns for troubleshooting."
        >
          <details>
            <summary className="cursor-pointer text-xs font-medium text-adsk-black">Canonical field mappings ({columns.length} source columns)</summary>
          <div className="grid gap-4 md:grid-cols-2">
            {groupByFile(columns).map(([file, entries]) => (
              <div key={file}>
                <h3 className="font-mono text-[11px] text-adsk-black">{file}</h3>
                <ul className="mt-1.5 space-y-0.5">
                  {entries.map((entry) => (
                    <li key={entry.column} className="flex items-baseline gap-2 text-[11px]">
                      <span className="w-44 shrink-0 truncate font-mono text-adsk-gray">
                        {entry.column}
                      </span>
                      {entry.mappedTo ? (
                        <Pill tone="accent">{entry.mappedTo}</Pill>
                      ) : (
                        <span className="text-adsk-lightgray">unmapped</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          </details>
        </Card>
      )}
    </div>
  );
}

function JobStatus({ job }: { job: StoredJob }) {
  const status = job.status ?? "unknown";
  const completion = job.completionStatus;

  if (status === "complete" && completion === "success") {
    return <Pill tone="good">complete</Pill>;
  }
  if (completion && completion !== "success") {
    return <Pill tone="bad">{completion}</Pill>;
  }
  if (status === "failed" || status === "cancelled") {
    return <Pill tone="bad">{status}</Pill>;
  }
  return <Pill tone="warn">{status}</Pill>;
}

function groupByFile(
  columns: Array<{ sourceFile: string; column: string; mappedTo: string | null }>,
): Array<[string, Array<{ column: string; mappedTo: string | null }>]> {
  const map = new Map<string, Array<{ column: string; mappedTo: string | null }>>();
  for (const entry of columns) {
    const list = map.get(entry.sourceFile) ?? [];
    list.push({ column: entry.column, mappedTo: entry.mappedTo });
    map.set(entry.sourceFile, list);
  }
  return [...map.entries()];
}
