import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-project-health-"));
process.env.DATA_DIR = dir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { getDb, closeDb } = await import("../src/lib/db.ts");
const { archiveAssessment, projectEvidence } = await import("../src/lib/governance.ts");
const db = getDb();
const now = Date.parse("2026-09-29T12:00:00Z");

for (const id of ["project-1", "project-2"]) {
  db.prepare(`INSERT INTO projects (id, name, status, raw, synced_at)
              VALUES (?, ?, 'active', '{}', ?)`).run(id, id, now);
}
db.exec(`CREATE TABLE data_connector_requests (id TEXT PRIMARY KEY, raw TEXT NOT NULL, last_seen_at INTEGER NOT NULL)`);
db.prepare("INSERT INTO data_connector_requests (id, raw, last_seen_at) VALUES (?, ?, ?)").run(
  "request-1", JSON.stringify({ projectIdList: ["project-1"], serviceGroups: ["activities"] }), now,
);
db.prepare(`INSERT INTO extract_jobs
  (job_id, request_id, status, service_groups, start_date, end_date, ingested_at, activity_rows)
  VALUES ('job-1', 'request-1', 'complete', 'activities', '2026-09-01', '2026-09-28', ?, 2)`).run(now);
const insertActivity = db.prepare(`INSERT INTO activities
  (job_id, source_file, fingerprint, occurred_ms, occurred_at, project_id, raw)
  VALUES ('job-1', 'activity.csv', ?, ?, ?, 'project-1', '{}')`);
for (const date of ["2026-09-05", "2026-09-20"]) {
  insertActivity.run(date, Date.parse(`${date}T12:00:00Z`), date);
}

function addWorkflowTable(name: string, statusColumn: string, rows: Array<[string, string]>): void {
  const sqlName = `ds_${name}`;
  db.exec(`CREATE TABLE "${sqlName}" (bim360_project_id TEXT, "${statusColumn}" TEXT)`);
  const insert = db.prepare(`INSERT INTO "${sqlName}" (bim360_project_id, "${statusColumn}") VALUES (?, ?)`);
  for (const [projectId, status] of rows) insert.run(projectId, status);
  db.prepare(`INSERT INTO dataset_tables (name, sql_name, columns, row_count, truncated, uploaded_at)
              VALUES (?, ?, ?, ?, 0, ?)`).run(name, sqlName, JSON.stringify([
    { name: "bim360_project_id", sqlName: "bim360_project_id" },
    { name: statusColumn, sqlName: statusColumn },
  ]), rows.length, now);
}
addWorkflowTable("issues_issues", "status", [["project-1", "open"], ["project-1", "in_progress"], ["project-1", "closed"]]);
addWorkflowTable("rfis_rfis", "status", [["project-1", "closed"]]);
addWorkflowTable("submittalsacc_items", "status_value", [["project-1", "In Review"]]);

after(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scorecard compares only contiguous project-scoped activity windows", () => {
  const one = projectEvidence(now).find((row) => row.project.id === "project-1")!;
  assert.equal(one.activityCoverage.scopeKnown, true);
  assert.equal(one.trend.available, true);
  assert.equal(one.trend.previous, 1);
  assert.equal(one.trend.current, 1);
  const two = projectEvidence(now).find((row) => row.project.id === "project-2")!;
  assert.equal(two.activityCoverage.scopeKnown, false);
  assert.equal(two.trend.available, false);

  db.prepare("UPDATE extract_jobs SET start_date = '2026-09-02' WHERE job_id = 'job-1'").run();
  assert.equal(projectEvidence(now).find((row) => row.project.id === "project-1")!.trend.available, false);
  db.prepare("UPDATE extract_jobs SET start_date = '2026-09-01' WHERE job_id = 'job-1'").run();
});

test("workflow counts are joined by project and surfaced as archive review blockers", () => {
  const one = projectEvidence(now).find((row) => row.project.id === "project-1")!;
  assert.deepEqual(one.workflowBacklog.map((row) => row.observedOpen), [2, 0, 1]);
  const assessment = archiveAssessment(one);
  assert.ok(assessment.blockers.some((message) => message.includes("2 observed open issues")));
  assert.ok(assessment.blockers.some((message) => message.includes("1 observed open submittals")));
  assert.ok(assessment.checks.some((message) => message.includes("Confirm rfis")));
});

test("an uploaded status table without project rows does not assert zero open work", () => {
  const two = projectEvidence(now).find((row) => row.project.id === "project-2")!;
  assert.deepEqual(two.workflowBacklog.map((row) => row.observedOpen), [null, null, null]);
  assert.ok(two.workflowBacklog.every((row) => row.caveat?.includes("project coverage is unverified")));
});

test("missing join columns yield unknown rather than a false zero", () => {
  db.prepare("UPDATE dataset_tables SET columns = ? WHERE name = 'rfis_rfis'").run(
    JSON.stringify([{ name: "status", sqlName: "status" }]),
  );
  const one = projectEvidence(now).find((row) => row.project.id === "project-1")!;
  assert.equal(one.workflowBacklog.find((row) => row.key === "rfis")!.observedOpen, null);
});
