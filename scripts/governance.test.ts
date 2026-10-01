import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-governance-"));
process.env.DATA_DIR = dir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { getDb, closeDb } = await import("../src/lib/db.ts");
const { governanceFindings, normalizeSettings, projectEvidence } = await import("../src/lib/governance.ts");
const db = getDb();
const now = Date.parse("2026-09-29T12:00:00Z");
db.prepare(`INSERT INTO projects
  (id,name,status,type,platform,job_number,member_count,sheet_count,company_count,created_at,updated_at,last_sign_in,raw,synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  "project-1", "River Hospital", "active", "Hospital", "acc", null,
  120, 30, 2, "2026-01-01T00:00:00Z", null, null, JSON.stringify({ endDate: "2026-08-01" }), now,
);

after(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("governance flags current admin metadata but does not infer quietness without coverage", () => {
  const { findings } = governanceFindings({}, now);
  const rules = findings.map((finding) => finding.rule);
  assert.ok(rules.includes("missing-job-number"));
  assert.ok(rules.includes("past-end-date"));
  assert.ok(rules.includes("large-membership"));
  assert.ok(!rules.includes("quiet-project"));
});

test("quiet candidate needs a recent extract window spanning the threshold", () => {
  db.exec(`CREATE TABLE data_connector_requests (id TEXT PRIMARY KEY, raw TEXT NOT NULL, last_seen_at INTEGER NOT NULL)`);
  db.prepare("INSERT INTO data_connector_requests (id, raw, last_seen_at) VALUES (?, ?, ?)").run(
    "request-1", JSON.stringify({ id: "request-1", projectStatus: "all", serviceGroups: ["activities"] }), now,
  );
  db.prepare(`INSERT INTO extract_jobs
    (job_id, request_id, status, service_groups, created_at, start_date, end_date, ingested_at, activity_rows)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "job-1", "request-1", "complete", "activities", "2026-09-28T09:00:00Z", "2026-05-01", "2026-09-28", now, 0,
  );
  let result = governanceFindings({ quietDays: 90 }, now);
  assert.ok(result.findings.some((finding) => finding.rule === "quiet-project"));

  db.prepare("UPDATE extract_jobs SET end_date = ? WHERE job_id = ?").run("2026-08-01", "job-1");
  result = governanceFindings({ quietDays: 90 }, now);
  assert.ok(!result.findings.some((finding) => finding.rule === "quiet-project"));
});

test("a project created after a hub-wide job began cannot inherit its extract coverage", () => {
  db.prepare(`INSERT INTO projects (id, name, status, created_at, raw, synced_at)
    VALUES (?, ?, 'active', ?, '{}', ?)`).run(
      "project-2", "Later Project", "2026-09-28T10:00:00Z", now,
    );
  db.prepare("UPDATE extract_jobs SET end_date = '2026-09-28' WHERE job_id = 'job-1'").run();
  assert.equal(projectEvidence(now).find((row) => row.project.id === "project-2")!.activityCoverage.scopeKnown, false);

  db.prepare("UPDATE projects SET created_at = '2026-09-28T08:00:00Z' WHERE id = 'project-2'").run();
  assert.equal(projectEvidence(now).find((row) => row.project.id === "project-2")!.activityCoverage.scopeKnown, true);
});

test("threshold inputs are bounded", () => {
  assert.deepEqual(normalizeSettings({ quietDays: -1, largeMembership: 1_000_000 }), {
    quietDays: 7,
    largeMembership: 10_000,
  });
});
