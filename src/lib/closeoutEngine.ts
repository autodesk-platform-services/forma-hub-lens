import "server-only";

import { createHash } from "node:crypto";
import { cachedProjects } from "./aps/admin";
import { classifySnapshotLineage } from "./dataHealth";
import { getTrustedTableSource, listTables, recentUploads, resolveColumn, type DatasetTable,
  type TrustedTableSource } from "./dataset";
import { getDb } from "./db";
import { env } from "./env";
import { latestCloseoutLiveSnapshot } from "./closeoutLive";
import { evaluateCloseoutRules } from "./closeoutRules";
import {
  CLOSEOUT_DOMAINS, closeoutAttestations, getCloseoutAssignment, getCloseoutProfile,
  listExpectedDeliverables, selectedCloseoutRecords, type CloseoutDomain,
  type CloseoutProfile, type ExpectedDeliverable, type SelectedRecord, type SourceAttestation,
} from "./closeoutStore";

export const CLOSEOUT_SOURCE_TABLES: Record<CloseoutDomain, string[]> = {
  files: ["files_files", "docs_files", "documents_files", "docs_items"],
  assets: ["assets_assets"], issues: ["issues_issues"], forms: ["forms_forms"],
  submittals: ["submittalsacc_items"], reviews: ["reviews_reviews"], rfis: ["rfis_rfis"],
  transmittals: ["transmittals_transmittals", "transmittals_items"],
  relationships: ["relationships_relationships", "relationships_items"],
  sheets: ["sheets_sheets", "docs_sheets"],
};
const ROW_LIMIT = 10_000;
const FINDING_LIMIT = 500;
const CLOSURE_DOMAINS = new Set<CloseoutDomain>(["issues", "forms", "submittals", "reviews", "rfis", "transmittals"]);

export type CloseoutFinding = {
  id: string;
  domain: CloseoutDomain | "portfolio";
  kind: "blocker" | "unknown";
  code: string;
  title: string;
  detail: string;
  recordId: string | null;
  evidence: string;
};
export type CloseoutSource = {
  domain: CloseoutDomain;
  kind: "live-aps" | "aps-data-connector" | "user-zip" | "missing";
  table: string | null;
  revision: string | null;
  collectedAt: number | null;
  complete: boolean;
  coverage: "verified-live" | "verified-aps-extract" | "attested-upload" | "unverified";
  note: string | null;
  rowCount: number;
  rows: Record<string, unknown>[];
};
export type CloseoutAssessment = {
  projectId: string;
  profile: CloseoutProfile;
  assignmentAssignedAt: number;
  assessedAt: number;
  status: "ready" | "blockers" | "unknown";
  sources: Array<Omit<CloseoutSource, "rows">>;
  findings: CloseoutFinding[];
  findingOverflow: number;
  expectedDeliverables: ExpectedDeliverable[];
  selections: SelectedRecord[];
  attestations: SourceAttestation[];
  liveSnapshotId: string | null;
  projectSourceHash: string;
  totals: { blockers: number; unknown: number; records: number };
  snapshotLineage: "single" | "mixed" | "unknown" | "live-only";
};

export function closeoutProject(projectId: string) {
  return cachedProjects().find((project) => project.id.toLowerCase() === projectId.toLowerCase()) ?? null;
}

