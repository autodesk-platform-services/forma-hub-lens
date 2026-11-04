import type { CloseoutSource } from "./closeoutEngine";
import type { PackageFile } from "./closeoutPackage";
import type { SelectedRecord } from "./closeoutStore";

export type AssetLinkDomain = CloseoutSource["domain"] | "photos" | "locations";
export type AssetEvidenceSource = Pick<CloseoutSource, "kind" | "revision" | "complete" | "coverage" | "rows" | "note"> & {
  domain: AssetLinkDomain;
};
export type AssetHandoverUnknown = { code: string; detail: string };
export type AssetHandoverLink = {
  domain: AssetLinkDomain;
  recordId: string;
  versionId: string | null;
  name: string | null;
  status: string | null;
  relationshipId: string | null;
  relationshipType: string | null;
  resolution: "resolved" | "unverified" | "unsupported";
  reason: string | null;
  pinnedVersionId: string | null;
  archivePath: string | null;
  outcome: PackageFile["outcome"] | null;
};
export type AssetHandoverRecord = {
  id: string;
  name: string;
  category: string | null;
  status: string | null;
  location: { id: string | null; path: string | null };
  metadata: Record<string, string>;
  links: AssetHandoverLink[];
  unknownReasons: AssetHandoverUnknown[];
};
export type AssetHandoverIndex = {
  format: "forma-hub-lens-asset-handover-v1";
  projectId: string;
  assets: AssetHandoverRecord[];
  sourceEvidence: Array<{ domain: AssetLinkDomain; kind: AssetEvidenceSource["kind"]; revision: string | null;
    complete: boolean; coverage: AssetEvidenceSource["coverage"]; rowCount: number; note: string | null }>;
  unknownReasons: AssetHandoverUnknown[];
  truncated: boolean;
};
export type AssetHandoverInput = {
  projectId: string;
  sources: readonly AssetEvidenceSource[];
  selections: readonly SelectedRecord[];
  packageFiles: readonly PackageFile[];
};

const MAX_ASSETS = 10_000;
const MAX_RELATIONSHIPS = 25_000;
const MAX_LINKS_PER_ASSET = 500;
const MAX_METADATA_FIELDS = 40;
const MAX_METADATA_VALUE = 300;

