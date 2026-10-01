import "server-only";
import { createHash } from "node:crypto";
import type { Session } from "./auth";
import { apsFetch, APS_BASE, requireLiveApsSession } from "./client";
import { env } from "../env";

type Row = Record<string, unknown>;
export type CloseoutEvidenceSource = {
  domain: string; rows: Row[]; complete: boolean; error: string | null;
  collectedAt: number; source: "live-aps";
};
export type CloseoutProjectEvidence = {
  projectId: string; collectedAt: number; sources: CloseoutEvidenceSource[];
};
const MAX_PAGES = 100;
const MAX_ROWS = 20_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const string = (v: unknown) => typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
function projectUuid(id: string): string {
  const clean = id.replace(/^b\./, "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) throw new Error("Invalid project ID.");
  return clean;
}
const dmProject = (id: string) => `b.${projectUuid(id)}`;
function versionUrn(id: string): string {
  if (!/^urn:adsk\.(?:wipprod|wipemea|wipapac):fs\.file:vf\.[A-Za-z0-9_-]+\?version=\d+$/.test(id)) throw new Error("Select a pinned Autodesk Files version.");
  return id;
}
export function safeCloseoutNextPath(next: string, collection: string): string {
  const url = new URL(next, APS_BASE);
  if (url.origin !== APS_BASE || url.pathname !== new URL(collection, APS_BASE).pathname || url.username || url.password || url.hash) {
    throw new Error("Unexpected pagination destination; source is incomplete.");
  }
  return `${url.pathname}${url.search}`;
}
function normalized(row: Row, projectId: string): Row {
  const a = object(row.attributes);
  for (const record of [row, a]) for (const key of ["project_id", "projectId", "bim360_project_id"]) {
    const existingProject = record[key];
    if (existingProject != null && string(existingProject).replace(/^b\./, "").toLowerCase() !== projectId) {
      throw new Error("A returned record identifies a different project; source is incomplete.");
    }
  }
  return { ...row, ...a, project_id: projectId, id: string(row.id), name: a.displayName ?? a.name ?? row.name ?? row.title ?? row.description ?? row.clientAssetId ?? row.id };
}

/** Offset, JSON:API, or continuation-token pages. Caps/errors never imply completeness. */
async function collect(session: Session, path: string, projectId: string, params: Record<string, string | number> = {},
  options: { method?: string; body?: unknown; pageSize?: number | null } = {}): Promise<Row[]> {
  const rows: Row[] = [];
  const paging: Record<string, string | number> = options.pageSize === null ? {} : { limit: options.pageSize ?? 100 };
  let offset = 0;
  let nextPath = path;
  let query: Record<string, string | number> = { ...paging, offset, ...params };
  const seen = new Set<string>();
  const startedAt = Date.now();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() - startedAt > 90_000) throw new Error("Scan time limit reached; source is incomplete.");
    const key = nextPath + JSON.stringify(query);
    if (seen.has(key)) throw new Error("Repeated page; source is incomplete.");
    seen.add(key);
    const result = object(await apsFetch<unknown>(session, nextPath, { searchParams: query,
      method: options.method, body: options.body, timeoutMs: 30_000 }));
    const data = result.results ?? result.data;
    if (!Array.isArray(data)) throw new Error("Collection response is not a record list.");
    const included = new Map((Array.isArray(result.included) ? result.included : []).map((v) => { const r = object(v); return [string(r.id), r]; }));
    rows.push(...data.map((v) => { const r = object(v); const tip = string(object(object(object(r.relationships).tip).data).id);
      return { ...normalized(r, projectId), ...(included.has(tip) ? { _tipVersion: included.get(tip) } : {}) }; }));
    if (rows.length > MAX_ROWS) throw new Error("Record limit reached; narrow the scope or use a Data Connector extract.");
    const pagination = object(result.pagination);
    const next = string(pagination.nextUrl) || string(object(object(result.links).next).href) || string(object(result.links).next);
    const token = string(result.continuationToken) || string(pagination.continuationToken);
    if (next) { nextPath = safeCloseoutNextPath(next, path); query = {}; continue; }
    if (token) { nextPath = path; query = { ...params, continuationToken: token }; continue; }
    const total = Number(pagination.totalResults ?? pagination.total);
    if (Number.isFinite(total)) {
      if (rows.length >= total) return rows;
      if (!data.length) throw new Error("Collection ended before its reported total.");
      offset += data.length; nextPath = path; query = { ...paging, ...params, offset }; continue;
    }
    // JSON:API explicitly exposes links; Relationships exposes a terminal token.
    if ("links" in result || "continuationToken" in result || "nextUrl" in pagination) return rows;
    if ("offset" in pagination && "limit" in pagination && data.length < Number(pagination.limit)) return rows;
    throw new Error("Pagination completeness could not be verified.");
  }
  throw new Error("Page limit reached; source is incomplete.");
}

