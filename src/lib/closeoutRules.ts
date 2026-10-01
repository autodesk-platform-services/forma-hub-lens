import { createHash } from "node:crypto";
import type { CloseoutFinding, CloseoutSource } from "./closeoutEngine";
import type { CloseoutDomain, ExpectedDeliverable, SelectedRecord } from "./closeoutStore";

/** A profile's requirements are explicit. Nothing becomes a blocker simply because a domain exists. */
export type FileRule = {
  id: string;
  label: string;
  folderPath?: string;
  includeDescendants?: boolean;
  extensions?: string[];
  namePattern?: string;
  minCount?: number;
  requireLatestFinalVersion?: boolean;
  requiredMetadata?: string[];
};
export type AssetRule = {
  id: string;
  label: string;
  category?: string;
  status?: string;
  location?: string;
  attributes?: Record<string, string>;
  minCount?: number;
  requireDocumentRelationship?: boolean;
  requiredMetadata?: string[];
};
export type RelationshipRule = {
  id: string;
  label: string;
  fromDomain: CloseoutDomain;
  toDomain: CloseoutDomain;
  relationshipType?: string;
  minCount?: number;
};
export type MetadataRule = { field: string; label?: string; equals?: string };
export type StatusPolicy = {
  domain: CloseoutDomain;
  openStatuses: string[];
  terminalStatuses?: string[];
};
export type CloseoutRuleConfig = {
  version: 1;
  files: FileRule[];
  assets: AssetRule[];
  relationships: RelationshipRule[];
  projectMetadata: MetadataRule[];
  statusPolicies: StatusPolicy[];
};
export type RuleExpectedDeliverable = ExpectedDeliverable & {
  /** Optional source-independent matching when an exact APS ID is not known at planning time. */
  namePattern?: string | null;
  folderPath?: string | null;
};
export type CloseoutRuleInput = {
  rules: CloseoutRuleConfig;
  sources: CloseoutSource[];
  selections: SelectedRecord[];
  expected: RuleExpectedDeliverable[];
  /** A current synced project record. An omitted field remains unknown, never silently compliant. */
  projectMetadata?: Record<string, unknown>;
};

export function defaultCloseoutRules(): CloseoutRuleConfig {
  return { version: 1, files: [], assets: [], relationships: [], projectMetadata: [], statusPolicies: [] };
}

const MAX_FINDINGS = 500;
const domainAliases: Partial<Record<CloseoutDomain, string[]>> = {
  files: ["files", "file", "docs", "document", "documents", "item", "version"],
  assets: ["assets", "asset"], issues: ["issues", "issue"],
  forms: ["forms", "form"], submittals: ["submittals", "submittal"],
  reviews: ["reviews", "review"], rfis: ["rfis", "rfi"],
  transmittals: ["transmittals", "transmittal"],
  relationships: ["relationships", "relationship"], sheets: ["sheets", "sheet"],
};

