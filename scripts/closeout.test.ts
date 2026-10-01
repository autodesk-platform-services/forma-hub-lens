import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-closeout-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { getDb, closeDb } = await import("../src/lib/db.ts");
const { ingestZip, ingestTrustedCsvFiles } = await import("../src/lib/dataset.ts");
const { createCloseoutProfile, addExpectedDeliverable, assignCloseoutProfile,
  attestCloseoutSource, selectCloseoutRecord, clearCloseoutSelection, updateExpectedDeliverable,
  acceptCloseoutPackage, saveCloseoutAssessment, saveCloseoutProfileRules } = await import("../src/lib/closeoutStore.ts");
const { defaultCloseoutRules } = await import("../src/lib/closeoutRules.ts");
const { assessCloseoutProject, collectCloseoutSources, currentSelectableRecord } = await import("../src/lib/closeoutEngine.ts");
const { ingestCloseoutProjectEvidence } = await import("../src/lib/closeoutLive.ts");
const { closeoutPortfolioStatus } = await import("../src/lib/closeoutPortfolio.ts");
const { acknowledgedCloseoutExceptions, buildCloseoutPackage,
  readVerifiedCloseoutPackage } = await import("../src/lib/closeoutPackage.ts");
const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const projectC = "33333333-3333-4333-8333-333333333333";
const projectD = "44444444-4444-4444-8444-444444444444";
const projectE = "55555555-5555-4555-8555-555555555555";
const actor = "user-1";
const session = { userId: actor, userEmail: "test@example.com" };
const fullSession = { ...session, id: "session", mode: "live" as const, accessToken: "test", refreshToken: null,
  expiresAt: Date.now() + 1000, scope: null, userName: "Test", hubVerifiedAt: Date.now(), hubRole: "hub_admin" as const };

for (const id of [projectA, projectB, projectC, projectD, projectE]) getDb().prepare(`INSERT INTO projects
  (id,name,status,raw,synced_at) VALUES (?,?,?,?,?)`).run(id, id, "active", "{}", Date.now());

after(() => { closeDb(); fs.rmSync(workdir, { recursive: true, force: true }); });

test("CSV evidence uses exact project rows and stays unknown until coverage is attested", async () => {
  const profile = createCloseoutProfile({ name: "Asset turnover", client: "Client A",
    businessUnit: "Building", projectType: "Hospital", requiredDomains: ["assets"],
    requiredAssetFields: ["barcode"] }, actor);
  const deliverable = addExpectedDeliverable({ profileId: profile.id, domain: "assets", label: "Main plant", externalId: "asset-a",
    requiredMetadata: ["category_id"] }, actor);
  assignCloseoutProfile(projectA, profile.id, actor);
  const missing = assessCloseoutProject(projectA)!;
  assert.equal(missing.status, "unknown");
  await ingestZip("assets.zip", zipSync({ "assets_assets.csv": strToU8(
    `id,bim360_project_id,barcode,category_id\nasset-a,${projectA},B1,cat1\nasset-b,${projectB},B2,cat2\n`) }));
  const source = collectCloseoutSources(projectA).find((item) => item.domain === "assets")!;
  assert.equal(source.rowCount, 1);
  assert.deepEqual(source.rows.map((row) => row.id), ["asset-a"]);
  assert.equal(assessCloseoutProject(projectA)?.status, "unknown");
  assert.ok(source.revision);
  attestCloseoutSource({ projectId: projectA, domain: "assets", sourceRevision: source.revision!,
    note: "Compared extract scope to source project inventory." }, actor);
  const ready = assessCloseoutProject(projectA)!;
  assert.equal(ready.status, "ready");
  saveCloseoutAssessment({ projectId: projectA, profileId: profile.id, status: ready.status,
    result: JSON.stringify(ready), actor });
  assert.equal(closeoutPortfolioStatus().rows.find((row) => row.project.id === projectA)?.stale, false);
  updateExpectedDeliverable({ id: deliverable.id, label: "Main plant", externalId: "missing-asset",
    namePattern: "", folderPath: "", requiredMetadata: ["category_id"] }, actor);
  assert.equal(assessCloseoutProject(projectA)?.status, "blockers");
  assert.equal(closeoutPortfolioStatus().rows.find((row) => row.project.id === projectA)?.stale, true);
  updateExpectedDeliverable({ id: deliverable.id, label: "Main plant", externalId: "asset-a",
    namePattern: "", folderPath: "", requiredMetadata: ["category_id"] }, actor);
  assert.equal(assessCloseoutProject(projectA)?.status, "ready");
});