async function relationships(session: Session, projectId: string): Promise<Row[]> {
  const path = `/bim360/relationship/v2/containers/${projectId}/relationships:search`;
  const rows: Row[] = []; const seen = new Set<string>(); let token = "";
  const startedAt = Date.now();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() - startedAt > 90_000) throw new Error("Relationship scan time limit reached.");
    if (seen.has(token)) throw new Error("Repeated relationship continuation token.");
    seen.add(token);
    const result = object(await apsFetch<unknown>(session, path, {
      searchParams: token ? { continuationToken: token } : {}, timeoutMs: 30_000,
    }));
    if (!Array.isArray(result.relationships) || !result.page || typeof result.page !== "object") {
      throw new Error("Relationship pagination response is incomplete.");
    }
    rows.push(...result.relationships.map((row) => normalized(object(row), projectId)));
    if (rows.length > MAX_ROWS) throw new Error("Relationship record limit reached.");
    token = string(object(result.page).continuationToken);
    if (!token) return rows;
  }
  throw new Error("Relationship page limit reached.");
}

/** Assets uses opaque cursors. Offset pagination is not a supported substitute. */
async function collectAssets(session: Session, path: string, projectId: string,
  params: Record<string, string | number> = {}): Promise<Row[]> {
  const rows: Row[] = []; const seen = new Set<string>();
  let cursor = ""; const startedAt = Date.now();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() - startedAt > 90_000) throw new Error("Assets scan time limit reached.");
    if (seen.has(cursor)) throw new Error("Repeated Assets cursor; source is incomplete.");
    seen.add(cursor);
    const result = object(await apsFetch<unknown>(session, path, {
      searchParams: { limit: 100, ...params, ...(cursor ? { cursorState: cursor } : {}) }, timeoutMs: 30_000,
    }));
    if (!Array.isArray(result.results)) throw new Error("Assets collection is not a record list.");
    rows.push(...result.results.map((row) => normalized(object(row), projectId)));
    if (rows.length > MAX_ROWS) throw new Error("Assets record limit reached.");
    const pagination = object(result.pagination); const paging = object(result.page);
    const cursorContainer = [pagination, paging, result].find((part) => "cursorState" in part);
    if (cursorContainer) {
      const raw = cursorContainer.cursorState;
      if (raw == null || raw === "") return rows;
      if (typeof raw !== "string" || raw.length > 16_384) throw new Error("Assets cursor is unreadable.");
      cursor = raw; continue;
    }
    const next = string(pagination.nextUrl) || string(pagination.next);
    if (next) {
      const nextUrl = new URL(safeCloseoutNextPath(next, path), APS_BASE);
      cursor = nextUrl.searchParams.get("cursorState") ?? "";
      if (!cursor) throw new Error("Assets next page has no opaque cursor.");
      continue;
    }
    const total = pagination.totalResults ?? pagination.total;
    if (typeof total === "number" && Number.isInteger(total) && total >= 0 && rows.length === total) return rows;
    throw new Error("Assets cursor completeness could not be verified.");
  }
  throw new Error("Assets page limit reached; source is incomplete.");
}