function normalizedKey(raw: string): string { return raw.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function field(row: Record<string, unknown>, keys: string[]): { present: boolean; value: string } {
  let present = false;
  for (const key of keys) {
    const match = Object.entries(row).find(([name]) => normalizedKey(name) === normalizedKey(key));
    if (!match) continue;
    present = true;
    const value = match[1];
    const scalar = value == null || typeof value === "object" ? "" : String(value).trim();
    if (scalar) return { present: true, value: scalar };
  }
  return { present, value: "" };
}
function nested(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const found = Object.entries(row).find(([name]) => normalizedKey(name) === normalizedKey(key))?.[1];
  return found && typeof found === "object" && !Array.isArray(found) ? found as Record<string, unknown> : {};
}
function equal(a: string, b: string): boolean { return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase(); }
function path(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "").trim().toLocaleLowerCase();
}
function sourceEvidence(source: CloseoutSource | undefined): string {
  return source ? `${source.kind}:${source.table ?? source.domain}:${source.revision ?? "no-revision"}` : "missing-source";
}
function reliable(source: CloseoutSource | undefined): boolean {
  return Boolean(source?.complete && source.coverage !== "unverified" && source.kind !== "missing");
}
function finding(domain: CloseoutFinding["domain"], kind: CloseoutFinding["kind"], code: string,
  title: string, detail: string, recordId: string | null, evidence: string): CloseoutFinding {
  const id = createHash("sha256").update([domain, kind, code, title, recordId ?? "", evidence].join("|")).digest("hex").slice(0, 20);
  return { id, domain, kind, code, title, detail, recordId, evidence };
}
function fileName(row: Record<string, unknown>): { present: boolean; value: string } {
  return field(row, ["name", "file_name", "display_name", "displayName", "title"]);
}
function fileFolder(row: Record<string, unknown>): { present: boolean; value: string } {
  const direct = field(row, ["folder_path", "folderPath", "parent_path", "parentPath"]);
  if (direct.present) return direct;
  const full = field(row, ["file_path", "filePath", "path"]);
  if (!full.present) return full;
  const cleaned = full.value.replace(/\\/g, "/");
  return { present: true, value: cleaned.slice(0, Math.max(0, cleaned.lastIndexOf("/"))) };
}
function isFolder(row: Record<string, unknown>): boolean {
  return equal(field(row, ["record_kind", "recordKind"]).value, "folder") || equal(field(row, ["type"]).value, "folders");
}
function recordId(row: Record<string, unknown>): string { return field(row, ["item_id", "id", "issue_id", "urn"]).value; }
function versionId(row: Record<string, unknown>): string { return field(row, ["version_id", "versionId", "version_urn"]).value; }
function extension(name: string): string { return name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : ""; }
function selectedCurrent(row: Record<string, unknown>, source: CloseoutSource, selections: SelectedRecord[]): boolean {
  const id = recordId(row); const version = versionId(row);
  return Boolean(id && version && selections.some((item) => item.domain === "files" && item.externalId === id &&
    item.versionId === version && item.sourceRevision === source.revision && item.sourceKind === source.kind));
}
function latest(row: Record<string, unknown>): "yes" | "no" | "unknown" {
  const mark = field(row, ["is_latest", "isLatest", "latest_version", "latestVersion"]);
  if (!mark.present || !mark.value) return "unknown";
  if (["true", "1", "yes"].includes(mark.value.toLowerCase())) return "yes";
  if (["false", "0", "no"].includes(mark.value.toLowerCase())) return "no";
  return "unknown";
}
/** Only a conservative regex subset is accepted from stored profiles. */
export function compileCloseoutNamePattern(pattern: string): RegExp | null {
  if (!pattern || pattern.length > 128 || /\\[1-9]/.test(pattern) || /\(\?/.test(pattern) || /\.{2,}\*/.test(pattern)) return null;
  // Quantified groups and multiple wildcard spans can create exponential work.
  if (/\)[+*?{]/.test(pattern) || /\.\*[\s\S]*\.\*/.test(pattern)) return null;
  try { return new RegExp(pattern, "i"); } catch { return null; }
}
function folderMatches(row: Record<string, unknown>, wanted: string, descendants: boolean): "yes" | "no" | "unknown" {
  if (!wanted) return "yes";
  const actual = fileFolder(row);
  if (!actual.present) return "unknown";
  const match = path(actual.value); const expected = path(wanted);
  return match === expected || (descendants && match.startsWith(expected + "/")) ? "yes" : "no";
}
function fileMatch(row: Record<string, unknown>, rule: Pick<FileRule, "folderPath" | "includeDescendants" | "extensions" | "namePattern">,
  regex: RegExp | null): "yes" | "no" | "unknown" {
  const folder = folderMatches(row, rule.folderPath ?? "", !!rule.includeDescendants);
  if (folder !== "yes") return folder;
  if (rule.namePattern && !regex) return "unknown";
  if (rule.namePattern || rule.extensions?.length) {
    const name = fileName(row);
    if (!name.present) return "unknown";
    if (regex && !regex.test(name.value.slice(0, 512))) return "no";
    if (rule.extensions?.length && !rule.extensions.some((item) => extension(name.value) === (item.startsWith(".") ? item : `.${item}`).toLowerCase())) return "no";
  }
  return "yes";
}
function metadataFindings(domain: CloseoutDomain, row: Record<string, unknown>, fields: string[],
  label: string, evidence: string): CloseoutFinding[] {
  return fields.flatMap((name) => {
    const result = field(row, [name]);
    if (result.value) return [];
    return [finding(domain, result.present ? "blocker" : "unknown", "required-metadata", `${label} lacks ${name}`,
      result.present ? `The ${name} field is blank.` : `The source does not expose ${name}.`, recordId(row) || null, evidence)];
  });
}

type Endpoint = { id: string; domain: CloseoutDomain | null };
type Edge = { from: Endpoint; to: Endpoint; type: string };
function endpointDomain(raw: string): CloseoutDomain | null {
  const term = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [domain, aliases] of Object.entries(domainAliases) as [CloseoutDomain, string[]][]) {
    if (aliases.some((alias) => term === alias || term.endsWith(alias))) return domain;
  }
  return null;
}
function edge(row: Record<string, unknown>): Edge | null {
  const entities = row.entities;
  const ends = Array.isArray(entities) && entities.length >= 2 ? entities : null;
  const left = ends ? (ends[0] ?? {}) : nested(row, "sourceEntity");
  const right = ends ? (ends[1] ?? {}) : nested(row, "targetEntity");
  const from = typeof left === "object" && left ? left as Record<string, unknown> : {};
  const to = typeof right === "object" && right ? right as Record<string, unknown> : {};
  const fromId = field(row, ["source_id", "sourceId", "from_id", "fromId"]).value || field(from, ["id", "urn", "externalId"]).value;
  const toId = field(row, ["target_id", "targetId", "to_id", "toId"]).value || field(to, ["id", "urn", "externalId"]).value;
  const fromType = field(row, ["source_type", "sourceType", "from_type", "fromType"]).value || field(from, ["domain", "type", "kind", "entityType"]).value;
  const toType = field(row, ["target_type", "targetType", "to_type", "toType"]).value || field(to, ["domain", "type", "kind", "entityType"]).value;
  if (!fromId || !toId || !fromType || !toType) return null;
  return { from: { id: fromId, domain: endpointDomain(fromType) }, to: { id: toId, domain: endpointDomain(toType) },
    type: field(row, ["relationship_type", "relationshipType", "relation_type", "relationType", "type"]).value };
}
function links(a: CloseoutDomain, b: CloseoutDomain, candidate: Edge): boolean {
  return candidate.from.domain === a && candidate.to.domain === b || candidate.from.domain === b && candidate.to.domain === a;
}
function documentTargets(assetId: string, edges: Edge[]): string[] {
  return edges.flatMap((candidate) => {
    if (candidate.from.domain === "assets" && candidate.from.id === assetId && candidate.to.domain === "files") return [candidate.to.id];
    if (candidate.to.domain === "assets" && candidate.to.id === assetId && candidate.from.domain === "files") return [candidate.from.id];
    return [];
  });
}

