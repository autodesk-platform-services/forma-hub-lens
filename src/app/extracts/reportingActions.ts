"use server";

import { revalidatePath } from "next/cache";
import { requireHubAdminSession } from "@/lib/aps/auth";
import { ingestReportingJob } from "@/lib/reportingIngest";
import type { ActionState } from "../actions";

export async function ingestReportingExtract(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireHubAdminSession();
    const jobId = String(formData.get("jobId") ?? "");
    const { summary } = await ingestReportingJob(session, jobId);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Imported ${summary.tables.length} APS reporting tables (${summary.totalRows.toLocaleString()} rows).` +
        (summary.truncatedTables.length
          ? ` ${summary.truncatedTables.length} table(s) reached the 400,000-row limit and are marked truncated.`
          : "") +
        " Source job, request, scope, and service groups were recorded for review.",
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Reporting ingest failed." };
  }
}