test("live file selection needs exact current version approval and packages include verified bytes", async () => {
  const profile = createCloseoutProfile({ name: "Document handover", client: "Client B",
    businessUnit: "Infrastructure", projectType: "Road", requiredDomains: ["files"],
    requiredAssetFields: [] }, actor);
  addExpectedDeliverable({ profileId: profile.id, domain: "files", label: "As built", externalId: "file-a",
    requiredMetadata: ["folder_path"] }, actor);
  assignCloseoutProfile(projectB, profile.id, actor);
  const version = "urn:adsk.wipprod:fs.file:vf.test?version=2";
  const sources = (approval: string) => [
    { domain: "files", rows: [{ project_id: projectB, id: "file-a", item_id: "file-a", version_id: version,
      name: "As/Built.pdf", folder_path: "Project Files/Closeout", storage_urn: "urn:adsk.objects:os.object:b/o",
      access_token: "MUST-NOT-LEAK", href: "https://example.com/signed?token=secret" }],
      complete: true, error: null, collectedAt: 1_000, source: "live-aps" as const },
    { domain: "reviews", rows: [{ project_id: projectB, id: "review-a-version-a", record_kind: "review-version",
      version_id: version, review_id: "review-a", review_status: "CLOSED", approval_status: approval }],
      complete: true, error: null, collectedAt: 1_000, source: "live-aps" as const },
  ];
  ingestCloseoutProjectEvidence(session, { projectId: projectB, collectedAt: 1_000, sources: sources("Approved") });
  const current = currentSelectableRecord(projectB, "files", "file-a");
  selectCloseoutRecord({ projectId: projectB, domain: "files", externalId: "file-a", versionId: current.versionId,
    sourceRevision: current.source.revision!, sourceKind: "live-aps", name: current.name, selectedBy: actor });
  assert.equal(assessCloseoutProject(projectB)?.status, "ready");
  const bytes = strToU8("verified document contents");
  const crypto = await import("node:crypto");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const pkg = await buildCloseoutPackage(fullSession, projectB, async (_session, id, selectedVersion) => {
    assert.equal(id, projectB);
    assert.equal(selectedVersion, version);
    return { bytes, name: "As/Built.pdf", versionId: version, itemId: "file-a",
      storageUrn: "urn:adsk.objects:os.object:b/o", sha256: digest };
  });
  assert.equal(pkg.status, "ready");
  const contents = unzipSync(readVerifiedCloseoutPackage(pkg.id).bytes);
  assert.ok(contents["manifest.json"]);
  assert.ok(contents["evidence/index.json"]);
  assert.ok(contents["evidence/files.json"]);
  assert.ok(contents["evidence/reviews.json"]);
  const fileEvidence = new TextDecoder().decode(contents["evidence/files.json"]);
  assert.equal(fileEvidence.includes("MUST-NOT-LEAK"), false);
  assert.equal(fileEvidence.includes("example.com"), false);
  const packageManifest = JSON.parse(new TextDecoder().decode(contents["manifest.json"]));
  assert.equal(packageManifest.evidence.find((entry: { domain: string }) => entry.domain === "files").sha256,
    crypto.createHash("sha256").update(contents["evidence/files.json"]).digest("hex"));
  assert.ok(contents["inventory.csv"]);
  assert.ok(contents["inventory.html"]);
  assert.deepEqual(Object.keys(contents).filter((key) => key.startsWith("files/")), ["files/001-As_Built.pdf"]);
  assert.equal(new TextDecoder().decode(contents["files/001-As_Built.pdf"]), "verified document contents");
  const accepted = acceptCloseoutPackage({ packageId: pkg.id, projectId: projectB, actor,
    note: "Client handover reviewed locally.", acknowledgedExceptions: [] });
  assert.equal(accepted.packageId, pkg.id);
  assert.throws(() => acceptCloseoutPackage({ packageId: pkg.id, projectId: projectB, actor,
    note: "Second signature", acknowledgedExceptions: [] }));
  ingestCloseoutProjectEvidence(session, { projectId: projectB, collectedAt: 2_000, sources: sources("Rejected").map((source) => ({ ...source, collectedAt: 2_000 })) });
  assert.notEqual(assessCloseoutProject(projectB)?.status, "ready");
  assert.ok(assessCloseoutProject(projectB)?.findings.some((finding) => finding.code === "stale-selection"));
  clearCloseoutSelection(projectB, "file-a", actor);
  assert.ok(assessCloseoutProject(projectB)?.findings.some((finding) => finding.code === "no-record-documents"));
});