const aliases: Record<string, AssetLinkDomain> = {
  asset: "assets", assets: "assets", file: "files", files: "files", document: "files", documents: "files", docs: "files",
  issue: "issues", issues: "issues", form: "forms", forms: "forms", rfi: "rfis", rfis: "rfis",
  submittal: "submittals", submittals: "submittals", photo: "photos", photos: "photos",
  location: "locations", locations: "locations", review: "reviews", reviews: "reviews",
  transmittal: "transmittals", transmittals: "transmittals", sheet: "sheets", sheets: "sheets",
};
const entityKind = (raw: unknown): AssetLinkDomain | null => {
  if (typeof raw !== "string") return null;
  const value = raw.toLowerCase().trim();
  const parts = value.split(/[.:/\s_-]+/).filter(Boolean);
  return aliases[value] ?? [...parts].reverse().map((part) => aliases[part]).find(Boolean) ?? null;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string => value == null || typeof value === "object" ? "" : String(value).trim();
const first = (row: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) { const value = string(row[key]); if (value) return value; }
  return "";
};
const idOf = (row: Record<string, unknown>): string => first(row, ["item_id", "id", "issue_id", "urn"]);
const versionOf = (row: Record<string, unknown>): string => first(row, ["version_id", "versionId", "version_urn"]);
const named = (row: Record<string, unknown>): string => first(row, ["name", "display_name", "displayName", "title", "file_name", "description"]);
const trustworthy = (source: AssetEvidenceSource | undefined): boolean => Boolean(source?.complete && source.coverage !== "unverified" && source.kind !== "missing");
const unknown = (code: string, detail: string): AssetHandoverUnknown => ({ code, detail });
function addUnknown(target: AssetHandoverUnknown[], item: AssetHandoverUnknown): void {
  if (!target.some((existing) => existing.code === item.code && existing.detail === item.detail)) target.push(item);
}
function safeMetadata(row: Record<string, unknown>): { values: Record<string, string>; truncated: boolean } {
  const result: Record<string, string> = {};
  let truncated = false;
  const blocked = /(?:token|secret|password|authorization|credential|cookie|signedurl|downloadurl|api[_-]?key|bearer|url$)/i;
  const controls = new Set(["project_id", "bim360_project_id", "relationships", "custom_attributes", "attributes", "_tipversion"]);
  const add = (key: string, value: unknown) => {
    if (blocked.test(key) || controls.has(key.toLowerCase()) || value == null || typeof value === "object") return;
    const text = string(value);
    if (!text) return;
    if (Object.keys(result).length >= MAX_METADATA_FIELDS) { truncated = true; return; }
    if (text.length > MAX_METADATA_VALUE || key.length > 80) truncated = true;
    result[key.slice(0, 80)] = text.slice(0, MAX_METADATA_VALUE);
  };
  for (const [key, value] of Object.entries(object(row.custom_attributes))) add(key, value);
  for (const [key, value] of Object.entries(row)) add(key, value);
  return { values: result, truncated };
}
type Endpoint = { domain: AssetLinkDomain | null; id: string; versionId: string };
type Relationship = { id: string; type: string; endpoints: Endpoint[] };
function parseRelationship(row: Record<string, unknown>): Relationship | null {
  const raw = Array.isArray(row.entities) && row.entities.length >= 2 ? row.entities : [
    { ...object(row.sourceEntity), id: first(row, ["source_id", "sourceId", "from_id", "fromId"]) ||
      first(object(row.sourceEntity), ["id", "externalId", "urn"]),
    domain: first(row, ["source_type", "sourceType", "from_type", "fromType"]) ||
      first(object(row.sourceEntity), ["domain", "type", "kind", "entityType"]) },
    { ...object(row.targetEntity), id: first(row, ["target_id", "targetId", "to_id", "toId"]) ||
      first(object(row.targetEntity), ["id", "externalId", "urn"]),
    domain: first(row, ["target_type", "targetType", "to_type", "toType"]) ||
      first(object(row.targetEntity), ["domain", "type", "kind", "entityType"]) },
  ];
  if (raw.length < 2) return null;
  const endpoints = raw.map((item) => {
    const entity = object(item);
    return { domain: entityKind(entity.domain ?? entity.type ?? entity.kind ?? entity.entityType),
      id: first(entity, ["id", "externalId", "urn", "item_id"]), versionId: first(entity, ["version_id", "versionId"]) };
  });
  if (endpoints.some((endpoint) => !endpoint.id)) return null;
  return { id: first(row, ["id", "relationship_id"]), type: first(row, ["relationship_type", "relationshipType", "type"]), endpoints };
}
function sourceIndex(source: AssetEvidenceSource | undefined): Map<string, Record<string, unknown>[]> {
  const index = new Map<string, Record<string, unknown>[]>();
  for (const row of source?.rows ?? []) {
    if (source?.domain === "files" && ["folder", "folders"].includes(first(row, ["record_kind", "type"]).toLowerCase())) continue;
    for (const key of new Set([idOf(row), versionOf(row)].filter(Boolean))) {
      const values = index.get(key) ?? []; values.push(row); index.set(key, values);
    }
  }
  return index;
}
function linkFor(endpoint: Endpoint, relationship: Relationship, byDomain: Map<AssetLinkDomain, AssetEvidenceSource>,
  indexes: Map<AssetLinkDomain, Map<string, Record<string, unknown>[]>>,
  selections: readonly SelectedRecord[], packageFiles: readonly PackageFile[]): AssetHandoverLink {
  const domain = endpoint.domain!;
  const source = byDomain.get(domain);
  const candidates = indexes.get(domain)?.get(endpoint.versionId || endpoint.id) ?? [];
  const matches = endpoint.versionId ? candidates.filter((candidate) =>
    endpoint.id === idOf(candidate) || endpoint.id === versionOf(candidate)) : candidates;
  const row = matches.length === 1 ? matches[0] : null;
  const common = {
    domain, recordId: endpoint.id, versionId: endpoint.versionId || (row ? versionOf(row) : "") || null,
    name: row ? named(row) || null : null, status: row ? first(row, ["status", "status_value", "state"]) || null : null,
    relationshipId: relationship.id || null, relationshipType: relationship.type || null,
  };
  let reason: string | null = null;
  if (!source || !trustworthy(source)) reason = `Complete, project-covered ${domain} evidence is unavailable.`;
  else if (matches.length === 0) reason = `The exact ${domain} target is absent from current evidence.`;
  else if (matches.length > 1) reason = `The exact ${domain} target resolves to multiple source rows.`;
  if (domain !== "files") return { ...common, resolution: reason ? "unverified" : "resolved", reason,
    pinnedVersionId: null, archivePath: null, outcome: null };
  const itemId = row ? idOf(row) : "";
  const versionId = row ? versionOf(row) : "";
  const pinned = row && source ? selections.find((selection) => selection.domain === "files" && selection.externalId === itemId &&
    selection.versionId === versionId && selection.sourceKind === source.kind && selection.sourceRevision === source.revision) : null;
  const packaged = pinned ? packageFiles.find((file) => file.selectionId === pinned.id && file.sourceId === itemId && file.versionId === versionId) : null;
  if (!reason && !pinned) reason = "The linked file has no current pinned exact version.";
  return { ...common, resolution: reason ? "unverified" : "resolved", reason,
    pinnedVersionId: pinned?.versionId ?? null,
    archivePath: packaged?.outcome === "included" ? packaged.archivePath : null,
    outcome: packaged?.outcome ?? null };
}