async function files(session: Session, projectId: string): Promise<Row[]> {
  const project = dmProject(projectId);
  const hub = `b.${env.hubId.replace(/^b\./, "")}`;
  const top = await apsFetch<{ data: Row[] }>(session, `/project/v1/hubs/${encodeURIComponent(hub)}/projects/${encodeURIComponent(project)}/topFolders`, { timeoutMs: 30_000 });
  if (!Array.isArray(top.data)) throw new Error("Top folders response is incomplete.");
  const queue = top.data.map((row) => ({ id: string(row.id), path: string(object(row.attributes).displayName) || string(object(row.attributes).name) }));
  const seen = new Set<string>();
  const output: Row[] = [];
  const startedAt = Date.now();
  while (queue.length) {
    if (Date.now() - startedAt > 90_000) throw new Error("Files scan time limit reached; use a project-scoped reporting extract.");
    const folder = queue.shift()!;
    if (!folder.id || seen.has(folder.id)) throw new Error("Invalid or repeated folder reference.");
    seen.add(folder.id);
    if (seen.size > 2_000) throw new Error("Folder scan limit reached.");
    output.push({ id: folder.id, name: folder.path.split("/").at(-1), folder_path: folder.path,
      project_id: projectId, record_kind: "folder" });
    const records = await collect(session, `/data/v1/projects/${encodeURIComponent(project)}/folders/${encodeURIComponent(folder.id)}/contents`, projectId);
    for (const row of records) {
      if (Date.now() - startedAt > 90_000) throw new Error("Files scan time limit reached; source is incomplete.");
      if (row.type === "folders") { queue.push({ id: string(row.id), path: `${folder.path}/${string(row.name)}` }); continue; }
      if (row.type !== "items") continue;
      const tip = object(object(object(row.relationships).tip).data);
      const tipId = string(tip.id);
      if (!tipId) throw new Error("A file does not identify its current version.");
      const includedVersion = object(row._tipVersion);
      const response = includedVersion.id === tipId ? { data: includedVersion }
        : await apsFetch<{ data: Row }>(session, `/data/v1/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(tipId)}`, { timeoutMs: 30_000 });
      if (string(response.data?.id) !== tipId) throw new Error("File version did not match its item reference.");
      const version = normalized(response.data, projectId);
      const storage = object(object(object(version.relationships).storage).data);
      output.push({ ...row, ...object(version.attributes), id: row.id, item_id: row.id, version_id: tipId,
        version_number: version.versionNumber, storage_urn: storage.id ?? null, folder_id: folder.id,
        folder_path: folder.path, is_latest: true, name: row.name, version_attributes: version.attributes, record_kind: "file" });
      if (output.length > MAX_ROWS) throw new Error("File scan limit reached.");
    }
  }
  return output;
}

async function assets(session: Session, projectId: string): Promise<Row[]> {
  const root = `/bim360/assets/v1/projects/${projectId}`;
  const [records, categories, definitions, statuses, locations] = await Promise.all([
    collectAssets(session, `/bim360/assets/v2/projects/${projectId}/assets`, projectId, { includeCustomAttributes: "true" }),
    collectAssets(session, `${root}/categories`, projectId), collectAssets(session, `${root}/custom-attributes`, projectId),
    collectAssets(session, `${root}/asset-statuses`, projectId),
    collect(session, `/construction/locations/v2/projects/${projectId}/trees/default/nodes`, projectId),
  ]);
  const category = new Map(categories.map((r) => [string(r.id), r.name]));
  const status = new Map(statuses.map((r) => [string(r.id), r.name]));
  const attribute = new Map(definitions.map((r) => [string(r.id), string(r.name)]));
  const location = new Map(locations.map((r) => [string(r.id), r]));
  const locationPath = (id: string) => {
    const parts: string[] = []; const visited = new Set<string>(); let current = location.get(id);
    while (current && parts.length < 21 && !visited.has(string(current.id))) {
      visited.add(string(current.id)); parts.unshift(string(current.name)); current = location.get(string(current.parentId));
    }
    return parts.join(" / ") || null;
  };
  return records.map((r) => {
    const values: Row = {};
    const raw = r.customAttributes;
    if (Array.isArray(raw)) for (const v of raw) { const a = object(v); const key = string(a.customAttributeId ?? a.attributeId ?? a.id); values[attribute.get(key) || key] = a.value; }
    else for (const [key, value] of Object.entries(object(raw))) values[attribute.get(key) || key] = value;
    return { ...r, ...values, id: r.id, project_id: projectId, name: r.name,
      category: category.get(string(r.categoryId)) ?? r.categoryId,
      status: status.get(string(r.statusId)) ?? null, location_id: r.locationId,
      location: locationPath(string(r.locationId)), custom_attributes: values };
  });
}