function evaluateFileRule(rule: FileRule, source: CloseoutSource | undefined, selections: SelectedRecord[]): CloseoutFinding[] {
  const evidence = sourceEvidence(source); const wanted = Math.max(1, Math.min(10_000, rule.minCount ?? 1));
  const pattern = rule.namePattern ? compileCloseoutNamePattern(rule.namePattern) : null;
  if (rule.namePattern && !pattern) return [finding("files", "unknown", "invalid-name-pattern", `Cannot evaluate ${rule.label}`,
    "The required file name pattern is invalid or unsafe.", null, evidence)];
  if (!source || !reliable(source)) return [finding("files", "unknown", "file-source-unverified", `Cannot verify ${rule.label}`,
    "Complete, project-covered Files evidence is required.", null, evidence)];
  const folderOnly = !!rule.folderPath && !rule.namePattern && !rule.extensions?.length &&
    rule.minCount === undefined && !rule.requireLatestFinalVersion;
  if (folderOnly) {
    const expected = path(rule.folderPath!);
    const folders = source.rows.filter(isFolder).map((row) => path(fileFolder(row).value));
    const inferred = source.rows.filter((row) => !isFolder(row)).map((row) => fileFolder(row)).filter((item) => item.present).map((item) => path(item.value));
    if (folders.includes(expected) || inferred.includes(expected)) return [];
    const unknown = !folders.length && source.rows.some((row) => !isFolder(row) && !fileFolder(row).present);
    return [finding("files", unknown ? "unknown" : "blocker", "required-folder-missing", `Missing ${rule.label}`,
      `Required folder ${rule.folderPath} was not found in the project evidence.`, null, evidence)];
  }
  const matches = source.rows.filter((row) => !isFolder(row)).map((row) => ({ row, match: fileMatch(row, rule, pattern) }));
  const possible = matches.filter((item) => item.match === "unknown").length;
  const found = matches.filter((item) => item.match === "yes").map((item) => item.row);
  if (found.length < wanted) return [finding("files", possible ? "unknown" : "blocker", "required-file-missing", `Missing ${rule.label}`,
    `${found.length} matching file(s) found; ${wanted} required${possible ? ". Some file names or paths could not be evaluated." : "."}`, null, evidence)];
  const result = found.flatMap((row) => metadataFindings("files", row, rule.requiredMetadata ?? [], rule.label, evidence));
  if (rule.requireLatestFinalVersion) {
    const final = found.filter((row) => latest(row) === "yes" && selectedCurrent(row, source, selections));
    if (final.length < wanted) {
      const undecidable = found.some((row) => latest(row) === "unknown" || !recordId(row) || !versionId(row));
      result.push(finding("files", undecidable ? "unknown" : "blocker", "latest-final-version-missing", `${rule.label} needs latest final versions`,
        `${final.length} current latest version(s) are pinned as final; ${wanted} required. A pinned exact version and explicit latest-version evidence are required.`, null, evidence));
    }
  }
  return result;
}