/** Build asset-centered handover records solely from exact, current project evidence. */
export function buildAssetHandover(input: AssetHandoverInput): AssetHandoverIndex {
  const byDomain = new Map(input.sources.map((source) => [source.domain, source]));
  const index: AssetHandoverIndex = {
    format: "forma-hub-lens-asset-handover-v1", projectId: input.projectId,
    assets: [], sourceEvidence: input.sources.map((source) => ({ domain: source.domain, kind: source.kind,
      revision: source.revision, complete: source.complete, coverage: source.coverage,
      rowCount: source.rows.length, note: source.note })), unknownReasons: [], truncated: false,
  };
  const assets = byDomain.get("assets");
  if (!trustworthy(assets)) addUnknown(index.unknownReasons, unknown("asset-source-unverified", "Complete, project-covered Assets evidence is unavailable."));
  const relationships = byDomain.get("relationships");
  if (!trustworthy(relationships)) addUnknown(index.unknownReasons, unknown("relationships-unverified", "Asset connections cannot be concluded without complete, project-covered Relationships evidence."));
  const sourceIndexes = new Map<AssetLinkDomain, Map<string, Record<string, unknown>[]>>();
  for (const [domain, source] of byDomain) sourceIndexes.set(domain, sourceIndex(source));
  const relationshipRows = relationships?.rows ?? [];
  if (relationshipRows.length > MAX_RELATIONSHIPS) { index.truncated = true;
    addUnknown(index.unknownReasons, unknown("relationship-limit", `Only the first ${MAX_RELATIONSHIPS} relationship rows were reviewed.`)); }
  const parsed = relationshipRows.slice(0, MAX_RELATIONSHIPS).map(parseRelationship);
  if (parsed.some((item) => !item)) addUnknown(index.unknownReasons,
    unknown("relationship-shape-unresolved", "Some relationship rows lack parseable, typed endpoints."));
  const linksByAsset = new Map<string, Array<{ relationship: Relationship; endpoint: Endpoint }>>();
  for (const relationship of parsed) {
    if (!relationship) continue;
    const assetEnds = relationship.endpoints.filter((endpoint) => endpoint.domain === "assets" && endpoint.id);
    if (!assetEnds.length) {
      if (relationship.endpoints.some((endpoint) => !endpoint.domain || !endpoint.id)) addUnknown(index.unknownReasons,
        unknown("relationship-endpoint-unresolved", "Some relationship endpoints cannot be typed or identified."));
      continue;
    }
    for (const asset of assetEnds) for (const endpoint of relationship.endpoints) {
      if (endpoint === asset) continue;
      const links = linksByAsset.get(asset.id) ?? []; links.push({ relationship, endpoint }); linksByAsset.set(asset.id, links);
    }
  }
  const assetRows = assets?.rows ?? [];
  if (assetRows.length > MAX_ASSETS) { index.truncated = true;
    addUnknown(index.unknownReasons, unknown("asset-limit", `Only the first ${MAX_ASSETS} asset rows were indexed.`)); }
  for (const row of assetRows.slice(0, MAX_ASSETS)) {
    const id = idOf(row);
    if (!id) { addUnknown(index.unknownReasons, unknown("asset-id-missing", "An asset record has no stable ID and could not be linked.")); continue; }
    const metadata = safeMetadata(row);
    const item: AssetHandoverRecord = {
      id, name: named(row) || id, category: first(row, ["category", "category_name"]) || null,
      status: first(row, ["status", "status_name"]) || null,
      location: { id: first(row, ["location_id", "locationId"]) || null,
        path: first(row, ["location_path", "location_name", "location"]) || null },
      metadata: metadata.values, links: [], unknownReasons: [],
    };
    if (metadata.truncated) addUnknown(item.unknownReasons, unknown("asset-metadata-truncated", "Asset metadata was shortened to keep the handover index within safety limits."));
    if (!trustworthy(assets)) addUnknown(item.unknownReasons, unknown("asset-source-unverified", "Asset metadata may be incomplete or outside verified project scope."));
    if (!trustworthy(relationships)) addUnknown(item.unknownReasons, unknown("relationships-unverified", "Linked records cannot be concluded without complete Relationships evidence."));
    for (const issue of index.unknownReasons.filter((issue) => issue.code.startsWith("relationship-"))) addUnknown(item.unknownReasons, issue);
    const connections = linksByAsset.get(id) ?? [];
    if (connections.length > MAX_LINKS_PER_ASSET) { index.truncated = true;
      addUnknown(item.unknownReasons, unknown("asset-link-limit", `Only the first ${MAX_LINKS_PER_ASSET} links for this asset were indexed.`)); }
    for (const { relationship, endpoint } of connections.slice(0, MAX_LINKS_PER_ASSET)) {
      if (!endpoint.domain || !endpoint.id) {
        addUnknown(item.unknownReasons, unknown("unsupported-endpoint", `Relationship ${relationship.id || "(unidentified)"} has an untyped or unidentified endpoint.`));
        continue;
      }
      const link = linkFor(endpoint, relationship, byDomain, sourceIndexes, input.selections, input.packageFiles);
      item.links.push(link);
      if (link.reason) addUnknown(item.unknownReasons, unknown("linked-record-unverified", `${link.domain} ${link.recordId}: ${link.reason}`));
    }
    if (item.location.id && !item.location.path) {
      const locationSource = byDomain.get("locations");
      const resolved = sourceIndexes.get("locations")?.get(item.location.id);
      if (trustworthy(locationSource) && resolved?.length === 1) item.location.path = first(resolved[0], ["path", "name", "display_name"]) || null;
      if (!item.location.path) addUnknown(item.unknownReasons, unknown("location-unverified", "The exact location ID has no resolved location path in current evidence."));
    }
    index.assets.push(item);
  }
  return index;
}
