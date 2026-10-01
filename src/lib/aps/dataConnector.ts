import "server-only";

import { getDb } from "../db";
import { env } from "../env";
import type { Session } from "./auth";
import { apsFetch, apsPaginate } from "./client";

/**
 * ACC/Forma Data Connector API.
 *
 * Flow: POST a request -> it spawns a job -> poll the job -> list the extract's
 * files -> exchange each file name for a 60-second signed S3 URL -> download.
 *
 * Hard limits worth remembering (from the POST requests reference):
 *   - 24 jobs per hub per 24h, and 24 jobs per user per 24h.
 *   - Activity extraction covers the last 12 months, max 31 days per request.
 *   - Activity data lags real time by up to ~20 minutes.
 */

function base(): string {
  return `/data-connector/v1/accounts/${env.hubId}`;
}

export const SERVICE_GROUPS = [
  "activities",
  "admin",
  "issues",
  "rfis",
  "submittals",
  "cost",
  "locations",
  "checklists",
  "dailylogs",
  "forms",
  "sheets",
  "photos",
  "markups",
  "meetingminutes",
  "reviews",
  "assets",
  "relationships",
  "schedule",
  "transmittals",
  "classifications",
  "takeoff",
  "estimates",
] as const;

export const DATE_RANGES = [
  "TODAY",
  "YESTERDAY",
  "PAST_7_DAYS",
  "MONTH_TO_DATE",
  "LAST_MONTH",
  "CUSTOM",
] as const;

export type DateRange = (typeof DATE_RANGES)[number];

export type DataRequest = {
  id: string;
  description?: string;
  isActive?: boolean;
  accountId?: string;
  projectId?: string | null;
  projectIdList?: string | string[] | null;
  createdBy?: string;
  createdByEmail?: string;
  createdAt?: string;
  scheduleInterval?: string;
  reoccuringInterval?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  serviceGroups?: string[];
  startDate?: string;
  endDate?: string;
  dateRange?: string;
  projectStatus?: string;
};

export type DataJob = {
  id: string;
  requestId?: string;
  accountId?: string;
  createdBy?: string;
  createdByEmail?: string;
  createdAt?: string;
  status?: string;
  completionStatus?: string;
  startedAt?: string;
  completedAt?: string;
  progress?: string;
  startDate?: string;
  endDate?: string;
};

export type ExtractFile = { name: string; createdAt?: string; size?: number | string };

export type CreateRequestInput = {
  description: string;
  serviceGroups: string[];
  dateRange: DateRange;
  startDate?: string;
  endDate?: string;
  projectIdList?: string[];
  projectStatus?: "all" | "active" | "archived";
};

export const RECURRING_INTERVALS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

export type CreateRecurringRequestInput = {
  description: string;
  serviceGroups: string[];
  scheduleInterval: RecurringInterval;
  effectiveFrom: string;
  effectiveTo: string;
  dateRange: Exclude<DateRange, "CUSTOM">;
  projectStatus: "all" | "active" | "archived";
  projectIdList?: string[];
};