test("an Assets-only profile still checks approval of a selected final file", () => {
  const profile = createCloseoutProfile({ name: "Assets with selected record document", client: "Client E",
    businessUnit: "Operations", projectType: "Facility", requiredDomains: ["assets"],
    requiredAssetFields: [] }, actor);
  addExpectedDeliverable({ profileId: profile.id, domain: "assets", label: "Turnover asset",
    externalId: "asset-e", requiredMetadata: [] }, actor);
  assignCloseoutProfile(projectE, profile.id, actor);
  const version = "urn:adsk.wipprod:fs.file:vf.asset-record?version=1";
  const scan = (approval: string, collectedAt: number) => ({ projectId: projectE, collectedAt, sources: [
    { domain: "assets", rows: [{ project_id: projectE, id: "asset-e", name: "Air handler" }],
      complete: true, error: null, collectedAt, source: "live-aps" as const },
    { domain: "files", rows: [{ project_id: projectE, id: "file-e", item_id: "file-e",
      version_id: version, name: "Record.pdf", is_latest: true }],
      complete: true, error: null, collectedAt, source: "live-aps" as const },
    { domain: "reviews", rows: [{ project_id: projectE, id: "review-e-version",
      record_kind: "review-version", version_id: version, review_status: "CLOSED", approval_status: approval }],
      complete: true, error: null, collectedAt, source: "live-aps" as const },
  ] });
  ingestCloseoutProjectEvidence(session, scan("Rejected", 1_000));
  const current = currentSelectableRecord(projectE, "files", "file-e");
  selectCloseoutRecord({ projectId: projectE, domain: "files", externalId: "file-e",
    versionId: current.versionId, sourceRevision: current.source.revision!, sourceKind: "live-aps",
    name: current.name, selectedBy: actor });
  const rejected = assessCloseoutProject(projectE)!;
  assert.deepEqual(rejected.sources.map((source) => source.domain), ["files", "assets", "reviews"]);
  assert.equal(rejected.status, "blockers");
  assert.ok(rejected.findings.some((finding) => finding.code === "file-not-approved" && finding.recordId === "file-e"));

  ingestCloseoutProjectEvidence(session, scan("Approved", 2_000));
  assert.ok(assessCloseoutProject(projectE)?.findings.some((finding) => finding.code === "stale-selection"));
  const refreshed = currentSelectableRecord(projectE, "files", "file-e");
  selectCloseoutRecord({ projectId: projectE, domain: "files", externalId: "file-e",
    versionId: refreshed.versionId, sourceRevision: refreshed.source.revision!, sourceKind: "live-aps",
    name: refreshed.name, selectedBy: actor });
  assert.equal(assessCloseoutProject(projectE)?.status, "ready");
});

test("required closure workflow needs explicit terminal policy and treats unrecognized status as unknown", () => {
  const profile = createCloseoutProfile({ name: "Issue closeout", client: "Client D",
    businessUnit: "Construction", projectType: "Facility", requiredDomains: ["issues"],
    requiredAssetFields: [] }, actor);
  addExpectedDeliverable({ profileId: profile.id, domain: "issues", label: "Commissioning issue",
    externalId: "issue-d", requiredMetadata: [] }, actor);
  assignCloseoutProfile(projectD, profile.id, actor);
  const issueSource = (status: string, collectedAt: number) => ({ projectId: projectD, collectedAt, sources: [
    { domain: "issues", rows: [{ project_id: projectD, id: "issue-d", status }],
      complete: true, error: null, collectedAt, source: "live-aps" as const },
  ] });
  ingestCloseoutProjectEvidence(session, issueSource("open", 1000));
  assert.ok(assessCloseoutProject(projectD)?.findings.some((finding) => finding.code === "status-policy-missing"));
  const rules = defaultCloseoutRules();
  rules.statusPolicies = [{ domain: "issues", openStatuses: ["open"], terminalStatuses: ["closed"] }];
  saveCloseoutProfileRules(profile.id, rules, actor);
  assert.equal(assessCloseoutProject(projectD)?.status, "blockers");
  ingestCloseoutProjectEvidence(session, issueSource("Review", 2000));
  assert.equal(assessCloseoutProject(projectD)?.status, "unknown");
  ingestCloseoutProjectEvidence(session, issueSource("closed", 3000));
  assert.equal(assessCloseoutProject(projectD)?.status, "ready");
});

