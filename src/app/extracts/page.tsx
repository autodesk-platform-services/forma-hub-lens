import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { jobsInLastDay, storedJobs, type StoredJob } from "@/lib/aps/dataConnector";
import { columnReport } from "@/lib/ingest";
import { Card, EmptyState, Pill, relativeTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { ActionForm } from "@/components/ActionForm";
import { ExtractRequestForm } from "@/components/ExtractRequestForm";
import { ingestExtract, refreshJobs } from "../actions";

export const dynamic = "force-dynamic";

export default async function ExtractsPage() {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const jobs = storedJobs();
  const lastDay = jobsInLastDay();
  const columns = columnReport();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Data Connector extracts</h1>
          <p className="mt-0.5 max-w-prose text-xs text-adsk-gray">
            Forma has no live cross-project activity endpoint. Activity is delivered as
            asynchronous CSV extracts: submit a request, Autodesk spawns a job, then the finished
            extract is ingested into this console&apos;s local cache.
          </p>
        </div>
        <ActionForm action={refreshJobs} label="Refresh jobs" pendingLabel="Refreshing…" />
      </div>

      <Card
        title="New data request"
        subtitle="One-time request, executed immediately. Hub limit is 24 jobs per 24 hours."
      >
        <ExtractRequestForm jobsLastDay={lastDay} />
      </Card>

      <Card title="Jobs" subtitle={`${jobs.length} known · ${lastDay} created in the last 24h`}>
        {jobs.length === 0 ? (
          <EmptyState title="No jobs yet.">
            <p>
              Submit a request above, or press <strong>Refresh jobs</strong> to pull in jobs that
              were created outside this console.
            </p>
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
          title="Column mapping"
          subtitle="How each extract column was mapped onto the console's canonical fields. Unmapped columns are still searchable via the raw JSON."
        >
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
