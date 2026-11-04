import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { getDataHealth, type SchemaChange } from "@/lib/dataHealth";
import { configProblems, env } from "@/lib/env";
import { Card, EmptyState, Pill, Stat, relativeTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { acknowledgeCurrentSchema } from "./actions";
import { DatasetUpload } from "@/components/ToolsExplorer";

export const dynamic = "force-dynamic";

export default async function DataHealthPage() {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;

  const demoMode = env.demoMode;
  const health = getDataHealth();
  const latestJobs = health.jobs.slice(0, 10);
  const schemaCounts = {
    added: health.schemaChanges.filter((change) => change.kind === "table added").length,
    removed: health.schemaChanges.filter((change) => change.kind === "table removed").length,
    changed: health.schemaChanges.filter((change) => change.kind === "columns changed").length,
  };
  const schemaGroups = health.schemaChanges.reduce<Record<string, SchemaChange[]>>((groups, change) => {
    const group = schemaGroup(change.table);
    (groups[group] ??= []).push(change);
    return groups;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Data Connector health</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-adsk-gray">
            {demoMode
              ? "Explore synthetic job, ingestion, reporting-table, and schema-change examples. All records and timestamps on this page are sample data."
              : "Job outcomes, local activity ingestion, uploaded reporting tables, and schema changes. Dates below show when Lens last received data; they do not prove that a source is current."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2"><Link href="/integrations" className="rounded border border-adsk-lightgray px-3 py-1.5 text-xs hover:bg-adsk-offwhite">Integration health →</Link>
        <Link href="/extracts" className="rounded border border-adsk-lightgray px-3 py-1.5 text-xs hover:bg-adsk-offwhite">
          View extracts →
        </Link></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={demoMode ? "Failed sample jobs" : "Failed jobs"} value={String(health.failedJobs.length)}
          hint={demoMode ? "Synthetic job outcomes" : "Among jobs known to Lens"} tone={health.failedJobs.length ? "bad" : "good"} />
        <Stat label={demoMode ? "Sample ingestion needed" : "Activity ingestion needed"} value={String(health.pendingActivityJobs.length)}
          hint={demoMode ? "Synthetic completed jobs" : "Completed activity jobs only"} tone={health.pendingActivityJobs.length ? "warn" : "good"} />
        <Stat label={demoMode ? "Sample tables" : "Uploaded tables"} value={String(health.tables.length)}
          hint={String(health.staleTables.length) + (demoMode ? " sample tables over 72 hours old" : " older than 72 hours")} tone={health.staleTables.length ? "warn" : "good"} />
        <Stat label="Tool source available"
          value={String(health.readyToolCount) + " / " + String(health.readyToolCount + health.missingSourceTools.length)}
          hint={demoMode ? "Minimum sample table only" : "Minimum source table only"} />
      </div>

      <Card title={demoMode ? "Sample data freshness" : "Data freshness"} subtitle={demoMode
        ? "Sample timestamps illustrate Lens's 72-hour review rule; they are not Autodesk update times."
        : "The 72-hour threshold is a Lens review rule, not an Autodesk service guarantee."}>
        <div className="grid gap-4 text-xs md:grid-cols-3">
          <Freshness label="Latest reporting table" at={health.latestTableUploadAt} />
          <Freshness label="Latest activity ingestion" at={health.latestActivityIngestAt} />
          <Freshness label="Latest project sync" at={health.latestProjectSyncAt} />
        </div>
        <div className="mt-4 rounded border border-adsk-lightgray bg-adsk-offwhite px-3 py-2 text-xs text-adsk-gray">
          {demoMode ? <>
            Sample coverage is limited to the synthetic project records in this deployment. A missing sample table means its example is unavailable; it says nothing about a real hub.
          </> : <>
            Project coverage of an extract is <strong className="text-adsk-black">not verified</strong>.
            The local table registry does not store the requested project set or a project-level extract manifest.
            A missing table means its source is unavailable here; it does not mean the hub has zero records.
          </>}
        </div>
      </Card>

      <Card title="Snapshot integrity" subtitle={demoMode
        ? "The synthetic data set includes sample snapshots to illustrate period and schema checks."
        : "ZIP uploads can replace some tables while retaining older tables."}>
        <p className="text-xs text-adsk-black">
          {demoMode
            ? health.mixedSnapshot === true
              ? "Sample tables intentionally span more than one synthetic snapshot. Cross-table comparisons may show different example periods."
              : "Sample tables come from the synthetic demo seed; no Autodesk extract or user ZIP was uploaded."
            : health.mixedSnapshot === true
            ? "Tables currently come from more than one local ZIP upload. Cross-table comparisons may combine different reporting periods."
            : health.mixedSnapshot === false
              ? "All registered tables map to one local ZIP upload. This does not verify their source periods or project coverage."
              : health.tables.length === 0
                ? "No reporting tables are loaded yet."
                : "The upload history does not establish the origin of every registered table."}
        </p>
        {health.unknownTableLineage.length > 0 && (
          <p className="mt-2 text-xs text-adsk-gray">
            {demoMode ? "Sample tables without a detailed lineage record" : "Unknown table lineage"}: {health.unknownTableLineage.slice(0, 8).join(", ")}
            {health.unknownTableLineage.length > 8 ? " and " + String(health.unknownTableLineage.length - 8) + " more" : ""}.
          </p>
        )}
        {health.truncatedTables.length > 0 && (
          <p className="mt-2 text-xs text-adsk-linkvisited">
            {health.truncatedTables.length} {health.truncatedTables.length === 1 ? "table was" : "tables were"}
            {" "}truncated at the local row limit. Counts and dashboard totals may be incomplete.
          </p>
        )}
      </Card>

      <div id="reporting-dataset">
        <Card title="Reporting dataset" subtitle={demoMode
          ? "Synthetic sample tables are loaded automatically for the demo. Uploads are unavailable here."
          : "Upload an Insight Data Connector ZIP to refresh the tool dashboards. Only a Hub Admin can replace shared reporting tables."}>
          {health.uploads.length > 0 && <p className="mb-3 text-xs text-adsk-gray">
            {demoMode ? "Latest sample snapshot" : "Latest upload"}: {health.uploads[0].fileName} · {formatTimestamp(health.uploads[0].uploadedAt)} · {health.uploads[0].tables} tables.
            {!demoMode && " The source hub of a user-supplied ZIP cannot be verified by Lens."}
          </p>}
          {demoMode ? <p className="text-xs text-adsk-gray">This read-only sample cannot upload, replace, or ingest reporting data.</p>
            : session.hubRole === "hub_admin"
            ? <DatasetUpload hasData={health.tables.length > 0} />
            : <p className="text-xs text-adsk-gray">Ask a Hub Admin to refresh this shared reporting dataset.</p>}
        </Card>
      </div>

      <Card title="Schema changes"
        subtitle={demoMode
          ? "Synthetic schema differences compared with the sample baseline."
          : "Compared with Lens's local baseline captured " + formatTimestamp(health.schemaBaselineAt) + ". Autodesk's current public schema is separate."}>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Tables added" value={String(schemaCounts.added)} />
          <Stat label="Tables removed" value={String(schemaCounts.removed)} tone={schemaCounts.removed ? "warn" : "default"} />
          <Stat label="Tables changed" value={String(schemaCounts.changed)} tone={schemaCounts.changed ? "warn" : "default"} />
        </div>
        {health.schemaChanges.length === 0 ? (
          <p className="text-xs text-adsk-gray">
            No local registry changes since this baseline. Changes before the first visit to this page cannot be reconstructed.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <details className="rounded border border-adsk-lightgray p-3 text-xs">
              <summary className="cursor-pointer font-medium text-adsk-black">Review schema changes by service</summary>
              <div className="mt-3 space-y-2">
                {Object.entries(schemaGroups).map(([group, changes]) => (
                  <details key={group} className="rounded border border-adsk-lightgray px-3 py-2">
                    <summary className="cursor-pointer font-medium text-adsk-black">{group} ({changes?.length ?? 0})</summary>
                    <ul className="mt-2 space-y-2">{changes?.map((change) => <SchemaChangeRow key={change.table} change={change} />)}</ul>
                  </details>
                ))}
              </div>
            </details>
            {!demoMode && <form action={acknowledgeCurrentSchema}>
              <button type="submit" className="rounded border border-adsk-lightgray px-3 py-1.5 text-xs hover:bg-adsk-offwhite">
                Acknowledge current schema as baseline
              </button>
            </form>}
          </div>
        )}
        {!demoMode && <p className="mt-3 text-xs text-adsk-gray">
          Local comparison reflects loaded CSV headers. Review Autodesk&apos;s{" "}
          <a className="text-adsk-link underline"
            href="https://developer.api.autodesk.com/data-connector/v1/doc/changes"
            target="_blank" rel="noreferrer">public schema-change feed</a>
          {" "}for published source changes.
        </p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Job and ingest exceptions" subtitle={demoMode
          ? "Synthetic examples of failed, pending, or incomplete sample jobs."
          : "Only jobs in the local cache are shown; refresh jobs on Extracts to update APS status."}>
          {health.failedJobs.length === 0 && health.activityIngestErrors.length === 0 && health.pendingActivityJobs.length === 0 ? (
            <EmptyState title="No known exceptions.">{demoMode ? "No sample job exception is currently seeded." : "This does not verify jobs outside the local cache."}</EmptyState>
          ) : (
            <div className="space-y-2 text-xs">
              {health.failedJobs.slice(0, 8).map((job) => (
                <div key={"failed-" + job.jobId} className="rounded border border-adsk-lightgray p-2">
                  <Pill tone="bad">{job.completionStatus ?? job.status ?? "failed"}</Pill>
                  <span className="ml-2 break-all font-mono text-[11px]">{job.jobId}</span>
                </div>
              ))}
              {health.activityIngestErrors.slice(0, 8).map((job) => (
                <div key={"error-" + job.jobId} className="rounded border border-adsk-lightgray p-2">
                  <Pill tone="warn">activity ingest error</Pill>
                  <span className="ml-2 break-all font-mono text-[11px]">{job.jobId}</span>
                  <p className="mt-1 break-words text-adsk-gray">{job.ingestError}</p>
                </div>
              ))}
              {health.pendingActivityJobs.slice(0, 8).map((job) => (
                <div key={"pending-" + job.jobId} className="rounded border border-adsk-lightgray p-2">
                  <Pill tone="warn">ingest activity</Pill>
                  <span className="ml-2 break-all font-mono text-[11px]">{job.jobId}</span>
                </div>
              ))}
              <Link href="/extracts" className="inline-block text-adsk-link underline">Open Extracts</Link>
            </div>
          )}
        </Card>

        <Card title="Missing tool sources" subtitle={demoMode
          ? "A sample dashboard needs its minimum synthetic table to open; panels may need additional sample tables."
          : "A tool needs its minimum CSV source to open; individual panels may need additional tables."}>
          {health.missingSourceTools.length === 0 ? (
            <p className="text-xs text-adsk-gray">Every tool has its minimum source table in the local registry.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto text-xs">
              {health.missingSourceTools.map((tool) => (
                <li key={tool.id} className="rounded border border-adsk-lightgray p-2">
                  <strong>{tool.name}</strong><span className="ml-2 text-adsk-gray">{tool.missing.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Advanced diagnostics" subtitle="Reporting table registry and local row counts.">
        {health.tables.length === 0 ? <EmptyState title={demoMode ? "No sample dataset is available." : "No CSV dataset loaded."}>{demoMode ? "The demo owner can restore the synthetic data set." : "Upload a Data Connector ZIP in Reporting dataset above."}</EmptyState> : (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-adsk-black">Reporting tables ({health.tables.length})</summary>
          <div className="max-h-[34rem] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-adsk-white text-[11px] uppercase tracking-wide text-adsk-gray">
                <tr className="border-b border-adsk-lightgray">
                  <th className="py-2 pr-3 font-medium">Table</th><th className="py-2 pr-3 text-right font-medium">Rows</th>
                  <th className="py-2 pr-3 font-medium">Loaded</th><th className="py-2 font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {health.tables.map((table) => (
                  <tr key={table.name} className="border-b border-adsk-offwhite">
                    <td className="py-2 pr-3 font-mono text-[11px]">{table.name}</td>
                    <td className="py-2 pr-3 text-right tnum">{table.rowCount.toLocaleString()}</td>
                    <td className="whitespace-nowrap py-2 pr-3" title={formatTimestamp(table.uploadedAt)}>{relativeTime(table.uploadedAt)}</td>
                    <td className="py-2">
                      {table.truncated && <Pill tone="bad">truncated</Pill>}{" "}
                      {health.evaluatedAt - table.uploadedAt > 72 * 60 * 60 * 1_000 && <Pill tone="warn">{demoMode ? "sample over 72h" : "older than 72h"}</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </details>
        )}
      </Card>

      {latestJobs.length > 0 && (
        <Card title="Recent jobs" subtitle={demoMode
          ? "Synthetic job statuses and sample ingestion times."
          : "APS job status is refreshed on Extracts; ingestion time refers only to Lens's activity cache."}>
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead className="text-[11px] uppercase tracking-wide text-adsk-gray"><tr className="border-b border-adsk-lightgray">
                <th className="py-2 pr-3 font-medium">Job</th><th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 pr-3 font-medium">Outcome</th><th className="py-2 font-medium">Activity ingested</th>
              </tr></thead>
              <tbody>{latestJobs.map((job) => <tr key={job.jobId} className="border-b border-adsk-offwhite">
                <td className="py-2 pr-3 font-mono text-[11px]">{job.jobId}</td>
                <td className="whitespace-nowrap py-2 pr-3">{job.createdAt?.replace("T", " ").slice(0, 16) ?? "—"}</td>
                <td className="py-2 pr-3">{job.completionStatus ?? job.status ?? "unknown"}</td>
                <td className="py-2">{job.ingestedAt ? formatTimestamp(job.ingestedAt) : "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Freshness({ label, at }: { label: string; at: number | null }) {
  return <div><p className="font-medium text-adsk-black">{label}</p>
    <p className="mt-1 text-adsk-gray">{at ? formatTimestamp(at) + " · " + relativeTime(at) : "No local data yet"}</p>
  </div>;
}

function SchemaChangeRow({ change }: { change: SchemaChange }) {
  return <li className="rounded border border-adsk-lightgray p-2">
    <details>
      <summary className="cursor-pointer"><span className="font-mono">{change.table}</span> <Pill tone="warn">{change.kind}</Pill></summary>
      {change.addedColumns.length > 0 && <p className="mt-2 break-words text-adsk-gray">Added: {change.addedColumns.join(", ")}</p>}
      {change.removedColumns.length > 0 && <p className="mt-1 break-words text-adsk-gray">Removed: {change.removedColumns.join(", ")}</p>}
    </details>
  </li>;
}

function schemaGroup(table: string): string {
  const prefix = table.split("_")[0];
  const labels: Record<string, string> = {
    activities: "Activities", admin: "Administration", assets: "Assets", cost: "Cost",
    docs: "Docs", forms: "Forms", issues: "Issues", locations: "Locations",
    meetings: "Meetings", rfis: "RFIs", sheets: "Sheets", submittals: "Submittals",
  };
  return labels[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
