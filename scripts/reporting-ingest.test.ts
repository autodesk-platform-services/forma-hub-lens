import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { TrustedReportingManifest } from "../src/lib/dataset";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-reporting-"));
const HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
process.env.DATA_DIR = directory;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = HUB_ID;

const dataset = await import("../src/lib/dataset.ts");
const { closeDb, getDb } = await import("../src/lib/db.ts");
const { reportingIngestSafety } = await import("../src/lib/reportingIngest.ts");

after(() => {
  closeDb();
  fs.rmSync(directory, { recursive: true, force: true });
});

const manifest: TrustedReportingManifest = {
  provenance: "aps_data_connector_job",
  hubId: HUB_ID,
  jobId: "job-trusted-1",
  requestId: "request-1",
  jobCompletedAt: "2026-09-29T12:00:00Z",
  projectScope: { kind: "selected_projects", projectIds: ["11111111-1111-4111-8111-111111111111"], projectStatus: "active" },
  serviceGroups: ["admin", "issues"],
  expectedFiles: ["admin_users.csv", "issues.csv"],
  skippedFiles: ["metadata.json"],
};

async function* files(second = strToU8("id,status\ni1,open\n")) {
  yield { name: "admin_users.csv", bytes: strToU8("id,name\nu1,Current\n") };
  yield { name: "issues.csv", bytes: second };
}

test("trusted reporting ingest atomically swaps all tables and records exact APS lineage", async () => {
  await dataset.ingestZip("manual.zip", zipSync({
    "admin_users.csv": strToU8("id,name\nu1,Old\n"),
  }));
  assert.equal(dataset.getTrustedTableSource("admin_users"), null);

  const summary = await dataset.ingestTrustedCsvFiles(manifest, files());
  assert.equal(summary.provenance, "aps_data_connector_job");
  assert.equal(summary.tables.length, 2);
  assert.equal(summary.totalRows, 2);
  assert.deepEqual(summary.skipped, [{ name: "metadata.json", reason: "not a CSV" }]);
  const source = dataset.getTrustedTableSource("admin_users");
  assert.equal(source?.jobId, manifest.jobId);
  assert.equal(source?.requestId, manifest.requestId);
  assert.deepEqual(source?.projectScope, manifest.projectScope);
  assert.deepEqual(source?.serviceGroups, ["admin", "issues"]);
  assert.equal(source?.truncated, false);
  assert.equal(dataset.trustedReportingUploads()[0]?.jobId, manifest.jobId);
  assert.equal(dataset.trustedReportingUploads()[0]?.tables.length, 2);
  assert.deepEqual((getDb().prepare("SELECT name FROM ds_admin_users").all() as Array<{ name: string }>).map((row) => row.name), ["Current"]);

  await assert.rejects(dataset.ingestTrustedCsvFiles({ ...manifest, jobId: "job-bad" }, files(new Uint8Array())), /empty file/);
  assert.equal(dataset.getTrustedTableSource("admin_users")?.jobId, manifest.jobId);
  assert.deepEqual((getDb().prepare("SELECT name FROM ds_admin_users").all() as Array<{ name: string }>).map((row) => row.name), ["Current"]);
  assert.equal(dataset.trustedReportingUploads().length, 1, "failed import must not record a completed upload");

  await dataset.ingestZip("manual-replacement.zip", zipSync({
    "admin_users.csv": strToU8("id,name\nu1,Manual\n"),
  }));
  assert.equal(dataset.getTrustedTableSource("admin_users"), null, "user replacement clears table-level trusted lineage");
  assert.equal(dataset.getTrustedTableSource("issues")?.jobId, manifest.jobId);

  async function* headerOnly() { yield { name: "empty.csv", bytes: strToU8("id,status\n") }; }
  const emptySummary = await dataset.ingestTrustedCsvFiles({
    ...manifest, jobId: "job-header-only", expectedFiles: ["empty.csv"], skippedFiles: [],
  }, headerOnly());
  assert.equal(emptySummary.tables[0].rows, 0, "header-only APS CSV is a valid empty reporting table");
  assert.equal(dataset.getTrustedTableSource("empty")?.rowCount, 0);
});

test("reporting ingest rejects unsafe signed URL hosts and unverified job/request scope", () => {
  assert.equal(reportingIngestSafety.isS3SignedUrl("https://bucket.s3.us-east-1.amazonaws.com/file.csv?sig=abc"), true);
  assert.equal(reportingIngestSafety.isS3SignedUrl("http://bucket.s3.us-east-1.amazonaws.com/file.csv"), false);
  assert.equal(reportingIngestSafety.isS3SignedUrl("https://127.0.0.1/file.csv"), false);
  assert.equal(reportingIngestSafety.isS3SignedUrl("https://s3.us-east-1.amazonaws.com.evil.com/file.csv"), false);
  assert.throws(() => reportingIngestSafety.reportingManifest(
    { id: "j", requestId: "r", status: "complete", completionStatus: "failed" },
    { id: "r", serviceGroups: ["admin"] }, [{ name: "admin_users.csv" }],
  ), /successfully completed/);
  assert.throws(() => reportingIngestSafety.reportingManifest(
    { id: "j", requestId: "r", status: "complete" },
    { id: "different", serviceGroups: ["admin"] }, [{ name: "admin_users.csv" }],
  ), /verified request/);
});

test("CDC change windows cannot overwrite a complete reporting snapshot", () => {
  for (const serviceGroups of [["cdcissues"], ["cdcissues", "admin"]]) {
    assert.throws(() => reportingIngestSafety.reportingManifest(
      { id: "j", requestId: "r", status: "complete", completedAt: "2026-10-01T12:00:00Z" },
      { id: "r", serviceGroups, dateRange: "LAST_DAY" }, [{ name: "issues.csv" }],
    ), /delta|CDC|merge/i);
  }
});
