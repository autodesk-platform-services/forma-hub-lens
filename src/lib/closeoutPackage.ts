import "server-only";

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { Session } from "./aps/auth";
import { downloadCloseoutVersion } from "./aps/closeoutEvidence";
import { buildAssetHandover, type AssetHandoverIndex } from "./assetHandover";
import { assessCloseoutProject, closeoutRecordId, closeoutVersionId, collectCloseoutSources,
  type CloseoutAssessment, type CloseoutFinding } from "./closeoutEngine";
import { env } from "./env";
import { getCloseoutPackage, saveCloseoutAssessment, saveCloseoutPackage, type StoredPackage } from "./closeoutStore";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_COUNT = 100;
const MAX_EVIDENCE_DOMAIN_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_TOTAL_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();

export type PackageFile = {
  selectionId: string;
  sourceId: string;
  versionId: string;
  displayName: string;
  archivePath: string | null;
  sha256: string | null;
  byteSize: number | null;
  storageUrn: string | null;
  outcome: "included" | "unavailable";
  reason: string | null;
};
export type CloseoutManifest = {
  format: "forma-hub-lens-closeout-v1";
  projectId: string;
  generatedAt: number;
  generatedBy: string;
  assessment: CloseoutAssessment;
  files: PackageFile[];
  evidence: Array<{ domain: string; archivePath: string | null; sha256: string | null;
    byteSize: number | null; rowCount: number; complete: boolean; redactedFields: number;
    reason: string | null }>;
  assetHandover: { assets: number; links: number; unknowns: number; inventoryPaths: string[] } | null;
  exceptions: CloseoutFinding[];
  exceptionOverflow: number;
  statement: string;
};
export function acknowledgedCloseoutExceptions(manifest: CloseoutManifest, ids: string[]): string[] {
  if (manifest.exceptionOverflow) {
    throw new Error("This package has findings beyond the review limit. Resolve or narrow them and build a new package before acceptance.");
  }
  const required = new Set(manifest.exceptions.map((finding) => finding.id));
  const received = new Set(ids);
  if (required.size !== received.size || [...required].some((id) => !received.has(id))) {
    throw new Error("Acknowledge each outstanding exception explicitly before local acceptance.");
  }
  return [...received];
}
export type VersionDownload = Awaited<ReturnType<typeof downloadCloseoutVersion>>;
type Downloader = (session: Session, projectId: string, versionId: string) => Promise<VersionDownload>;