/** APS owns the recurring job schedule. Lens does not ingest it in the background. */
export async function createRecurringDataRequest(
  session: Session,
  input: CreateRecurringRequestInput,
): Promise<DataRequest> {
  const from = Date.parse(input.effectiveFrom);
  const to = Date.parse(input.effectiveTo);
  if (!RECURRING_INTERVALS.includes(input.scheduleInterval)) {
    throw new Error("Choose a supported recurrence.");
  }
  if (!Number.isFinite(from) || from <= Date.now()) {
    throw new Error("The first run must be in the future.");
  }
  if (!Number.isFinite(to) || to <= from) {
    throw new Error("The schedule end must be after the first run.");
  }
  if (!input.description.trim() || input.description.length > 200) {
    throw new Error("Provide a description of 1–200 characters.");
  }
  if (!input.serviceGroups.length || input.serviceGroups.some((group) =>
    !SERVICE_GROUPS.includes(group as (typeof SERVICE_GROUPS)[number]))) {
    throw new Error("Choose at least one supported service group.");
  }
  if (String(input.dateRange) === "CUSTOM" || !DATE_RANGES.includes(input.dateRange)) {
    throw new Error("Choose a relative activity window for recurring requests.");
  }
  if (!["all", "active", "archived"].includes(input.projectStatus)) {
    throw new Error("Choose a supported project status.");
  }
  if (input.projectIdList && (input.projectIdList.length > 50 ||
      input.projectIdList.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) {
    throw new Error("Select at most 50 valid project IDs for one schedule.");
  }
  return apsFetch<DataRequest>(session, `${base()}/requests`, {
    method: "POST",
    body: {
      description: input.description.trim(),
      isActive: true,
      scheduleInterval: input.scheduleInterval,
      reoccuringInterval: 1,
      effectiveFrom: new Date(from).toISOString(),
      effectiveTo: new Date(to).toISOString(),
      serviceGroups: input.serviceGroups,
      sendEmail: false,
      dateRange: input.dateRange,
      projectStatus: input.projectStatus,
      ...(input.projectIdList?.length ? { projectIdList: input.projectIdList } : {}),
    },
  });
}

export async function createDataRequest(
  session: Session,
  input: CreateRequestInput,
): Promise<DataRequest> {
  if (!input.description.trim() || input.description.length > 200) {
    throw new Error("Provide a description of 1–200 characters.");
  }
  if (!input.serviceGroups.length || input.serviceGroups.some((group) =>
    !SERVICE_GROUPS.includes(group as (typeof SERVICE_GROUPS)[number]))) {
    throw new Error("Choose at least one supported service group.");
  }
  if (!DATE_RANGES.includes(input.dateRange)) {
    throw new Error("Choose a supported activity window.");
  }
  if (input.projectStatus && !["all", "active", "archived"].includes(input.projectStatus)) {
    throw new Error("Choose a supported project status.");
  }
  if (input.projectIdList && (input.projectIdList.length > 50 ||
      input.projectIdList.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) {
    throw new Error("Select at most 50 valid project IDs for one request.");
  }
  const body: Record<string, unknown> = {
    description: input.description.trim(),
    isActive: true,
    scheduleInterval: "ONE_TIME",
    // "If the date and time is before the current time, execution begins immediately."
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    serviceGroups: input.serviceGroups,
    sendEmail: false,
    dateRange: input.dateRange,
    projectStatus: input.projectStatus ?? "all",
  };

  if (input.dateRange === "CUSTOM") {
    if (!input.startDate || !input.endDate) {
      throw new Error("A CUSTOM date range needs both a start date and an end date.");
    }
    const start = Date.parse(input.startDate);
    const end = Date.parse(input.endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new Error("The CUSTOM date range must have a valid end on or after its start.");
    }
    if (end - start >= 31 * 86_400_000) {
      throw new Error("Data Connector caps custom activity extraction at 31 days. Split this into multiple requests.");
    }
    body.startDate = input.startDate;
    body.endDate = input.endDate;
  }

  // Omitting projectIdList extracts every project the hub admin can see.
  if (input.projectIdList?.length) {
    if (input.projectIdList.length > 50) {
      throw new Error("Data Connector accepts at most 50 project IDs per request.");
    }
    body.projectIdList = input.projectIdList;
  }

  return apsFetch<DataRequest>(session, `${base()}/requests`, { method: "POST", body });
}

export async function listRequests(session: Session): Promise<DataRequest[]> {
  // A complete result is needed before a refresh can distinguish a missing
  // schedule from one that simply fell outside a local page cap.
  return apsPaginate<DataRequest>(session, `${base()}/requests`, {
    limit: 50,
    maxPages: 100,
    searchParams: { sort: "desc" },
  });
}

function ensureRequestCache(): void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS data_connector_requests (
    id TEXT PRIMARY KEY,
    raw TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS data_connector_request_refreshes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    refreshed_at INTEGER NOT NULL
  )`);
}

/** Keep APS request definitions locally so the Extracts page never calls APS to render. */
export function rememberRequests(requests: DataRequest[], now = Date.now(), fullRefresh = false): void {
  ensureRequestCache();
  const db = getDb();
  const upsert = db.prepare(`INSERT INTO data_connector_requests (id, raw, last_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET raw = excluded.raw, last_seen_at = excluded.last_seen_at`);
  db.exec("BEGIN");
  try {
    for (const request of requests) {
      if (!request.id) continue;
      upsert.run(request.id, JSON.stringify(request), now);
    }
    if (fullRefresh) {
      db.prepare(`INSERT INTO data_connector_request_refreshes (id, refreshed_at) VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET refreshed_at = excluded.refreshed_at`).run(now);
    }
    db.exec("COMMIT");
    applyCachedRequestGroups();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyCachedRequestGroups(): void {
  const update = getDb().prepare("UPDATE extract_jobs SET service_groups = ? WHERE request_id = ?");
  for (const request of storedRequests()) {
    if (Array.isArray(request.serviceGroups) && request.serviceGroups.length > 0) {
      update.run(request.serviceGroups.join(","), request.id);
    }
  }
}

export type StoredRequest = DataRequest & { lastSeenAt: number; seenInLastRefresh: boolean };

export function storedRequests(): StoredRequest[] {
  ensureRequestCache();
  const marker = getDb().prepare("SELECT refreshed_at FROM data_connector_request_refreshes WHERE id = 1")
    .get() as { refreshed_at: number } | undefined;
  const rows = getDb().prepare("SELECT raw, last_seen_at FROM data_connector_requests ORDER BY last_seen_at DESC")
    .all() as Array<{ raw: string; last_seen_at: number }>;
  return rows.map((row) => ({
    ...JSON.parse(row.raw) as DataRequest,
    lastSeenAt: row.last_seen_at,
    seenInLastRefresh: !marker || row.last_seen_at >= marker.refreshed_at,
  }));
}

export async function listJobs(session: Session): Promise<DataJob[]> {
  return apsPaginate<DataJob>(session, `${base()}/jobs`, {
    limit: 50,
    maxPages: 100,
    searchParams: { sort: "desc" },
  });
}

export async function getJob(session: Session, jobId: string): Promise<DataJob> {
  return apsFetch<DataJob>(session, `${base()}/jobs/${jobId}`);
}

export async function listExtractFiles(
  session: Session,
  jobId: string,
): Promise<ExtractFile[]> {
  return apsFetch<ExtractFile[]>(session, `${base()}/jobs/${jobId}/data-listing`);
}

/** Signed URLs are valid for 60 seconds, so fetch one immediately before download. */
export async function signedUrlFor(
  session: Session,
  jobId: string,
  name: string,
): Promise<{ name: string; size: number; signedUrl: string }> {
  const body = await apsFetch<{ name: string; size: number | string; signedUrl: string }>(
    session,
    `${base()}/jobs/${jobId}/data/${encodeURIComponent(name)}`,
  );
  return { name: body.name, size: Number(body.size) || 0, signedUrl: body.signedUrl };
}

/** Mirrors the API's view of jobs into the local table, preserving ingest state. */
export function rememberJobs(jobs: DataJob[]): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO extract_jobs (job_id, request_id, status, completion_status, created_at,
                               started_at, completed_at, start_date, end_date,
                               created_by_email, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET
       request_id = excluded.request_id, status = excluded.status,
       completion_status = excluded.completion_status, started_at = excluded.started_at,
       completed_at = excluded.completed_at, start_date = excluded.start_date,
       end_date = excluded.end_date, raw = excluded.raw`,
  );

  db.exec("BEGIN");
  try {
    for (const job of jobs) {
      upsert.run(
        job.id,
        job.requestId ?? null,
        job.status ?? null,
        job.completionStatus ?? null,
        job.createdAt ?? null,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.startDate ?? null,
        job.endDate ?? null,
        job.createdByEmail ?? null,
        JSON.stringify(job),
      );
    }
    db.exec("COMMIT");
    applyCachedRequestGroups();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setJobServiceGroups(jobId: string, serviceGroups: string[]): void {
  getDb()
    .prepare("UPDATE extract_jobs SET service_groups = ? WHERE job_id = ?")
    .run(serviceGroups.join(","), jobId);
}

export type StoredJob = {
  jobId: string;
  requestId: string | null;
  status: string | null;
  completionStatus: string | null;
  createdAt: string | null;
  completedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  serviceGroups: string | null;
  ingestedAt: number | null;
  ingestError: string | null;
  activityRows: number;
};

export function storedJobs(): StoredJob[] {
  const rows = getDb()
    .prepare(
      `SELECT job_id, request_id, status, completion_status, created_at, completed_at,
              start_date, end_date, service_groups, ingested_at, ingest_error, activity_rows
       FROM extract_jobs
       ORDER BY COALESCE(created_at, '') DESC`,
    )
    .all() as Array<Record<string, string | number | null>>;

  return rows.map((row) => ({
    jobId: row.job_id as string,
    requestId: row.request_id as string | null,
    status: row.status as string | null,
    completionStatus: row.completion_status as string | null,
    createdAt: row.created_at as string | null,
    completedAt: row.completed_at as string | null,
    startDate: row.start_date as string | null,
    endDate: row.end_date as string | null,
    serviceGroups: row.service_groups as string | null,
    ingestedAt: row.ingested_at === null ? null : Number(row.ingested_at),
    ingestError: row.ingest_error as string | null,
    activityRows: Number(row.activity_rows ?? 0),
  }));
}

/** Jobs created in the last 24h, so the UI can warn before the hub hits 24. */
export function jobsInLastDay(): number {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM extract_jobs WHERE created_at > ?")
    .get(cutoff) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}
