import "server-only";

import { env } from "./env";
import { dataConnectorExtractionMode } from "./dataConnectorMode";
import type { Session } from "./aps/auth";
import {
  getJob,
  listExtractFiles,
  listRequests,
  signedUrlFor,
  type DataJob,
  type DataRequest,
  type ExtractFile,
} from "./aps/dataConnector";
import {
  ingestTrustedCsvFiles,
  type TrustedProjectScope,
  type TrustedReportingManifest,
  type UploadSummary,
} from "./dataset";

const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 128 * 1024 * 1024;

function requestScope(request: DataRequest): TrustedProjectScope {
  const raw = request.projectIdList;
  const ids = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") :
    request.projectId ? [request.projectId] : [];
  const projectIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (projectIds.length > 50 || projectIds.some((id) => !PROJECT_ID.test(id))) {
    throw new Error("APS request returned an unreadable project selection.");
  }
  const status = request.projectStatus;
  return {
    kind: projectIds.length ? "selected_projects" : "all_projects",
    projectIds,
    projectStatus: status === "all" || status === "active" || status === "archived"
      ? status : "unknown",
  };
}

function reportingManifest(job: DataJob, request: DataRequest, files: ExtractFile[]): TrustedReportingManifest {
  const mode = dataConnectorExtractionMode(request);
  if (mode === "delta" || mode === "mixed") {
    throw new Error("This job contains date-filtered CDC records. Reporting replacement requires a full snapshot; delta records need a consumer that merges changes and deletions.");
  }
  if (job.accountId && job.accountId !== env.hubId) throw new Error("APS job belongs to a different hub.");
  if (request.accountId && request.accountId !== env.hubId) throw new Error("APS request belongs to a different hub.");
  if (!job.requestId || request.id !== job.requestId) throw new Error("APS job has no verified request definition.");
  if (job.status !== "complete" || (job.completionStatus && job.completionStatus !== "success")) {
    throw new Error("Only successfully completed APS jobs can be ingested as trusted reporting data.");
  }
  const serviceGroups = Array.isArray(request.serviceGroups)
    ? [...new Set(request.serviceGroups.filter((group) => typeof group === "string" && /^[a-z][a-z0-9_-]{0,79}$/i.test(group)))]
    : [];
  if (!serviceGroups.length) throw new Error("APS request does not identify its service groups.");
  if (files.length > 500) throw new Error("APS returned more than 500 extract files.");
  const expectedFiles = files.filter((file) => /\.csv$/i.test(file.name)).map((file) => file.name);
  if (!expectedFiles.length) throw new Error("This completed APS job has no reporting CSV files.");
  return {
    provenance: "aps_data_connector_job",
    hubId: env.hubId,
    jobId: job.id,
    requestId: request.id,
    jobCompletedAt: job.completedAt ?? null,
    projectScope: requestScope(request),
    serviceGroups,
    expectedFiles,
    skippedFiles: files.filter((file) => !/\.csv$/i.test(file.name)).map((file) => file.name),
  };
}

function isS3SignedUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(".amazonaws.com")) return false;
  const labels = host.split(".");
  const s3 = labels.findIndex((label) => label === "s3" || label.startsWith("s3-"));
  if (s3 < 0) return false;
  const suffix = labels.slice(s3 + 1).join(".");
  return suffix === "amazonaws.com" || /^[a-z0-9-]+\.amazonaws\.com$/.test(suffix) ||
    /^dualstack\.[a-z0-9-]+\.amazonaws\.com$/.test(suffix);
}

async function downloadReportingFile(session: Session, jobId: string, file: ExtractFile): Promise<Uint8Array> {
  const listedSize = Number(file.size);
  if (Number.isFinite(listedSize) && listedSize > MAX_FILE_BYTES) {
    throw new Error(`${file.name} exceeds the 128 MB reporting file limit.`);
  }
  const signed = await signedUrlFor(session, jobId, file.name);
  if (signed.name !== file.name || !isS3SignedUrl(signed.signedUrl)) {
    throw new Error(`APS returned an invalid signed URL for ${file.name}.`);
  }
  if (signed.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 128 MB reporting file limit.`);
  const response = await fetch(signed.signedUrl, {
    cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok || !response.body) throw new Error(`Downloading ${file.name} failed (${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 128 MB reporting file limit.`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Trusted, atomic reporting ingest from a live APS job and its live request definition. */
export async function ingestReportingJob(session: Session, jobId: string): Promise<{
  summary: UploadSummary;
  manifest: TrustedReportingManifest;
}> {
  if (session.hubRole !== "hub_admin") throw new Error("Hub Admin access is required.");
  if (!SAFE_JOB_ID.test(jobId)) throw new Error("Invalid Data Connector job ID.");
  const [job, requests] = await Promise.all([getJob(session, jobId), listRequests(session)]);
  if (job.id !== jobId) throw new Error("APS returned a different job ID.");
  const request = requests.find((item) => item.id === job.requestId);
  if (!request) throw new Error("The completed job's APS request definition is unavailable; trusted scope cannot be established.");
  const files = await listExtractFiles(session, jobId);
  const manifest = reportingManifest(job, request, files);
  const listed = new Map(files.map((file) => [file.name, file]));
  async function* downloads() {
    for (const name of manifest.expectedFiles) {
      const file = listed.get(name)!;
      yield { name, bytes: await downloadReportingFile(session, jobId, file) };
    }
  }
  const summary = await ingestTrustedCsvFiles(manifest, downloads());
  return { summary, manifest };
}

export const reportingIngestSafety = { isS3SignedUrl, requestScope, reportingManifest };