function evaluateAssetRule(rule: AssetRule, source: CloseoutSource | undefined, relationships: CloseoutSource | undefined,
  files: CloseoutSource | undefined, selections: SelectedRecord[]): CloseoutFinding[] {
  const evidence = sourceEvidence(source); const wanted = Math.max(1, Math.min(10_000, rule.minCount ?? 1));
  if (!source || !reliable(source)) return [finding("assets", "unknown", "asset-source-unverified", `Cannot verify ${rule.label}`,
    "Complete, project-covered Assets evidence is required.", null, evidence)];
  const criteria: Array<readonly [readonly string[], string]> = [];
  if (rule.category) criteria.push([["category_name", "category", "categoryId"], rule.category]);
  if (rule.status) criteria.push([["status_name", "status", "statusId"], rule.status]);
  if (rule.location) criteria.push([["location_path", "location_name", "location", "location_id", "locationId"], rule.location]);
  const attrs = Object.entries(rule.attributes ?? {});
  let uncertain = false;
  const matches = source.rows.filter((row) => {
    for (const [keys, expected] of criteria) {
      const actual = field(row, [...keys]);
      if (!actual.present) { uncertain = true; return false; }
      if (!equal(actual.value, expected)) return false;
    }
    for (const [key, expected] of attrs) {
      const actual = field(row, [key]);
      const nestedActual = actual.present ? actual : field(nested(row, "custom_attributes"), [key]);
      if (!nestedActual.present) { uncertain = true; return false; }
      if (!equal(nestedActual.value, expected)) return false;
    }
    return true;
  });
  if (matches.length < wanted) return [finding("assets", uncertain ? "unknown" : "blocker", "required-asset-missing", `Missing ${rule.label}`,
    `${matches.length} matching asset(s) found; ${wanted} required${uncertain ? ". Some asset fields are unavailable." : "."}`, null, evidence)];
  const result = matches.flatMap((row) => metadataFindings("assets", row, rule.requiredMetadata ?? [], rule.label, evidence));
  if (rule.requireDocumentRelationship) {
    if (!relationships || !reliable(relationships)) result.push(finding("assets", "unknown", "asset-document-source-unverified",
      `Cannot verify ${rule.label} documents`, "Complete, project-covered relationship evidence is required.", null, sourceEvidence(relationships)));
    else if (!files || !reliable(files)) result.push(finding("assets", "unknown", "asset-document-file-source-unverified",
      `Cannot verify ${rule.label} linked files`, "Complete, project-covered Files evidence is required to verify document targets.", null, sourceEvidence(files)));
    else {
      const edges = relationships.rows.map(edge).filter((item): item is Edge => !!item);
      const fileRows = files.rows.filter((row) => !isFolder(row));
      const fileIds = new Set(fileRows.flatMap((row) => [recordId(row), versionId(row)]).filter(Boolean));
      const targets = matches.flatMap((row) => documentTargets(recordId(row), edges));
      const attached = matches.filter((row) => documentTargets(recordId(row), edges).some((id) =>
        fileRows.some((file) => (recordId(file) === id || versionId(file) === id) && selectedCurrent(file, files, selections))));
      const unresolved = targets.some((id) => !fileIds.has(id));
      const unpinned = targets.some((id) => fileRows.some((file) => recordId(file) === id || versionId(file) === id) &&
        !fileRows.some((file) => (recordId(file) === id || versionId(file) === id) && selectedCurrent(file, files, selections)));
      if (attached.length < wanted) result.push(finding("assets", edges.length < relationships.rows.length || unresolved ? "unknown" : "blocker",
        "asset-document-missing", `${rule.label} lacks document relationships`,
        `${attached.length} matching asset(s) have a linked, pinned file version; ${wanted} required.`, null, sourceEvidence(relationships)));
      if (unpinned) result.push(finding("assets", "blocker", "asset-document-unpinned",
        `${rule.label} has unpinned linked documents`, "Select the exact current file version linked to each required asset.",
        null, sourceEvidence(files)));
      if (unresolved) result.push(finding("assets", "unknown", "asset-document-target-unverified",
        `${rule.label} has unresolved document targets`, "At least one relationship points to a file absent from the complete Files evidence.",
        null, sourceEvidence(files)));
    }
  }
  return result;
}