function sha(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function safeName(name: string): string {
  const cleaned = name.normalize("NFKC").replace(/[\\/\x00-\x1f\x7f<>:"|?*]+/g, "_")
    .replace(/^\.+/, "").replace(/\.+$/, "").trim().slice(0, 100);
  return cleaned || "record-document";
}
function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const guarded = /^[\s\t]*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + guarded.replace(/"/g, '""') + '"';
}
function html(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function evidenceJson(value: unknown): { bytes: Uint8Array; redactedFields: number } {
  let redactedFields = 0;
  const serialized = JSON.stringify(value, (key, item) => {
    if (key && /(?:token|secret|password|authorization|credential|cookie|signed[_-]?url|download[_-]?url|api[_-]?key|bearer|(?:^|[_-])(?:url|href|link|links|uri)$)/i.test(key)) {
      redactedFields++;
      return undefined;
    }
    if (typeof item === "string" && /(?:https?:\/\/|data:|javascript:)/i.test(item)) {
      redactedFields++;
      return "[redacted external link]";
    }
    return item;
  }, 2);
  return { bytes: strToU8(serialized), redactedFields };
}
function packageDirectory(): string { return path.resolve(env.dataDir, "closeout-packages"); }
export function packageFilePath(fileName: string): string {
  if (!/^[a-f0-9-]{36}\.zip$/i.test(fileName)) throw new Error("Invalid saved package filename.");
  return path.join(packageDirectory(), fileName);
}
export function readVerifiedCloseoutPackage(id: string): { bytes: Buffer; record: StoredPackage } {
  const record = getCloseoutPackage(id);
  if (!record) throw new Error("Closeout package not found.");
  const bytes = fs.readFileSync(packageFilePath(record.fileName));
  if (bytes.length !== record.byteSize || sha(bytes) !== record.sha256) {
    throw new Error("Saved package integrity check failed.");
  }
  return { bytes, record };
}

/** Build a local, immutable review package. Live file bytes come only from exact APS version IDs. */
export async function buildCloseoutPackage(
  session: Session, projectId: string, downloader: Downloader = downloadCloseoutVersion,
): Promise<StoredPackage> {
  const assessment = assessCloseoutProject(projectId);
  if (!assessment) throw new Error("Assign a closeout profile before building a package.");
  const actor = session.userId ?? session.userEmail;
  if (!actor) throw new Error("An Autodesk identity is required to build a closeout package.");
  const sourceByDomain = new Map(collectCloseoutSources(projectId).map((source) => [source.domain, source]));
  const zipEntries: Record<string, Uint8Array> = {};
  const files: PackageFile[] = [];
  const packageExceptions: CloseoutFinding[] = [...assessment.findings];
  let packageOverflow = assessment.findingOverflow;
  const addPackageException = (domain: CloseoutFinding["domain"], code: string, title: string,
    detail: string, evidence: string) => {
    if (packageExceptions.length >= 500) { packageOverflow++; return; }
    packageExceptions.push({ id: sha(encoder.encode(`${domain}|${code}|${detail}|${evidence}`)).slice(0, 20),
      domain, kind: "unknown", code, title, detail, recordId: null, evidence });
  };
  const evidence: CloseoutManifest["evidence"] = [];
  let totalEvidenceBytes = 0;
  for (const summary of assessment.sources) {
    const source = sourceByDomain.get(summary.domain);
    const entry: CloseoutManifest["evidence"][number] = { domain: summary.domain,
      archivePath: null, sha256: null, byteSize: null, rowCount: source?.rows.length ?? 0,
      complete: !!source?.complete, redactedFields: 0, reason: null };
    try {
      if (!source || source.revision !== summary.revision || source.kind !== summary.kind) {
        throw new Error("The source revision changed after the assessment.");
      }
      const encoded = evidenceJson({ format: "forma-hub-lens-closeout-evidence-v1",
        projectId: assessment.projectId, source: summary, rows: source.rows });
      if (encoded.bytes.length > MAX_EVIDENCE_DOMAIN_BYTES ||
        totalEvidenceBytes + encoded.bytes.length > MAX_EVIDENCE_TOTAL_BYTES) {
        throw new Error("Evidence exceeds the bounded package inventory limit.");
      }
      const archivePath = `evidence/${summary.domain}.json`;
      zipEntries[archivePath] = encoded.bytes;
      totalEvidenceBytes += encoded.bytes.length;
      Object.assign(entry, { archivePath, sha256: sha(encoded.bytes),
        byteSize: encoded.bytes.length, redactedFields: encoded.redactedFields });
    } catch (error) {
      entry.reason = error instanceof Error ? error.message : "Source inventory could not be serialized.";
      addPackageException(summary.domain, "evidence-not-included", `${summary.domain} evidence was not included`,
        entry.reason, summary.revision ?? "missing-source");
    }
    evidence.push(entry);
  }
  zipEntries["evidence/index.json"] = strToU8(JSON.stringify(evidence, null, 2));
  let totalFileBytes = 0;
  const selectedFiles = assessment.selections.filter((selection) => selection.domain === "files");
  if (selectedFiles.length > MAX_FILE_COUNT) {
    packageOverflow += selectedFiles.length - MAX_FILE_COUNT;
    packageExceptions.push({ id: sha(encoder.encode(`file-count|${assessment.projectId}`)).slice(0, 20),
      domain: "files", kind: "unknown", code: "package-file-count-limit",
      title: "Selected record documents exceed package limit",
      detail: `Only the first ${MAX_FILE_COUNT} selected files were attempted; ${selectedFiles.length - MAX_FILE_COUNT} remain unincluded.`,
      recordId: null, evidence: "selection-register" });
  }
  for (const [index, selection] of selectedFiles.slice(0, MAX_FILE_COUNT).entries()) {
    const versionId = selection.versionId ?? "";
    const outcome: PackageFile = {
      selectionId: selection.id, sourceId: selection.externalId, versionId,
      displayName: selection.name, archivePath: null, sha256: null, byteSize: null,
      storageUrn: null, outcome: "unavailable", reason: null,
    };
    const fail = (reason: string) => {
      outcome.reason = reason;
      const seed = `file-download|${selection.id}|${reason}`;
      packageExceptions.push({ id: sha(encoder.encode(seed)).slice(0, 20), domain: "files", kind: "unknown",
        code: "file-not-included", title: `${selection.name} was not included`, detail: reason,
        recordId: selection.externalId, evidence: selection.sourceRevision });
    };
    const source = sourceByDomain.get("files");
    const row = source?.rows.find((candidate) => closeoutRecordId("files", candidate) === selection.externalId);
    if (!source || source.kind !== "live-aps" || !source.complete || !row ||
      selection.sourceKind !== "live-aps" || selection.sourceRevision !== source.revision ||
      !versionId || closeoutVersionId(row) !== versionId) {
      fail("An exact, current live Files item and version is required for binary inclusion.");
      files.push(outcome); continue;
    }
    try {
      const downloaded = await downloader(session, projectId, versionId);
      if (downloaded.itemId !== selection.externalId || downloaded.versionId !== versionId) {
        throw new Error("APS returned a different item or version than the pinned selection.");
      }
      const expectedStorage = String(row.storage_urn ?? "").trim();
      if (expectedStorage && expectedStorage !== downloaded.storageUrn) {
        throw new Error("APS returned a storage object that differs from the pinned evidence.");
      }
      if (!(downloaded.bytes instanceof Uint8Array) || downloaded.bytes.length === 0 ||
        downloaded.bytes.length > MAX_FILE_BYTES || totalFileBytes + downloaded.bytes.length > MAX_TOTAL_FILE_BYTES) {
        throw new Error("Download is empty or exceeds the package size limit.");
      }
      const digest = sha(downloaded.bytes);
      if (digest !== downloaded.sha256) throw new Error("Downloaded bytes failed the APS adapter hash check.");
      const archivePath = `files/${String(index + 1).padStart(3, "0")}-${safeName(selection.name)}`;
      zipEntries[archivePath] = downloaded.bytes;
      totalFileBytes += downloaded.bytes.length;
      Object.assign(outcome, { outcome: "included", archivePath, sha256: digest,
        byteSize: downloaded.bytes.length, storageUrn: downloaded.storageUrn, reason: null });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Authenticated APS version download failed.");
    }
    files.push(outcome);
  }
  let assetHandover: CloseoutManifest["assetHandover"] = null;
  if (assessment.profile.requiredDomains.includes("assets") || assessment.profile.rules.assets.length > 0) {
    try {
      const index: AssetHandoverIndex = buildAssetHandover({ projectId: assessment.projectId,
        sources: [...sourceByDomain.values()], selections: assessment.selections, packageFiles: files });
      const serialized = JSON.stringify(index, null, 2);
      if (Buffer.byteLength(serialized) > 20 * 1024 * 1024) throw new Error("Asset handover index exceeds the 20 MiB safety limit.");
      zipEntries["assets/index.json"] = strToU8(serialized);
      const assetRows = [["asset_id", "name", "category", "status", "location_id", "location_path", "linked_records", "unknown_findings"],
        ...index.assets.map((asset) => [asset.id, asset.name, asset.category ?? "", asset.status ?? "",
          asset.location.id ?? "", asset.location.path ?? "", String(asset.links.length), String(asset.unknownReasons.length)])];
      zipEntries["assets/inventory.csv"] = strToU8(assetRows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n");
      const assetReport = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Asset handover inventory</title>
        <style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:.5rem;text-align:left}th{background:#eee}</style>
        <h1>Asset handover inventory</h1><p>Project ${html(assessment.projectId)} · ${index.assets.length} assets · ${index.unknownReasons.length} source-level unknowns.</p>
        <p>This HTML previews the first 500 assets. index.json and inventory.csv contain the full captured inventory.</p>
        <table><thead><tr><th>ID</th><th>Name</th><th>Category / status</th><th>Location</th><th>Linked records</th><th>Unknowns</th></tr></thead><tbody>
        ${index.assets.slice(0, 500).map((asset) => `<tr><td>${html(asset.id)}</td><td>${html(asset.name)}</td>
          <td>${html(asset.category)} / ${html(asset.status)}</td><td>${html(asset.location.path ?? asset.location.id)}</td>
          <td>${asset.links.map((link) => `${html(link.domain)} ${html(link.recordId)} (${html(link.resolution)})${link.pinnedVersionId ? ` · pinned ${html(link.pinnedVersionId)}` : ""}${link.archivePath ? ` · package ${html(link.archivePath)}` : ""}`).join("<br>")}</td>
          <td>${asset.unknownReasons.map((item) => html(item.detail)).join("<br>")}</td></tr>`).join("")}</tbody></table></html>`;
      zipEntries["assets/inventory.html"] = strToU8(assetReport);
      assetHandover = { assets: index.assets.length,
        links: index.assets.reduce((sum, asset) => sum + asset.links.length, 0),
        unknowns: index.unknownReasons.length + index.assets.reduce((sum, asset) => sum + asset.unknownReasons.length, 0),
        inventoryPaths: ["assets/index.json", "assets/inventory.csv", "assets/inventory.html"] };
      const groupedUnknowns = new Map<string, { code: string; detail: string; count: number }>();
      for (const item of [...index.unknownReasons, ...index.assets.flatMap((asset) => asset.unknownReasons)]) {
        const key = `${item.code}|${item.detail}`;
        const prior = groupedUnknowns.get(key);
        groupedUnknowns.set(key, { ...item, count: (prior?.count ?? 0) + 1 });
      }
      if (index.truncated) groupedUnknowns.set("asset-index-truncated", { code: "asset-index-truncated",
        detail: "The asset handover index reached a safety cap.", count: 1 });
      for (const item of groupedUnknowns.values()) addPackageException("assets", item.code,
        "Asset handover evidence unresolved", `${item.detail} (${item.count} occurrence${item.count === 1 ? "" : "s"}; see assets/index.json.)`, "assets/index.json");
    } catch (error) {
      packageExceptions.push({ id: sha(encoder.encode(`asset-index-error|${assessment.projectId}`)).slice(0, 20),
        domain: "assets", kind: "unknown", code: "asset-index-unavailable", title: "Asset handover index unavailable",
        detail: error instanceof Error ? error.message : "Asset inventory could not be built.",
        recordId: null, evidence: "asset handover package builder" });
    }
  }
  const stillCurrent = assessCloseoutProject(projectId);
  if (!stillCurrent || JSON.stringify({ profile: stillCurrent.profile, sources: stillCurrent.sources,
    expected: stillCurrent.expectedDeliverables, selections: stillCurrent.selections,
    attestations: stillCurrent.attestations, liveSnapshotId: stillCurrent.liveSnapshotId,
    projectSourceHash: stillCurrent.projectSourceHash }) !== JSON.stringify({
    profile: assessment.profile, sources: assessment.sources,
    expected: assessment.expectedDeliverables, selections: assessment.selections,
    attestations: assessment.attestations, liveSnapshotId: assessment.liveSnapshotId,
    projectSourceHash: assessment.projectSourceHash })) {
    throw new Error("Closeout evidence or requirements changed while building the package. Assess and build again.");
  }
  const manifest: CloseoutManifest = {
    format: "forma-hub-lens-closeout-v1", projectId: assessment.projectId,
    generatedAt: Date.now(), generatedBy: actor,
    assessment, files, evidence, assetHandover, exceptions: packageExceptions,
    exceptionOverflow: packageOverflow,
    statement: "Local review package. Evidence inventories omit credential fields and external links. Acceptance is recorded in this console and does not submit to Autodesk or the client.",
  };
  zipEntries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const inventoryRows = [
    ["kind", "domain", "record_id", "version_id", "name", "outcome", "archive_path", "sha256", "detail"],
    ...assessment.expectedDeliverables.map((item) => ["expected-deliverable", item.domain, item.externalId,
      "", item.label, "registered", "", "", `namePattern=${item.namePattern}; folderPath=${item.folderPath}`]),
    ...files.map((file) => ["final-record-document", "files", file.sourceId, file.versionId, file.displayName,
      file.outcome, file.archivePath ?? "", file.sha256 ?? "", file.reason ?? ""]),
    ...assessment.sources.map((source) => ["source-evidence", source.domain, "", "", source.table ?? source.domain,
      source.complete ? source.coverage : "incomplete", "", "", source.revision ?? source.note ?? "no revision"]),
  ];
  zipEntries["inventory.csv"] = strToU8(inventoryRows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n");
  const exceptionRows = [
    ["id", "domain", "kind", "code", "record_id", "title", "detail", "evidence"],
    ...packageExceptions.map((finding) => [finding.id, finding.domain, finding.kind, finding.code,
      finding.recordId ?? "", finding.title, finding.detail, finding.evidence]),
  ];
  zipEntries["exceptions.csv"] = strToU8(exceptionRows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n");
  const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Closeout inventory</title>
  <style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:.5rem;text-align:left}th{background:#eee}</style>
  <h1>Closeout package inventory</h1><p>Project ${html(assessment.projectId)} · ${html(new Date(manifest.generatedAt).toISOString())}</p>
  <p>Assessment: <strong>${html(assessment.status)}</strong>. ${html(packageExceptions.length + packageOverflow)} explicit exceptions.</p>
  <h2>Expected deliverables</h2><table><thead><tr><th>Domain</th><th>Label</th><th>Exact source ID</th><th>Name / folder criteria</th></tr></thead><tbody>
  ${assessment.expectedDeliverables.map((item) => `<tr><td>${html(item.domain)}</td><td>${html(item.label)}</td><td>${html(item.externalId || "pending")}</td><td>${html(item.namePattern)} · ${html(item.folderPath)}</td></tr>`).join("")}</tbody></table>
  <h2>Source evidence</h2><table><thead><tr><th>Domain</th><th>Kind</th><th>Revision</th><th>Coverage</th><th>Project rows</th></tr></thead><tbody>
  ${assessment.sources.map((source) => `<tr><td>${html(source.domain)}</td><td>${html(source.kind)}</td><td>${html(source.revision)}</td><td>${html(source.coverage)}</td><td>${source.rowCount}</td></tr>`).join("")}</tbody></table>
  <h2>Record documents</h2><table><thead><tr><th>Source ID</th><th>Version</th><th>Name</th><th>Included</th><th>SHA-256 / reason</th></tr></thead><tbody>
  ${files.map((file) => `<tr><td>${html(file.sourceId)}</td><td>${html(file.versionId)}</td><td>${html(file.displayName)}</td><td>${html(file.outcome)}</td><td>${html(file.sha256 ?? file.reason)}</td></tr>`).join("")}</tbody></table>
  <h2>Exceptions</h2><table><thead><tr><th>Domain</th><th>Type</th><th>Record</th><th>Finding</th></tr></thead><tbody>
  ${packageExceptions.map((finding) => `<tr><td>${html(finding.domain)}</td><td>${html(finding.kind)}</td><td>${html(finding.recordId)}</td><td>${html(finding.title)}: ${html(finding.detail)}</td></tr>`).join("")}</tbody></table>
  <p>${html(manifest.statement)}</p></html>`;
  zipEntries["inventory.html"] = strToU8(report);
  const archive = zipSync(zipEntries, { level: 6 });
  const fileName = randomUUID() + ".zip";
  const directory = packageDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const finalPath = packageFilePath(fileName);
  const temporaryPath = finalPath + ".tmp";
  try {
    fs.writeFileSync(temporaryPath, archive, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporaryPath, finalPath);
    const storedAssessment = saveCloseoutAssessment({ projectId: assessment.projectId,
      profileId: assessment.profile.id, status: assessment.status, result: JSON.stringify(assessment), actor });
    return saveCloseoutPackage({ projectId: assessment.projectId, profileId: assessment.profile.id,
      assessmentId: storedAssessment.id, status: packageExceptions.length || packageOverflow ? "exceptions" : "ready",
      manifest: JSON.stringify(manifest), sha256: sha(archive), byteSize: archive.length,
      fileName, actor });
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* may already have been renamed */ }
    try { fs.unlinkSync(finalPath); } catch { /* no complete archive was written */ }
    throw error;
  }
}
