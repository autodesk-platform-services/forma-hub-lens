import "server-only";

import { createHash } from "node:crypto";
import { saveOfficialSnapshot, type OfficialSnapshot } from "./integrationStore";
import { env } from "./env";

export const OFFICIAL_SCHEMA_URL = "https://developer.api.autodesk.com/data-connector/v1/doc";
export const OFFICIAL_CHANGES_URL = "https://developer.api.autodesk.com/data-connector/v1/doc/changes";
export const SCHEMA_SERVICE_GROUPS = [
  "activities", "admin", "assets", "classifications", "cost", "estimates", "forms", "issues",
  "locations", "meetingminutes", "photos", "rfis", "sheets", "submittals", "takeoff",
] as const;
export const CLASSIFICATION_NOTICE_URL = "https://help.autodesk.com/cloudhelp/ENU/Docs-Insight/files/data-connector/Data_Connector_Change_Notice.html";
export const TREE_CONNECTION_NOTICE_URL = "https://aps.autodesk.com/blog/deprecation-notice-isbasedonaccounttree-autodesk-forma-classifications-api";

export const PUBLISHED_MIGRATION = {
  sourceUrl: CLASSIFICATION_NOTICE_URL,
  status: "upcoming change",
  datesSubjectToChange: true,
  milestones: [
    { date: "2026-10-15", label: "Newly created projects use the new classification model" },
    { date: "2026-11-30", label: "Existing projects start converting one by one" },
    { date: "2027-01-29", label: "Support for deprecated classification fields ends" },
  ],
  mappings: [
    { service: "takeoff", table: "quantity_definitions", legacy: "classification1_id", replacement: "classification1_node_id" },
    { service: "takeoff", table: "quantity_definitions", legacy: "classification2_id", replacement: "classification2_node_id" },
    { service: "takeoff", table: "quantity_definitions", legacy: null, replacement: "classification3_node_id through classification5_node_id" },
    { service: "takeoff", table: "quantities", legacy: "classification1_id, classification2_id", replacement: "join to quantity_definitions through takeoff_items" },
    { service: "takeoff", table: "classification_systems", legacy: "all columns", replacement: "classifications service group" },
    { service: "takeoff", table: "takeoff_items", legacy: "content_version (Sheets ID)", replacement: "content_version (Autodesk Files version URN)" },
    { service: "takeoff", table: "settings", legacy: null, replacement: "forma_classifications Boolean" },
    { service: "estimates", table: "estimation_instances", legacy: "classification1_id", replacement: "classification1_node_id" },
    { service: "estimates", table: "estimation_instances", legacy: "classification2_id", replacement: "classification2_node_id" },
    { service: "estimates", table: "estimation_instances", legacy: null, replacement: "classification3_node_id through classification5_node_id" },
    { service: "estimates", table: "classification_systems", legacy: "all columns", replacement: "classifications service group" },
    { service: "estimates", table: "settings", legacy: null, replacement: "forma_classifications Boolean" },
  ],
} as const;

export const PUBLISHED_API_NOTICE = {
  title: "Forma Classifications API: isBasedOnAccountTree removal",
  sourceUrl: TREE_CONNECTION_NOTICE_URL,
  effectiveOn: "2027-03-23",
  affectedPaths: ["/classification/v1/accounts/{accountId}/trees", "/classification/v1/accounts/{accountId}/trees/{treeId}"],
  summary: "Use treeConnectionType. A former true maps to connected; a former false can mean standalone or disconnected.",
} as const;

const MAX_PUBLIC_DOC_BYTES = 5 * 1024 * 1024;
const ALLOWED_URLS = new Set([
  `${OFFICIAL_CHANGES_URL}?format=json`,
  ...SCHEMA_SERVICE_GROUPS.map((group) => `${OFFICIAL_SCHEMA_URL}/schema?name=${group}&format=json`),
]);

/** Fixed Autodesk documentation endpoints only; never fetch a manifest-provided URL. */
async function fetchOfficialJson(_url: string): Promise<unknown> {
  throw new Error("The demo uses sample schema notices. Autodesk documentation refresh is disabled.");
}