test("trusted APS job scope verifies project coverage without manual CSV attestation", async () => {
  const profile = createCloseoutProfile({ name: "Trusted asset turnover", client: "Client C",
    businessUnit: "Construction", projectType: "Facility", requiredDomains: ["assets"],
    requiredAssetFields: [] }, actor);
  addExpectedDeliverable({ profileId: profile.id, domain: "assets", label: "Final pump",
    externalId: "asset-c", requiredMetadata: ["category_id"] }, actor);
  assignCloseoutProfile(projectC, profile.id, actor);
  const csv = strToU8(`id,bim360_project_id,category_id\nasset-c,${projectC},mechanical\n`);
  const manifest = { provenance: "aps_data_connector_job" as const,
    hubId: process.env.FORMA_HUB_ID!, jobId: "job-c", requestId: "request-c",
    jobCompletedAt: new Date().toISOString(), projectScope: {
      kind: "selected_projects" as const, projectIds: [projectC], projectStatus: "all" as const,
    }, serviceGroups: ["assets"], expectedFiles: ["assets_assets.csv"], skippedFiles: [] };
  async function* files() { yield { name: "assets_assets.csv", bytes: csv }; }
  await ingestTrustedCsvFiles(manifest, files());
  const source = collectCloseoutSources(projectC).find((item) => item.domain === "assets")!;
  assert.equal(source.kind, "aps-data-connector");
  assert.equal(source.coverage, "verified-aps-extract");
  assert.equal(assessCloseoutProject(projectC)?.status, "ready");
  assert.equal(collectCloseoutSources(projectA).find((item) => item.domain === "assets")?.coverage, "unverified");
  const pkg = await buildCloseoutPackage(fullSession, projectC, async () => { throw new Error("No Files selected"); });
  const entries = unzipSync(readVerifiedCloseoutPackage(pkg.id).bytes);
  const assetIndex = JSON.parse(new TextDecoder().decode(entries["assets/index.json"]));
  assert.deepEqual(assetIndex.assets.map((item: { id: string }) => item.id), ["asset-c"]);
  assert.ok(entries["assets/inventory.csv"]);
  assert.ok(entries["assets/inventory.html"]);
  assert.equal(pkg.status, "exceptions");
});

test("failed exact-version check yields an exception package with no misleading binary", async () => {
  const version = "urn:adsk.wipprod:fs.file:vf.test?version=2";
  ingestCloseoutProjectEvidence(session, { projectId: projectB, collectedAt: 3_000, sources: [
    { domain: "files", rows: [{ project_id: projectB, id: "file-a", item_id: "file-a", version_id: version,
      name: "As/Built.pdf", folder_path: "Project Files/Closeout", is_latest: true }],
      complete: true, error: null, collectedAt: 3_000, source: "live-aps" },
    { domain: "reviews", rows: [{ project_id: projectB, id: "review-version", record_kind: "review-version",
      version_id: version, review_status: "CLOSED", approval_status: "Approved" }],
      complete: true, error: null, collectedAt: 3_000, source: "live-aps" },
  ] });
  const current = currentSelectableRecord(projectB, "files", "file-a");
  selectCloseoutRecord({ projectId: projectB, domain: "files", externalId: "file-a", versionId: current.versionId,
    sourceRevision: current.source.revision!, sourceKind: "live-aps", name: current.name, selectedBy: actor });
  const wrong = await buildCloseoutPackage(fullSession, projectB, async () => ({ bytes: strToU8("wrong"),
    name: "wrong.pdf", versionId: "wrong-version", itemId: "file-a", storageUrn: "urn:wrong", sha256: "wrong" }));
  assert.equal(wrong.status, "exceptions");
  const entries = unzipSync(readVerifiedCloseoutPackage(wrong.id).bytes);
  assert.deepEqual(Object.keys(entries).filter((key) => key.startsWith("files/")), []);
  const packageManifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
  assert.ok(packageManifest.exceptions.some((item: { code: string }) => item.code === "file-not-included"));
  assert.throws(() => acknowledgedCloseoutExceptions(packageManifest, []), /Acknowledge each/);
  assert.deepEqual(acknowledgedCloseoutExceptions(packageManifest,
    packageManifest.exceptions.map((item: { id: string }) => item.id)).length,
    packageManifest.exceptions.length);
  assert.throws(() => acknowledgedCloseoutExceptions({ ...packageManifest, exceptionOverflow: 1 },
    packageManifest.exceptions.map((item: { id: string }) => item.id)), /beyond the review limit/);
  ingestCloseoutProjectEvidence(session, { projectId: projectB, collectedAt: 4_000, sources: [
    { domain: "files", rows: [{ project_id: projectB, id: "file-a", item_id: "file-a", version_id: version,
      name: "As/Built.pdf", folder_path: "Project Files/Closeout" }],
      complete: true, error: null, collectedAt: 4_000, source: "live-aps" },
    { domain: "reviews", rows: [
      { project_id: projectB, id: "approval-1", record_kind: "review-version", version_id: version,
        review_status: "CLOSED", approval_status: "Approved" },
      { project_id: projectB, id: "approval-2", record_kind: "review-version", version_id: version,
        review_status: "CLOSED", approval_status: "Rejected" },
    ], complete: true, error: null, collectedAt: 4_000, source: "live-aps" },
  ] });
  const currentAgain = currentSelectableRecord(projectB, "files", "file-a");
  selectCloseoutRecord({ projectId: projectB, domain: "files", externalId: "file-a", versionId: version,
    sourceRevision: currentAgain.source.revision!, sourceKind: "live-aps", name: currentAgain.name, selectedBy: actor });
  assert.ok(assessCloseoutProject(projectB)?.findings.some((finding) => finding.code === "ambiguous-approval"));
});