function evaluateRelationshipRule(rule: RelationshipRule, source: CloseoutSource | undefined,
  byDomain: Map<CloseoutDomain, CloseoutSource>, selections: SelectedRecord[]): CloseoutFinding[] {
  const evidence = sourceEvidence(source); const wanted = Math.max(1, Math.min(10_000, rule.minCount ?? 1));
  if (!source || !reliable(source)) return [finding("relationships", "unknown", "relationship-source-unverified",
    `Cannot verify ${rule.label}`, "Complete, project-covered relationship evidence is required.", null, evidence)];
  const left = byDomain.get(rule.fromDomain); const right = byDomain.get(rule.toDomain);
  if (!reliable(left) || !reliable(right)) return [finding("relationships", "unknown", "relationship-target-source-unverified",
    `Cannot verify ${rule.label} endpoints`, `Complete ${rule.fromDomain} and ${rule.toDomain} sources are required to prove both ends.`, null, evidence)];
  const edges = source.rows.map(edge);
  const targetPresent = (endpoint: Endpoint): boolean => {
    const endpointSource = byDomain.get(endpoint.domain!);
    return !!endpointSource?.rows.some((row) =>
      (recordId(row) === endpoint.id || versionId(row) === endpoint.id) &&
      (endpoint.domain !== "files" || selectedCurrent(row, endpointSource, selections)));
  };
  const matching = edges.filter((item): item is Edge => !!item && links(rule.fromDomain, rule.toDomain, item) &&
    (!rule.relationshipType || equal(item.type, rule.relationshipType)));
  const count = matching.filter((item) => targetPresent(item.from) && targetPresent(item.to)).length;
  if (count >= wanted) return [];
  return [finding("relationships", edges.some((item) => !item) ? "unknown" : "blocker", "required-relationship-missing",
    `Missing ${rule.label}`, `${count} matching relationship(s) have verified current endpoints${rule.fromDomain === "files" || rule.toDomain === "files" ? " and pinned file versions" : ""}; ${wanted} required.`, null, evidence)];
}

function evaluateExpected(item: RuleExpectedDeliverable, source: CloseoutSource | undefined, selections: SelectedRecord[]): CloseoutFinding[] {
  const evidence = sourceEvidence(source);
  if (!source || !reliable(source)) return [finding(item.domain, "unknown", "deliverable-source-unverified", `Cannot verify ${item.label}`,
    "Complete, project-covered source evidence is required.", item.externalId || null, evidence)];
  let matches: Record<string, unknown>[];
  if (item.externalId) matches = source.rows.filter((row) => recordId(row) === item.externalId &&
    (item.domain !== "files" || !item.folderPath || folderMatches(row, item.folderPath, false) === "yes"));
  else {
    const pattern = item.namePattern ? compileCloseoutNamePattern(item.namePattern) : null;
    if (item.namePattern && !pattern) return [finding(item.domain, "unknown", "invalid-deliverable-pattern", `Cannot verify ${item.label}`,
      "The deliverable name pattern is invalid or unsafe.", null, evidence)];
    matches = source.rows.filter((row) => {
      if (item.domain === "files" && isFolder(row)) return false;
      const name = fileName(row).value;
      if (!name || !(pattern ? pattern.test(name.slice(0, 512)) : equal(name, item.label))) return false;
      return item.domain !== "files" || !item.folderPath || folderMatches(row, item.folderPath, false) === "yes";
    });
  }
  if (!matches.length) {
    const uncertainPath = item.domain === "files" && !!item.folderPath && source.rows.some((row) => !fileFolder(row).present);
    return [finding(item.domain, uncertainPath ? "unknown" : "blocker", "missing-deliverable", `Missing ${item.label}`,
      item.externalId ? `Exact source ID ${item.externalId} was not found.` : "No source record matched the expected name and folder requirements.",
      item.externalId || null, evidence)];
  }
  if (matches.length > 1) return [finding(item.domain, "unknown", "ambiguous-deliverable", `${item.label} matches multiple records`,
    "Narrow the name pattern or folder path, or pin an exact source ID.", null, evidence)];
  const row = matches[0];
  const result = metadataFindings(item.domain, row, item.requiredMetadata, item.label, evidence);
  if (item.domain === "files" && !selectedCurrent(row, source, selections)) result.push(finding("files", recordId(row) && versionId(row) ? "blocker" : "unknown",
    "unselected-record-document", `${item.label} is not selected as final`,
    "Pin the exact source version for this expected record document.", recordId(row) || null, evidence));
  return result;
}