async function reviews(session: Session, projectId: string): Promise<Row[]> {
  const root = `/construction/reviews/v1/projects/${projectId}/reviews`;
  const startedAt = Date.now();
  const records = await collect(session, root, projectId, {}, { pageSize: 50 });
  if (records.length > 500) throw new Error("Review scan limit reached; use a scoped extract.");
  const result: Row[] = [];
  for (const review of records) {
    if (Date.now() - startedAt > 90_000) throw new Error("Review scan time limit reached; source is incomplete.");
    const versions = await collect(session, `${root}/${encodeURIComponent(string(review.id))}/versions`, projectId, {}, { pageSize: 50 });
    result.push({ ...review, record_kind: "review" });
    for (const version of versions) result.push({ ...version, record_kind: "review-version", review_id: review.id,
      review_status: review.status, version_id: version.versionId ?? version.versionUrn ?? version.id,
      approval_status: object(version.approvalStatus).value ?? version.approvalStatus });
  }
  return result;
}

async function transmittals(session: Session, projectId: string): Promise<Row[]> {
  const root = `/construction/transmittals/v1/projects/${projectId}/transmittals`;
  const startedAt = Date.now();
  const records = await collect(session, root, projectId);
  if (records.length > 500) throw new Error("Transmittal scan limit reached; use a scoped extract.");
  const result: Row[] = [];
  for (const row of records) {
    if (Date.now() - startedAt > 90_000) throw new Error("Transmittal scan time limit reached; source is incomplete.");
    const id = encodeURIComponent(string(row.id));
    const [documents, recipientResponse] = await Promise.all([
      collect(session, `${root}/${id}/documents`, projectId),
      apsFetch<Row>(session, `${root}/${id}/recipients`, { timeoutMs: 30_000 }),
    ]);
    if (!Array.isArray(recipientResponse.recipients) || !Array.isArray(recipientResponse.externalMembers)) {
      throw new Error("Transmittal recipients response is incomplete.");
    }
    const recipients = recipientResponse.recipients.map((r) => normalized(object(r), projectId));
    const externalMembers = recipientResponse.externalMembers.map((r) => normalized(object(r), projectId));
    if (recipients.length + externalMembers.length > MAX_ROWS) throw new Error("Transmittal recipient limit reached.");
    result.push({ ...row, documents, recipients, externalMembers, document_count: documents.length,
      recipient_count: recipients.length + externalMembers.length });
  }
  return result;
}

