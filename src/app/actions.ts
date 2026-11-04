"use server";

import { revalidatePath } from "next/cache";
import {
  requireHubAdminSession,
  requireSession,
} from "@/lib/aps/auth";
import { cachedProjects, syncProjects } from "@/lib/aps/admin";
import {
  createDataRequest,
  createRecurringDataRequest,
  getJob,
  listJobs,
  listRequests,
  rememberJobs,
  rememberRequests,
  setJobServiceGroups,
  type DateRange,
  type RecurringInterval,
} from "@/lib/aps/dataConnector";
import { ingestJob } from "@/lib/ingest";

export type ActionState = { ok: boolean; message: string } | null;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectedExtractProjects(formData: FormData): string[] | undefined {
  const ids = [...new Set(formData.getAll("projectIds").map(String).filter(Boolean))];
  if (ids.length === 0) return undefined;
  if (ids.length > 50) throw new Error("Select at most 50 projects per Data Connector request.");
  const known = new Set(cachedProjects().map((project) => project.id));
  if (ids.some((id) => !known.has(id))) throw new Error("A selected project is not in the synced hub list.");
  return ids;
}

export async function refreshProjects(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireHubAdminSession();
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
      projectIdList: selectedExtractProjects(formData),
    });

    // APS can create the job after this request returns. Keep the request's
    // service groups so a later Refresh jobs can classify that job correctly.
    let trackingIssue = false;
    try {
      if (request.id) rememberRequests([{ ...request, serviceGroups }]);
    } catch {
      trackingIssue = true;
    }

    // The write has already been accepted. A follow-up job refresh must not
    // turn it into an apparent failure and invite a duplicate request.
    try {
      const jobs = await listJobs(session);
      rememberJobs(jobs);
      for (const job of jobs) {
        if (job.requestId === request.id) setJobServiceGroups(job.id, serviceGroups);
      }
    } catch {
      trackingIssue = true;
    }

    revalidatePath("/extracts");
    return {
      ok: true,
      message: `Request ${request.id || "(ID unavailable)"} submitted. ${trackingIssue ? "Local tracking could not be refreshed immediately." : "Autodesk usually spawns the job within a minute."} Use "Refresh jobs" to track it.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function refreshSchedules(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const requests = await listRequests(session);
    rememberRequests(requests, Date.now(), true);
    revalidatePath("/extracts");
    return { ok: true, message: "Refreshed " + requests.length + " APS request definitions." };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function requestRecurringExtract(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const fromInput = String(formData.get("effectiveFromUtc") ?? "");
    const toInput = String(formData.get("effectiveToUtc") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fromInput) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(toInput)) {
      return { ok: false, message: "Enter a first-run time and an end date in UTC." };
    }
    const fromMs = Date.parse(fromInput + ":00.000Z");
    const toMs = Date.parse(toInput + "T23:59:59.999Z");
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) ||
        new Date(fromMs).toISOString().slice(0, 16) !== fromInput ||
        new Date(toMs).toISOString().slice(0, 10) !== toInput) {
      return { ok: false, message: "Enter valid UTC dates." };
    }
    const input = {
      description: String(formData.get("description") ?? "").trim(),
      serviceGroups: formData.getAll("serviceGroups").map(String).filter(Boolean),
      scheduleInterval: String(formData.get("scheduleInterval") ?? "") as RecurringInterval,
      effectiveFrom: new Date(fromMs).toISOString(),
      effectiveTo: new Date(toMs).toISOString(),
      dateRange: String(formData.get("dateRange") ?? "") as Exclude<DateRange, "CUSTOM">,
      projectStatus: String(formData.get("projectStatus") ?? "") as "all" | "active" | "archived",
      projectIdList: selectedExtractProjects(formData),
    };
    const created = await createRecurringDataRequest(session, input);
    if (!created.id) {
      return {
        ok: true,
        message: "APS accepted the schedule request but did not return an ID. Refresh schedules before submitting it again.",
      };
    }
    let cached = true;
    try {
      rememberRequests([{ ...input, ...created, id: created.id, isActive: created.isActive ?? true }]);
    } catch {
      cached = false;
    }
    revalidatePath("/extracts");
    return {
      ok: true,
      message: "APS schedule " + created.id + " created. " +
        (cached ? "Refresh schedules to see later APS changes." : "The local schedule cache could not update; refresh schedules before submitting again.") +
        " Jobs still need manual ingestion in Lens.",
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