/** Evaluate only configured requirements. Incomplete or unrecognized evidence produces Unknown, never a false Ready. */
export function evaluateCloseoutRules(input: CloseoutRuleInput): CloseoutFinding[] {
  const rules = input.rules ?? defaultCloseoutRules();
  const byDomain = new Map(input.sources.map((source) => [source.domain, source]));
  const results: CloseoutFinding[] = [];
  const add = (items: CloseoutFinding[]) => { for (const item of items) if (results.length < MAX_FINDINGS) results.push(item); };
  for (const rule of rules.files ?? []) add(evaluateFileRule(rule, byDomain.get("files"), input.selections));
  for (const rule of rules.assets ?? []) add(evaluateAssetRule(rule, byDomain.get("assets"), byDomain.get("relationships"), byDomain.get("files"), input.selections));
  for (const rule of rules.relationships ?? []) add(evaluateRelationshipRule(rule, byDomain.get("relationships"), byDomain, input.selections));
  for (const rule of rules.projectMetadata ?? []) {
    const value = input.projectMetadata ? field(input.projectMetadata, [rule.field]) : { present: false, value: "" };
    if (!value.present) add([finding("portfolio", "unknown", "project-metadata-unavailable", `${rule.label ?? rule.field} cannot be verified`,
      `The synced project source does not expose ${rule.field}.`, null, "project-admin")]);
    else if (!value.value || rule.equals && !equal(value.value, rule.equals)) add([finding("portfolio", "blocker", "project-metadata-mismatch",
      `${rule.label ?? rule.field} is missing or incorrect`, rule.equals ? `Expected ${rule.equals}; observed ${value.value || "(blank)"}.` : `${rule.field} is blank.`, null, "project-admin")]);
  }
  for (const item of input.expected) add(evaluateExpected(item, byDomain.get(item.domain), input.selections));
  for (const policy of rules.statusPolicies ?? []) {
    const source = byDomain.get(policy.domain);
    if (!source || !reliable(source)) { add([finding(policy.domain, "unknown", "status-source-unverified", `Cannot verify ${policy.domain} status`,
      "Complete, project-covered evidence is required for this status policy.", null, sourceEvidence(source))]); continue; }
    for (const row of source.rows) {
      if (policy.domain === "reviews" && equal(field(row, ["record_kind", "recordKind"]).value, "review-version")) continue;
      const status = field(row, ["status", "status_value"]).value;
      if (!status) add([finding(policy.domain, "unknown", "status-unavailable", `${policy.domain} status unavailable`,
        "A record has no recognizable status field.", recordId(row) || null, sourceEvidence(source))]);
      else if (policy.openStatuses.some((item) => equal(item, status))) add([finding(policy.domain, "blocker", "open-record", `${policy.domain} record remains open`,
        `Status: ${status}.`, recordId(row) || null, sourceEvidence(source))]);
      else if (!policy.terminalStatuses?.some((item) => equal(item, status))) add([finding(policy.domain, "unknown", "unrecognized-status", `${policy.domain} status is not recognized`,
        `Status: ${status}.`, recordId(row) || null, sourceEvidence(source))]);
    }
  }
  return results;
}
