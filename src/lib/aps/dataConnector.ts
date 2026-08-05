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

export async function createDataRequest(
  session: Session,
  input: CreateRequestInput,
): Promise<DataRequest> {
  const body: Record<string, unknown> = {
    description: input.description,
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
  return apsPaginate<DataRequest>(session, `${base()}/requests`, {
    limit: 50,
    maxPages: 10,
    searchParams: { sort: "desc" },
  });
}

export async function listJobs(session: Session): Promise<DataJob[]> {
  return apsPaginate<DataJob>(session, `${base()}/jobs`, {
    limit: 50,
    maxPages: 10,
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