/** Read-only APS scan. Each failed domain is retained explicitly as unknown. */
export async function fetchCloseoutProjectEvidence(session: Session, inputProjectId: string): Promise<CloseoutProjectEvidence> {
  const projectId = projectUuid(inputProjectId);
  const collectedAt = Date.now();
  const collectors: [string, () => Promise<Row[]>][] = [
    ["files", () => files(session, projectId)], ["assets", () => assets(session, projectId)],
    ["issues", () => collect(session, `/construction/issues/v1/projects/${projectId}/issues`, projectId)],
    ["forms", () => collect(session, `/construction/forms/v1/projects/${projectId}/forms`, projectId,
      { includeInactiveFormTemplates: "true" }, { pageSize: 50 })],
    ["submittals", () => collect(session, `/construction/submittals/v2/projects/${projectId}/items`, projectId)],
    ["reviews", () => reviews(session, projectId)],
    ["rfis", () => collect(session, `/construction/rfis/v3/projects/${projectId}/search:rfis`, projectId, {},
      { method: "POST", body: {}, pageSize: null })],
    ["transmittals", () => transmittals(session, projectId)],
    ["relationships", () => relationships(session, projectId)],
    ["sheets", () => collect(session, `/construction/sheets/v1/projects/${projectId}/sheets`, projectId, { "filter[collectionId]": "*" })],
  ];
  // Limit parallel API work to three domains; never silently omit a failed source.
  const sources: CloseoutEvidenceSource[] = [];
  for (let i = 0; i < collectors.length; i += 3) sources.push(...await Promise.all(collectors.slice(i, i + 3).map(async ([domain, run]) => {
    try { return { domain, rows: await run(), complete: true, error: null, collectedAt, source: "live-aps" as const }; }
    catch (error) { return { domain, rows: [], complete: false, error: error instanceof Error ? error.message.slice(0, 500) : "Source could not be collected.", collectedAt, source: "live-aps" as const }; }
  })));
  return { projectId, collectedAt, sources };
}

export type CloseoutVersionDownload = { bytes: Uint8Array; name: string; versionId: string; itemId: string; storageUrn: string; sha256: string };
export function safeCloseoutDownloadUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(/(?:^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname) ||
    /(?:^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com\.cn$/.test(url.hostname) ||
    (url.hostname === "developer.api.autodesk.com" && url.pathname.startsWith("/oss/v2/signedresources/")))) {
    throw new Error("Unexpected signed file download destination.");
  }
  return url;
}
export async function downloadCloseoutVersion(session: Session, projectId: string, inputVersionId: string): Promise<CloseoutVersionDownload> {
  requireLiveApsSession(session);
  const versionId = versionUrn(inputVersionId);
  const response = await apsFetch<{ data: Row }>(session, `/data/v1/projects/${encodeURIComponent(dmProject(projectId))}/versions/${encodeURIComponent(versionId)}`);
  if (response.data?.id !== versionId) throw new Error("The exact selected file version was not returned.");
  const rel = object(response.data.relationships);
  const itemId = string(object(object(rel.item).data).id);
  const storageUrn = string(object(object(rel.storage).data).id);
  const match = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/.exec(storageUrn);
  if (!match || !itemId) throw new Error("This version has no downloadable storage record.");
  const signed = await apsFetch<{ status: string; url: string; size?: number }>(session,
    `/oss/v2/buckets/${encodeURIComponent(match[1])}/objects/${encodeURIComponent(match[2])}/signeds3download`,
    { searchParams: { useCdn: "false" } });
  if (signed.status !== "complete" || !signed.url) throw new Error("File storage is not ready for a complete download.");
  if (Number(signed.size) > MAX_FILE_BYTES) throw new Error("This file exceeds the 64 MiB package limit.");
  const url = safeCloseoutDownloadUrl(signed.url);
  const result = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!result.ok || !result.body) throw new Error(`File download failed (${result.status}).`);
  if (Number(result.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error("File exceeds the package limit.");
  const reader = result.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > MAX_FILE_BYTES) { await reader.cancel(); throw new Error("File exceeds the package limit."); } chunks.push(value); }
  if (signed.size !== undefined && size !== Number(signed.size)) throw new Error("File byte count differs from its storage record.");
  const bytes = Buffer.concat(chunks);
  const attributes = object(response.data.attributes);
  return { bytes, name: string(attributes.displayName ?? attributes.name) || "record", versionId, itemId, storageUrn,
    sha256: createHash("sha256").update(bytes).digest("hex") };
}
