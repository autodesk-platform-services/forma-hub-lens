"use server";

import { revalidatePath } from "next/cache";
import { requireHubAdminSession } from "@/lib/aps/auth";
import { listJobs, listRequests, listExtractFiles, rememberJobs, rememberRequests } from "@/lib/aps/dataConnector";
import { getDb } from "@/lib/db";
import { captureRowBaselines, evaluateIntegration } from "@/lib/integrationAnalysis";
import { refreshPublishedChanges, refreshPublishedSchema, registerSchemaSnapshot } from "@/lib/integrationOfficial";
import {
  addApiNotice, configureIntegrationMonitor, getManifest, parseManifestForm,
  recordRun, saveManifest, type ApiNotice,
} from "@/lib/integrationStore";

export type IntegrationActionState = { ok: boolean; message: string; manifestId?: string } | null;
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

function actor(session: { userEmail?: string | null; userId?: string | null }): string | null {
  return session.userEmail ?? session.userId ?? null;
}

function refresh(): void {
  revalidatePath("/integrations");
  revalidatePath("/integrations/schema");
  revalidatePath("/integrations/inventory");
  revalidatePath("/integrations/watch");
}

export async function saveIntegrationAction(_prev: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  try {
    const session = await requireHubAdminSession();
    const id = String(form.get("manifestId") ?? "");
    const previous = id ? getManifest(id) : undefined;
    if (id && !previous) throw new Error("Manifest no longer exists.");
    if (previous && Number(form.get("version")) !== previous.version) throw new Error("Manifest changed since editing. Reload and retry.");
    const manifest = parseManifestForm(form, previous ?? undefined);
    saveManifest(manifest, actor(session));
    refresh();
    revalidatePath(`/integrations/${manifest.id}`);
    return { ok: true, message: `Saved version ${manifest.version}.`, manifestId: manifest.id };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function runIntegrationPreflightAction(_prev: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  try {
    await requireHubAdminSession();
    const id = String(form.get("manifestId") ?? "");
    const manifest = getManifest(id);
    if (!manifest) throw new Error("Manifest not found.");
    const result = evaluateIntegration(manifest);
    recordRun(manifest, result);
    revalidatePath(`/integrations/${id}`);
    return { ok: true, message: `Preflight recorded: ${result.counts.fail} failed, ${result.counts.unknown} unknown, ${result.counts.review} needing review.` };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function captureIntegrationBaselineAction(_prev: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  try {
    const session = await requireHubAdminSession();
    const id = String(form.get("manifestId") ?? "");
    const manifest = getManifest(id);
    if (!manifest) throw new Error("Manifest not found.");
    const updated = captureRowBaselines(manifest, actor(session));
    revalidatePath(`/integrations/${id}`);
    return { ok: true, message: `Captured uploaded row counts as local baselines in version ${updated.version}.` };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function refreshIntegrationInventoryAction(_prev: IntegrationActionState, _form: FormData): Promise<IntegrationActionState> {
  try {
    const session = await requireHubAdminSession();
    const [requests, jobs] = await Promise.all([listRequests(session), listJobs(session)]);
    rememberRequests(requests, Date.now(), true);
    rememberJobs(jobs);
    refresh();
    return { ok: true, message: `Refreshed ${requests.length} APS request definitions and ${jobs.length} jobs.` };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function refreshIntegrationFilesAction(_prev: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  try {
    const session = await requireHubAdminSession();
    const jobId = String(form.get("jobId") ?? "");
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(jobId)) throw new Error("Choose a valid cached job ID.");
    const known = getDb().prepare("SELECT 1 FROM extract_jobs WHERE job_id = ?").get(jobId);
    if (!known) throw new Error("Refresh the job inventory before listing files.");
    const files = await listExtractFiles(session, jobId);
    if (files.length > 1000) throw new Error("File listing exceeds the 1,000-file review limit.");
    const upsert = getDb().prepare(`INSERT INTO extract_files (job_id, name, size)
      VALUES (?, ?, ?) ON CONFLICT(job_id, name) DO UPDATE SET size = excluded.size`);
    for (const file of files) {
      if (!file.name || file.name.length > 250) continue;
      upsert.run(jobId, file.name, Number(file.size) || null);
    }
    revalidatePath("/integrations/inventory");
    return { ok: true, message: `Cached ${files.length} file names for job ${jobId}. No files were downloaded.` };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function refreshIntegrationSchemaAction(_prev: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  try {
    await requireHubAdminSession();
    const groups = form.getAll("groups").map(String);
    const snapshot = await refreshPublishedSchema(groups.length ? groups : ["takeoff", "estimates", "classifications"]);
    refresh();
    return { ok: true, message: `Captured Autodesk's public JSON schema for ${groups.length || 3} selected service groups at ${new Date(snapshot.capturedAt).toISOString()}.` };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function refreshIntegrationChangesAction(_prev: IntegrationActionState, _form: FormData): Promise<IntegrationActionState> {
  try {
    await requireHubAdminSession();
    const snapshot = await refreshPublishedChanges();
    refresh();
    return { ok: true, message: `Captured Autodesk's public JSON change feed at ${new Date(snapshot.capturedAt).toISOString()}.` };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function registerIntegrationSchemaAction(_prev: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  try {
    await requireHubAdminSession();
    registerSchemaSnapshot(String(form.get("schemaJson") ?? ""), String(form.get("sourceUrl") ?? ""));
    refresh();
    return { ok: true, message: "Registered the supplied schema as an admin-entered reference. Its source authenticity has not been verified by Lens." };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function addIntegrationNoticeAction(_prev: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  try {
    const session = await requireHubAdminSession();
    const title = String(form.get("title") ?? "").trim().slice(0, 150);
    const description = String(form.get("description") ?? "").trim().slice(0, 1000);
    const sourceUrl = String(form.get("sourceUrl") ?? "").trim();
    if (!title || !description) throw new Error("Notice title and impact description are required.");
    if (sourceUrl.length > 500) throw new Error("Notice URL is too long.");
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw new Error("Provide an official Autodesk notice URL."); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search ||
        !["aps.autodesk.com", "help.autodesk.com", "developer.api.autodesk.com"].includes(url.hostname)) {
      throw new Error("Only official Autodesk notice links may be recorded.");
    }
    const publishedOn = String(form.get("publishedOn") ?? "").trim() || null;
    const effectiveOn = String(form.get("effectiveOn") ?? "").trim() || null;
    if ([publishedOn, effectiveOn].some((date) => date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new Error("Dates must use YYYY-MM-DD.");
    const affectedPaths = String(form.get("affectedPaths") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!affectedPaths.length || affectedPaths.length > 40 || affectedPaths.some((path) => !/^\/[a-zA-Z0-9_./:{}*-]+$/.test(path))) {
      throw new Error("Enter 1–40 relative API paths without query strings or secrets.");
    }
    const notice: ApiNotice = {
      id: crypto.randomUUID(), title, description, sourceUrl, publishedOn, effectiveOn,
      affectedPaths, recordedAt: Date.now(), recordedBy: actor(session),
    };
    addApiNotice(notice);
    revalidatePath("/integrations/watch");
    return { ok: true, message: "Notice recorded as an admin-entered interpretation of the linked Autodesk source." };
  } catch (error) { return { ok: false, message: describe(error) }; }
}

export async function configureIntegrationMonitorAction(_prev: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  try {
    await requireHubAdminSession();
    const enabled = form.get("enabled") === "on";
    const interval = Number(form.get("intervalMinutes") ?? 360);
    configureIntegrationMonitor(enabled, interval);
    revalidatePath("/integrations");
    return { ok: true, message: enabled ? `Monitor enabled every ${interval} minutes while this server runs.` : "Monitor disabled." };
  } catch (error) { return { ok: false, message: describe(error) }; }
}
