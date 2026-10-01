import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { storedJobs, storedRequests } from "@/lib/aps/dataConnector";
import { dataConnectorExtractionMode } from "@/lib/dataConnectorMode";
import { getDb } from "@/lib/db";
import { recentUploads, trustedReportingUploads, listTables } from "@/lib/dataset";
import { configProblems } from "@/lib/env";
import { listManifests } from "@/lib/integrationStore";
import { Card, EmptyState, Pill, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { refreshIntegrationFilesAction, refreshIntegrationInventoryAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function IntegrationInventoryPage() {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const requests = storedRequests();
  const jobs = storedJobs();
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const files = getDb().prepare("SELECT job_id, name, size FROM extract_files ORDER BY job_id, name LIMIT 1000")
    .all() as Array<{ job_id: string; name: string; size: number | null }>;
  const fileCounts = new Map<string, number>();
  for (const file of files) fileCounts.set(file.job_id, (fileCounts.get(file.job_id) ?? 0) + 1);
  const uploads = recentUploads(30);
  const trusted = trustedReportingUploads(30);
  const trustedById = new Map(trusted.map((item) => [item.uploadId, item]));
  const tables = listTables();
  const consumers = listManifests();
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><Link href="/integrations" className="text-xs text-adsk-link">← Integration Health</Link><h1 className="mt-2 font-legend text-2xl">Extraction inventory</h1>
      <p className="mt-1 max-w-3xl text-sm text-adsk-gray">Link declared consumers to cached APS request definitions, job status, file listings, and current reporting imports. Listings are a local cache from the last admin refresh.</p></div>
      {session.hubRole === "hub_admin" && <ActionForm action={refreshIntegrationInventoryAction} label="Refresh APS requests and jobs" />}</div>
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="rounded border border-adsk-lightgray bg-adsk-white p-3 text-xs"><strong className="text-2xl">{requests.filter((r) => r.seenInLastRefresh).length}</strong><p className="text-adsk-gray">Requests in latest refresh</p></div>
      <div className="rounded border border-adsk-lightgray bg-adsk-white p-3 text-xs"><strong className="text-2xl">{jobs.length}</strong><p className="text-adsk-gray">Cached jobs</p></div>
      <div className="rounded border border-adsk-lightgray bg-adsk-white p-3 text-xs"><strong className="text-2xl">{tables.length}</strong><p className="text-adsk-gray">Current reporting tables</p></div>
      <div className="rounded border border-adsk-lightgray bg-adsk-white p-3 text-xs"><strong className="text-2xl">{trusted.length}</strong><p className="text-adsk-gray">Recent APS-sourced imports</p></div>
    </div>
    <Card title="Data Connector requests" subtitle="APS request definitions cached locally. A request does not prove a successful job or complete reporting coverage.">
      {!requests.length ? <EmptyState title="No request inventory cached." /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-adsk-lightgray text-adsk-gray"><th className="py-2 pr-3">Request</th><th className="py-2 pr-3">Service groups</th><th className="py-2 pr-3">Mode</th><th className="py-2 pr-3">Project selection</th><th className="py-2 pr-3">Schedule</th><th className="py-2">Consumers</th></tr></thead><tbody>
        {requests.slice(0, 100).map((request) => <tr key={request.id} className="border-b border-adsk-offwhite align-top"><td className="py-2 pr-3"><code>{request.id}</code><p className="text-adsk-gray">{request.description ?? "No description"}</p><Pill tone={request.seenInLastRefresh ? "good" : "warn"}>{request.seenInLastRefresh ? "Current cache" : "Prior cache"}</Pill></td>
          <td className="py-2 pr-3">{request.serviceGroups?.join(", ") || "Unknown"}</td><td className="py-2 pr-3"><Pill tone={dataConnectorExtractionMode(request) === "delta" || dataConnectorExtractionMode(request) === "mixed" ? "warn" : "default"}>{dataConnectorExtractionMode(request)}</Pill><p className="mt-1 text-adsk-gray">{request.dateRange || request.startDate || request.endDate ? "Date filter configured" : "No date filter recorded"}</p></td><td className="py-2 pr-3">{request.projectIdList ? Array.isArray(request.projectIdList) ? `${request.projectIdList.length} selected` : request.projectIdList : request.projectId ?? "All or unknown"}<p className="text-adsk-gray">{request.projectStatus ?? "Status not recorded"}</p></td>
          <td className="py-2 pr-3">{request.scheduleInterval || "One time / unknown"}<p className="text-adsk-gray">Last seen {formatDateTime(request.lastSeenAt)}</p></td>
          <td className="py-2">{consumers.filter((manifest) => manifest.requestId === request.id).map((manifest) => <div key={manifest.id}><Link href={`/integrations/${manifest.id}`} className="text-adsk-link underline">{manifest.name}</Link></div>)}</td></tr>)}
      </tbody></table></div>}
      {requests.length > 100 && <p className="mt-2 text-xs text-adsk-gray">Showing 100 of {requests.length} cached requests.</p>}
    </Card>
    <Card title="Jobs and extract files" subtitle="File listings are APS metadata. Lens retrieves names only when a Hub Admin requests them here.">
      {!jobs.length ? <EmptyState title="No jobs cached." /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-adsk-lightgray text-adsk-gray"><th className="py-2 pr-3">Job</th><th className="py-2 pr-3">Request / mode</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Completed</th><th className="py-2 pr-3">Local ingests</th><th className="py-2">Files</th></tr></thead><tbody>
        {jobs.slice(0, 100).map((job) => { const currentFiles = files.filter((file) => file.job_id === job.jobId); const imported = trusted.filter((upload) => upload.jobId === job.jobId); const request = job.requestId ? requestById.get(job.requestId) : null; const mode = request ? dataConnectorExtractionMode(request) : "unknown"; return <tr key={job.jobId} className="border-b border-adsk-offwhite align-top"><td className="py-2 pr-3 font-mono">{job.jobId}</td><td className="py-2 pr-3"><code>{job.requestId ?? "Unknown"}</code><div className="mt-1"><Pill tone={mode === "delta" || mode === "mixed" ? "warn" : "default"}>{mode}</Pill></div></td>
          <td className="py-2 pr-3"><Pill tone={job.status === "complete" ? "good" : job.status === "failed" ? "bad" : "warn"}>{job.completionStatus ?? job.status ?? "Unknown"}</Pill></td><td className="py-2 pr-3">{job.completedAt ?? "—"}</td>
          <td className="py-2 pr-3">{imported.length ? imported.map((upload) => <div key={upload.uploadId}>{upload.tables.length} tables · {upload.totalRows.toLocaleString()} rows · {formatDateTime(upload.ingestedAt)}</div>) : <span className="text-adsk-gray">No trusted reporting import linked</span>}{job.ingestedAt && <div className="text-adsk-gray">Activity ingest {formatDateTime(job.ingestedAt)}</div>}</td>
          <td className="py-2"><span>{fileCounts.get(job.jobId) ?? 0} cached</span>{session.hubRole === "hub_admin" && <ActionForm action={refreshIntegrationFilesAction} label="List files" hidden={{ jobId: job.jobId }} className="mt-1" />}{currentFiles.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-adsk-link">View names</summary><ul className="mt-1 max-w-xs break-all text-adsk-gray">{currentFiles.slice(0, 30).map((file) => <li key={file.name}>{file.name}{file.size !== null ? ` · ${file.size} B` : ""}</li>)}</ul></details>}</td></tr>; })}
      </tbody></table></div>}
      {jobs.length > 100 && <p className="mt-2 text-xs text-adsk-gray">Showing 100 of {jobs.length} cached jobs.</p>}
      <p className="mt-2 text-xs text-adsk-gray">Mode comes from the cached request definition: a CDC service group with a date filter is a delta extract; CDC without a date filter is a full extract. Mixed/unknown modes need manual review. A delta extract must be merged by a capable downstream consumer and cannot replace a full reporting table.</p>
    </Card>
    <Card title="Reporting uploads and provenance" subtitle="APS-sourced imports retain job/request/project/service lineage. User ZIPs are unverified and cannot establish source-hub coverage.">
      {!uploads.length ? <EmptyState title="No reporting uploads recorded." /> : <div className="space-y-2 text-xs">{uploads.map((upload) => { const source = trustedById.get(upload.id); return <div key={upload.id} className="rounded border border-adsk-lightgray p-3"><div className="flex flex-wrap gap-2"><strong>{upload.fileName}</strong><Pill tone={source ? "good" : "warn"}>{source ? "APS job import" : "User ZIP · unverified"}</Pill></div>
        <p className="mt-1 text-adsk-gray">{formatDateTime(upload.uploadedAt)} · {upload.tables} tables · {upload.rows.toLocaleString()} rows · {(upload.size / 1024 / 1024).toFixed(1)} MB</p>
        {source && <p className="mt-1 text-adsk-gray">Job {source.jobId} · request {source.requestId} · {source.serviceGroups.join(", ") || "groups unknown"} · {source.projectScope.kind.replace("_", " ")} ({source.projectScope.projectStatus}) · {source.skippedFiles.length} skipped files</p>}
      </div>; })}</div>}
      <p className="mt-3 text-xs text-adsk-gray">Current tables may have been replaced since an earlier upload. Per-table source lineage is evaluated from the current table registry during preflight.</p>
    </Card>
  </div>;
}
