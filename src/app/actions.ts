"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  destroySession,
  getSession,
  requireSession,
} from "@/lib/aps/auth";
import { syncProjects } from "@/lib/aps/admin";
import {
  createDataRequest,
  getJob,
  listJobs,
  rememberJobs,
  setJobServiceGroups,
  type DateRange,
} from "@/lib/aps/dataConnector";
import { ingestJob } from "@/lib/ingest";

export type ActionState = { ok: boolean; message: string } | null;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  if (session) destroySession(session.id);
  await clearSessionCookie();
  redirect("/");
}

export async function refreshProjects(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const result = await syncProjects(session);
    revalidatePath("/", "layout");
    return { ok: true, message: `Synced ${result.count} projects from the hub.` };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function refreshJobs(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const jobs = await listJobs(session);
    rememberJobs(jobs);
    revalidatePath("/extracts");
    revalidatePath("/");
    return { ok: true, message: `Refreshed ${jobs.length} Data Connector jobs.` };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function requestExtract(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();

    const serviceGroups = formData.getAll("serviceGroups").map(String).filter(Boolean);
    if (serviceGroups.length === 0) {
      return { ok: false, message: "Pick at least one service group." };
    }

    const dateRange = String(formData.get("dateRange") || "PAST_7_DAYS") as DateRange;
    const startDate = String(formData.get("startDate") || "");
    const endDate = String(formData.get("endDate") || "");
    const projectStatus = String(formData.get("projectStatus") || "all") as
      | "all"
      | "active"
      | "archived";

    if (dateRange === "CUSTOM") {
      if (!startDate || !endDate) {
        return { ok: false, message: "A custom range needs both a start and an end date." };
      }
      const spanDays = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
      if (!Number.isFinite(spanDays) || spanDays < 0) {
        return { ok: false, message: "End date must be on or after the start date." };
      }
      if (spanDays >= 31) {
        return {
          ok: false,
          message:
            "Data Connector caps activity extraction at a 31-day window. Split this into multiple requests.",
        };
      }
    }

    const request = await createDataRequest(session, {
      description:
        String(formData.get("description") || "").trim() ||
        `Activity extract ${new Date().toISOString().slice(0, 16)}`,
      serviceGroups,
      dateRange,
      startDate: startDate ? `${startDate}T00:00:00.000Z` : undefined,
      endDate: endDate ? `${endDate}T23:59:59.999Z` : undefined,
      projectStatus,
    });

    // The request spawns a job asynchronously; pick it up on the next refresh.
    const jobs = await listJobs(session);
    rememberJobs(jobs);
    for (const job of jobs) {
      if (job.requestId === request.id) setJobServiceGroups(job.id, serviceGroups);
    }

    revalidatePath("/extracts");
    return {
      ok: true,
      message: `Request ${request.id} submitted. Autodesk usually spawns the job within a minute — hit "Refresh jobs" to track it.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function ingestExtract(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const jobId = String(formData.get("jobId") || "");
  if (!jobId) return { ok: false, message: "Missing job id." };

  try {
    const session = await requireSession();

    const job = await getJob(session, jobId);
    rememberJobs([job]);
    if (job.status !== "complete") {
      return { ok: false, message: `Job is "${job.status ?? "unknown"}", not complete yet.` };
    }
    if (job.completionStatus && job.completionStatus !== "success") {
      return {
        ok: false,
        message: `Job finished with completionStatus "${job.completionStatus}" — there is no extract to ingest.`,
      };
    }

    const summary = await ingestJob(session, jobId);
    revalidatePath("/", "layout");

    const ingested = summary.files.filter((file) => !file.skipped);
    const failed = summary.files.filter((file) => file.failed);
    if (ingested.length === 0) {
      return {
        ok: false,
        message: failed.length
          ? `No activity CSVs were ingested: ${failed.map((file) => `${file.name}: ${file.reason}`).join("; ")}`
          : "This extract contains no activity CSVs. Re-run the request with the 'activities' service group selected.",
      };
    }
    return {
      ok: failed.length === 0,
      message: `Ingested ${summary.totalRows.toLocaleString()} rows from ${ingested
        .map((file) => file.name)
        .join(", ")}.${failed.length
          ? ` ${failed.length} file(s) failed and can be retried: ${failed.map((file) => file.name).join(", ")}.`
          : ""}`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}