function value(row: Record<string, unknown>, candidates: string[]): string {
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = Object.entries(row).find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized);
    if (match && match[1] != null && typeof match[1] !== "object") return String(match[1]).trim();
  }
  return "";
}
export function closeoutRecordId(domain: CloseoutDomain, row: Record<string, unknown>): string {
  return value(row, domain === "issues" ? ["issue_id", "id"] : ["id", "item_id", "urn"]);
}
export function closeoutRecordName(row: Record<string, unknown>): string {
  return value(row, ["name", "title", "review_name", "description", "display_name", "file_name"]);
}
export function closeoutVersionId(row: Record<string, unknown>): string {
  return value(row, ["version_id", "versionId", "version_urn"]);
}
function safeIdentifier(raw: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(raw)) throw new Error("Invalid stored dataset identifier.");
  return '"' + raw + '"';
}
function csvRows(table: DatasetTable, projectId: string): { rows: Record<string, unknown>[]; reason: string | null } {
  const projectColumn = ["bim360_project_id", "project_id", "projectId"].map((candidate) => resolveColumn(table, candidate)).find(Boolean);
  if (!projectColumn) return { rows: [], reason: "The CSV has no exact project ID column." };
  const sql = `SELECT * FROM ${safeIdentifier(table.sqlName)} WHERE lower(${safeIdentifier(projectColumn)}) = ? LIMIT ${ROW_LIMIT + 1}`;
  const found = getDb().prepare(sql).all(projectId.toLowerCase()) as Record<string, unknown>[];
  if (found.length > ROW_LIMIT) return { rows: found.slice(0, ROW_LIMIT), reason: `More than ${ROW_LIMIT.toLocaleString()} project rows; review is incomplete.` };
  return { rows: found, reason: null };
}
function trustedCoversProject(source: TrustedTableSource, projectId: string, status: string | null): boolean {
  if (source.hubId !== env.hubId) return false;
  const scope = source.projectScope;
  if (scope.kind === "selected_projects" && !scope.projectIds.some((id) => id.toLowerCase() === projectId)) return false;
  if (scope.projectStatus === "unknown") return false;
  if (scope.projectStatus !== "all" && scope.projectStatus !== status?.toLowerCase()) return false;
  return true;
}

export function collectCloseoutSources(projectId: string): CloseoutSource[] {
  const normalized = projectId.toLowerCase();
  const live = latestCloseoutLiveSnapshot(normalized);
  const tables = listTables();
  const uploads = recentUploads(100_000).sort((a, b) => a.uploadedAt - b.uploadedAt);
  const attestations = closeoutAttestations(normalized);
  const project = closeoutProject(projectId);
  return CLOSEOUT_DOMAINS.map((domain) => {
    const liveSource = live?.sources.find((source) => source.domain === domain);
    if (liveSource) {
      return {
        domain, kind: "live-aps" as const, table: null, revision: `live:${live?.id}:${domain}`,
        collectedAt: liveSource.collectedAt, complete: liveSource.complete,
        coverage: liveSource.complete ? "verified-live" as const : "unverified" as const,
        note: liveSource.error, rowCount: liveSource.rows.length, rows: liveSource.rows,
      };
    }
    const candidates = CLOSEOUT_SOURCE_TABLES[domain].flatMap((candidate) =>
      tables.filter((item) => item.name === candidate));
    const table = candidates.sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
    if (!table) return { domain, kind: "missing" as const, table: null, revision: null,
      collectedAt: null, complete: false, coverage: "unverified" as const,
      note: `No ${CLOSEOUT_SOURCE_TABLES[domain].join(" or ")} source was found.`, rowCount: 0, rows: [] };
    const upload = uploads.find((candidate) => candidate.uploadedAt >= table.uploadedAt);
    const trusted = getTrustedTableSource(table.name);
    const revision = trusted ? `aps-job:${trusted.uploadId}:${table.name}:${table.uploadedAt}` :
      upload ? `zip:${upload.id}:${table.name}:${table.uploadedAt}` : null;
    const loaded = csvRows(table, normalized);
    const ambiguous = candidates.length > 1;
    const complete = !table.truncated && !loaded.reason && !!revision && !ambiguous;
    const attested = !!revision && attestations.some((item) => item.domain === domain && item.sourceRevision === revision);
    const trustedCoverage = !!trusted && trustedCoversProject(trusted, normalized, project?.status ?? null);
    return {
      domain, kind: trusted ? "aps-data-connector" as const : "user-zip" as const, table: table.name, revision,
      collectedAt: table.uploadedAt, complete,
      coverage: trustedCoverage && complete ? "verified-aps-extract" as const :
        attested && !trusted && complete ? "attested-upload" as const : "unverified" as const,
      note: ambiguous ? `Multiple ${domain} table aliases exist (${candidates.map((item) => item.name).join(", ")}); choose one authoritative source.` :
        table.truncated ? "The imported CSV was truncated." : loaded.reason ??
        (trusted && !trustedCoverage ? "APS job project scope or status does not prove coverage for this project." :
          !revision ? "The CSV upload lineage is unknown." : null),
      rowCount: loaded.rows.length, rows: loaded.rows,
    };
  });
}