function storeFetched(kind: "schema" | "changes", sourceUrl: string, body: unknown): OfficialSnapshot {
  const snapshot: OfficialSnapshot = {
    id: crypto.randomUUID(), kind, source: "autodesk_endpoint", sourceUrl,
    capturedAt: Date.now(), body,
    digest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
  saveOfficialSnapshot(snapshot);
  return snapshot;
}

export async function refreshPublishedSchema(groups: string[] = ["takeoff", "estimates", "classifications"]): Promise<OfficialSnapshot> {
  const selected = [...new Set(groups)];
  if (selected.length === 0 || selected.length > 10 || selected.some((group) =>
    !SCHEMA_SERVICE_GROUPS.includes(group as (typeof SCHEMA_SERVICE_GROUPS)[number]))) {
    throw new Error("Choose 1–10 configured Autodesk service groups.");
  }
  const serviceGroups: Record<string, unknown> = {};
  for (const group of selected) {
    serviceGroups[group] = await fetchOfficialJson(`${OFFICIAL_SCHEMA_URL}/schema?name=${group}&format=json`);
  }
  return storeFetched("schema", OFFICIAL_SCHEMA_URL, { serviceGroups });
}

export async function refreshPublishedChanges(): Promise<OfficialSnapshot> {
  return storeFetched("changes", OFFICIAL_CHANGES_URL, await fetchOfficialJson(`${OFFICIAL_CHANGES_URL}?format=json`));
}

export function registerSchemaSnapshot(json: string, sourceUrl: string): OfficialSnapshot {
  if (json.length > 2 * 1024 * 1024) throw new Error("Registered schema JSON exceeds 2 MB.");
  if (sourceUrl.length > 500) throw new Error("Documentation URL is too long.");
  let parsedUrl: URL;
  try { parsedUrl = new URL(sourceUrl); }
  catch { throw new Error("Use an Autodesk Data Connector documentation URL."); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.hash ||
      parsedUrl.hostname !== "developer.api.autodesk.com" ||
      !(ALLOWED_URLS.has(parsedUrl.href) || parsedUrl.href === OFFICIAL_SCHEMA_URL)) {
    throw new Error("Use an Autodesk Data Connector documentation URL.");
  }
  let body: unknown;
  try { body = JSON.parse(json) as unknown; }
  catch { throw new Error("Schema snapshot must be valid JSON."); }
  if (!body || typeof body !== "object") throw new Error("Schema snapshot must contain an object or array.");
  const snapshot: OfficialSnapshot = {
    id: crypto.randomUUID(), kind: "schema", source: "admin_registered", sourceUrl,
    capturedAt: Date.now(), body,
    digest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
  saveOfficialSnapshot(snapshot);
  return snapshot;
}

export type PublishedColumn = { name: string; type: string | null };
export type PublishedTable = { service: string | null; table: string; columns: PublishedColumn[] };

/** Recognize conservative documented JSON shapes; unknown shapes stay unparsed. */
export function parsePublishedTables(body: unknown): PublishedTable[] | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const source = root.serviceGroups ?? root.services ?? root.entities ?? root.tables;
  if (!source || typeof source !== "object") return null;
  const tables: PublishedTable[] = [];
  function parseTable(service: string | null, tableName: string, value: unknown): void {
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const rawColumns = object.columns ?? object.fields ?? (Object.values(object).every((entry) =>
      entry && typeof entry === "object" && ("data_type" in (entry as Record<string, unknown>) || "ordinal_position" in (entry as Record<string, unknown>)))
      ? object : null);
    const columns: PublishedColumn[] = [];
    if (Array.isArray(rawColumns)) {
      for (const field of rawColumns) {
        if (!field || typeof field !== "object") continue;
        const item = field as Record<string, unknown>;
        const name = item.name ?? item.columnName ?? item.fieldName;
        if (typeof name === "string") columns.push({ name, type: typeof item.type === "string" ? item.type : null });
      }
    } else if (rawColumns && typeof rawColumns === "object") {
      for (const [name, value] of Object.entries(rawColumns)) {
        const type = typeof value === "string" ? value : value && typeof value === "object" &&
          (typeof (value as Record<string, unknown>).type === "string" || typeof (value as Record<string, unknown>).data_type === "string")
          ? String((value as Record<string, unknown>).type ?? (value as Record<string, unknown>).data_type) : null;
        columns.push({ name, type });
      }
    }
    if (columns.length > 0) tables.push({ service, table: tableName, columns });
  }
  function parseService(serviceName: string, value: unknown): void {
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const rawTables = object.tables ?? object.csvTables ?? object.files ?? object;
    if (!rawTables || typeof rawTables !== "object") return;
    if (Array.isArray(rawTables)) {
      for (const item of rawTables) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const name = row.name ?? row.tableName ?? row.fileName;
        if (typeof name === "string") parseTable(serviceName, name.replace(/\.csv$/i, ""), item);
      }
    } else {
      for (const [name, item] of Object.entries(rawTables)) parseTable(serviceName, name.replace(/\.csv$/i, ""), item);
    }
  }
  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const service = row.name ?? row.serviceGroup ?? row.key;
      if (typeof service === "string") parseService(service, item);
      else if (typeof row.name === "string") parseTable(null, row.name, item);
    }
  } else {
    for (const [name, item] of Object.entries(source)) {
      if ("tables" in (item && typeof item === "object" ? item as Record<string, unknown> : {}) || root.serviceGroups === source) parseService(name, item);
      else parseTable(null, name, item);
    }
  }
  return tables.length > 0 ? tables : null;
}

export type PublishedChange = {
  serviceGroup: string;
  table: string;
  column: string;
  changeType: string;
  notes: string;
  watermark: string;
  year: string;
  month: string;
};

export function parsePublishedChanges(body: unknown): { watermark: string; changes: PublishedChange[] } | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  if (!Array.isArray(root.changes)) return null;
  const changes: PublishedChange[] = [];
  for (const item of root.changes) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.change_type !== "string") continue;
    changes.push({
      serviceGroup: String(row.service_group ?? ""), table: String(row.table ?? ""),
      column: String(row.column ?? ""), changeType: row.change_type,
      notes: String(row.notes ?? ""), watermark: String(row.watermark ?? ""),
      year: String(row.year ?? ""), month: String(row.month ?? ""),
    });
  }
  return { watermark: String(root.watermark ?? ""), changes };
}