export function assessCloseoutProject(projectId: string): CloseoutAssessment | null {
  const project = closeoutProject(projectId);
  if (!project) throw new Error("Project is not in the synced hub inventory.");
  const assignment = getCloseoutAssignment(project.id);
  if (!assignment) return null;
  const profile = getCloseoutProfile(assignment.profileId);
  if (!profile) throw new Error("Assigned closeout profile no longer exists.");
  const required = new Set<CloseoutDomain>(profile.requiredDomains);
  // Exact review-version evidence is also needed to validate selected Files.
  const needed = new Set(required);
  if (required.has("files")) needed.add("reviews");
  if (profile.rules.files.length) needed.add("files");
  if (profile.rules.assets.length) needed.add("assets");
  if (profile.rules.relationships.length || profile.rules.assets.some((rule) => rule.requireDocumentRelationship)) {
    needed.add("relationships");
  }
  if (profile.rules.assets.some((rule) => rule.requireDocumentRelationship)) {
    needed.add("files");
    needed.add("reviews");
  }
  if (profile.rules.files.length) needed.add("reviews");
  for (const rule of profile.rules.relationships) {
    needed.add(rule.fromDomain);
    needed.add(rule.toDomain);
    if (rule.fromDomain === "files" || rule.toDomain === "files") needed.add("reviews");
  }
  for (const policy of profile.rules.statusPolicies) needed.add(policy.domain);
  const sources = collectCloseoutSources(project.id).filter((source) => needed.has(source.domain));
  const expected = listExpectedDeliverables(profile.id, project.id);
  const selections = selectedCloseoutRecords(project.id);
  const findings: CloseoutFinding[] = [];
  let blockerCount = 0;
  let unknownCount = 0;
  let overflow = 0;
  const add = (domain: CloseoutFinding["domain"], kind: CloseoutFinding["kind"], code: string,
    title: string, detail: string, recordId: string | null, evidence: string) => {
    if (kind === "blocker") blockerCount++; else unknownCount++;
    if (findings.length >= FINDING_LIMIT) { overflow++; return; }
    const seed = [domain, kind, code, title, detail, recordId ?? "", evidence,
      blockerCount + unknownCount].join("|");
    findings.push({ id: createHash("sha256").update(seed).digest("hex").slice(0, 20),
      domain, kind, code, title, detail, recordId, evidence });
  };
  for (const domain of required) {
    if (CLOSURE_DOMAINS.has(domain) && !profile.rules.statusPolicies.some((policy) =>
      policy.domain === domain && policy.terminalStatuses?.length)) {
      add(domain, "unknown", "status-policy-missing", `${domain} closure criteria are not configured`,
        "Set explicit open and terminal statuses in the turnover profile before this domain can pass.",
        null, profile.id);
    }
  }

  const zipTables = sources.filter((source) => (source.kind === "user-zip" || source.kind === "aps-data-connector") && source.table)
    .map((source) => source.table!);
  const lineage = classifySnapshotLineage(listTables().filter((table) => zipTables.includes(table.name)), recentUploads(100_000));
  const snapshotLineage = !zipTables.length ? "live-only" : lineage.mixed === true ? "mixed" : lineage.mixed === false ? "single" : "unknown";
  if (snapshotLineage === "mixed") add("portfolio", "unknown", "mixed-snapshot", "Required CSVs come from different uploads",
    "Re-import a consistent extract or use complete live evidence before trusting this assessment.", null, zipTables.join(", "));
  if (snapshotLineage === "unknown") add("portfolio", "unknown", "unknown-lineage", "Required CSV lineage cannot be established",
    "An uploaded CSV has no matching upload record.", null, lineage.unknownTables.join(", "));
  if (zipTables.length && sources.some((source) => source.kind === "live-aps")) {
    add("portfolio", "unknown", "mixed-live-and-csv", "Live and CSV evidence were collected at different times",
      "Refresh all required domains through one complete path before calling this assessment ready.", null, zipTables.join(", "));
  }

  for (const source of sources) {
    const provenance = `${source.kind}:${source.table ?? source.domain}:${source.revision ?? "no-revision"}`;
    if (!source.complete) add(source.domain, "unknown", "incomplete-source", `${source.domain} evidence is incomplete`,
      source.note ?? "No complete source is available for this domain.", null, provenance);
    if ((source.kind === "user-zip" || source.kind === "aps-data-connector") && source.coverage === "unverified") {
      add(source.domain, "unknown", "coverage-unverified", `${source.domain} project coverage is unverified`,
        source.kind === "user-zip" ?
          "A Hub Admin must attest that this uploaded extract covers this project and current source revision." :
          "The APS job manifest does not prove this table covers the project and status.", null, provenance);
    }
    const idSet = new Set<string>();
    for (const row of source.rows) {
      // The Reviews adapter includes file-version approval evidence alongside
      // reviews. These are not separate review workflows to close.
      if (source.domain === "reviews" && row.record_kind === "review-version" ||
        source.domain === "files" && row.record_kind === "folder") continue;
      const id = closeoutRecordId(source.domain, row);
      if (!id) {
        add(source.domain, "unknown", "missing-id", `${source.domain} record has no stable ID`,
          "This record cannot be matched to a deliverable or pinned in a handover package.", null, provenance);
        continue;
      }
      if (idSet.has(id)) add(source.domain, "unknown", "duplicate-id", `${source.domain} ID appears more than once`,
        "The extract has ambiguous versions or duplicate records.", id, provenance);
      idSet.add(id);
      if (source.domain === "assets") for (const field of profile.requiredAssetFields) {
        if (!value(row, [field])) add(source.domain,
          Object.keys(row).some((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === field.replace(/[^a-z0-9]/g, "")) ? "blocker" : "unknown",
          "missing-asset-metadata", `Asset lacks ${field}`,
          `Asset ${id} is missing required ${field}.`, id, provenance);
      }
    }
    for (const selection of selections.filter((item) => item.domain === source.domain)) {
      const row = source.rows.find((item) => closeoutRecordId(source.domain, item) === selection.externalId);
      if (!row || selection.sourceRevision !== source.revision || selection.sourceKind !== source.kind) {
        add(source.domain, "unknown", "stale-selection", `Selected ${selection.name} needs review`,
          "The selected record is absent or its source revision has changed. Select it again after refreshing evidence.",
          selection.externalId, provenance);
      } else if (source.domain === "files" && (!selection.versionId || selection.versionId !== closeoutVersionId(row))) {
        add(source.domain, "unknown", "unverified-version", `Selected ${selection.name} has no matching version`,
          "Select an exact file version from the current evidence source.", selection.externalId, provenance);
      } else if (source.domain === "files") {
        const reviewSource = sources.find((item) => item.domain === "reviews");
        const reviewMatches = reviewSource?.rows.filter((candidate) =>
          candidate.record_kind === "review-version" && closeoutVersionId(candidate) === selection.versionId) ?? [];
        const reviewVersion = reviewMatches.length === 1 ? reviewMatches[0] : null;
        const approval = reviewVersion ? value(reviewVersion, ["approval_status"]).toLowerCase() : "";
        const reviewStatus = reviewVersion ? value(reviewVersion, ["review_status"]).toLowerCase() : "";
        if (reviewMatches.length > 1) {
          add("files", "unknown", "ambiguous-approval", `${selection.name} has conflicting review evidence`,
            `Exact version ${selection.versionId} appears in ${reviewMatches.length} review-version records; reconcile these decisions in Autodesk before treating approval as proven.`,
            selection.externalId, provenance);
        } else if (!reviewSource?.complete || !reviewVersion || !approval || !reviewStatus) {
          add("files", "unknown", "approval-unverified", `${selection.name} has no exact approval proof`,
            "A complete Reviews source must link this exact file version to an approval decision and closed review.",
            selection.externalId, provenance);
        } else if (approval !== "approved" || reviewStatus !== "closed") {
          add("files", "blocker", "file-not-approved", `${selection.name} is not approved for turnover`,
            `Exact version ${selection.versionId} has approval ${approval} and review ${reviewStatus}.`,
            selection.externalId, provenance);
        }
      }
    }
  }
  const rawProject = getDb().prepare("SELECT raw FROM projects WHERE lower(id) = ?").get(project.id.toLowerCase()) as { raw: string } | undefined;
  const projectSourceHash = createHash("sha256").update(`${project.status ?? ""}|${rawProject?.raw ?? ""}`).digest("hex");
  let projectMetadata: Record<string, unknown> = { ...project };
  try { projectMetadata = { ...JSON.parse(rawProject?.raw ?? "{}") as Record<string, unknown>, ...project }; }
  catch { /* Missing or malformed raw project fields remain unknown to the rule evaluator. */ }
  const ruleFindings = evaluateCloseoutRules({ rules: profile.rules, sources, selections, expected, projectMetadata });
  for (const finding of ruleFindings) add(finding.domain, finding.kind, finding.code,
    finding.title, finding.detail, finding.recordId, finding.evidence);
  if (ruleFindings.length >= 500) add("portfolio", "unknown", "rule-finding-limit", "Rule findings reached the display limit",
    "Review a narrower project profile before concluding readiness.", null, profile.id);
  if (profile.requiredDomains.includes("files") && selections.filter((item) => item.domain === "files").length === 0) {
    add("files", "blocker", "no-record-documents", "No final record documents selected",
      "Select exact file versions to include as final record documents.", null, "selection-register");
  }
  if (!expected.length) add("portfolio", "unknown", "empty-register", "No expected deliverables registered",
    "Register expected deliverables by exact source ID or a unique name and folder requirement before calling this project ready.", null, profile.id);
  const status = unknownCount > 0 ? "unknown" : blockerCount > 0 ? "blockers" : "ready";
  return {
    projectId: project.id.toLowerCase(), profile, assignmentAssignedAt: assignment.assignedAt,
    assessedAt: Date.now(), status,
    sources: sources.map(({ rows: _rows, ...summary }) => summary), findings,
    findingOverflow: overflow, expectedDeliverables: expected, selections,
    attestations: closeoutAttestations(project.id),
    liveSnapshotId: (getDb().prepare(`SELECT id FROM closeout_live_snapshots WHERE project_id = ?
      ORDER BY collected_at DESC, rowid DESC LIMIT 1`).get(project.id.toLowerCase()) as { id: string } | undefined)?.id ?? null,
    projectSourceHash,
    totals: { blockers: blockerCount, unknown: unknownCount,
      records: sources.reduce((sum, source) => sum + source.rowCount, 0) }, snapshotLineage,
  };
}

/** Source record must still be in the current exact-project evidence before selection. */
export function currentSelectableRecord(projectId: string, domain: CloseoutDomain, externalId: string) {
  const source = collectCloseoutSources(projectId).find((item) => item.domain === domain);
  const row = source?.rows.find((item) => closeoutRecordId(domain, item) === externalId);
  if (!source || !row || !source.revision || !source.complete) throw new Error("Record is absent from complete current project evidence.");
  return { source, row, name: closeoutRecordName(row) || externalId, versionId: closeoutVersionId(row) || null };
}
