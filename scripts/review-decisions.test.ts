import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-review-decisions-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const {
  setGovernanceDecision, clearGovernanceDecision, governanceDecisions,
  setLifecycleDecision, clearLifecycleDecision, lifecycleDecisions,
} = await import("../src/lib/reviewDecisions.ts");
const { closeDb } = await import("../src/lib/db.ts");

after(() => {
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

const now = Date.parse("2026-09-29T12:00:00Z");
const day = 86_400_000;

test("governance choices are scoped to user, project, and rule", () => {
  setGovernanceDecision("autodesk:alice", "Project-A", "quiet-project", "acknowledged", now);
  setGovernanceDecision("autodesk:alice", "Project-A", "past-end-date", "ignored", now);
  setGovernanceDecision("autodesk:bob", "Project-A", "quiet-project", "ignored", now);

  const alice = governanceDecisions("autodesk:alice", now);
  const bob = governanceDecisions("autodesk:bob", now);
  assert.equal(alice.get("quiet-project:project-a")?.choice, "acknowledged");
  assert.equal(alice.get("past-end-date:project-a")?.choice, "ignored");
  assert.equal(bob.get("quiet-project:project-a")?.choice, "ignored");
  assert.equal(bob.size, 1);

  clearGovernanceDecision("autodesk:alice", "PROJECT-A", "quiet-project");
  assert.equal(governanceDecisions("autodesk:alice", now).has("quiet-project:project-a"), false);
  assert.equal(governanceDecisions("autodesk:bob", now).get("quiet-project:project-a")?.choice, "ignored");
});

test("governance snooze expires after 30 days and can be renewed", () => {
  setGovernanceDecision("autodesk:alice", "project-b", "large-membership", "snoozed", now);
  assert.equal(governanceDecisions("autodesk:alice", now + 30 * day - 1)
    .get("large-membership:project-b")?.untilAt, now + 30 * day);
  assert.equal(governanceDecisions("autodesk:alice", now + 30 * day)
    .has("large-membership:project-b"), false);
  setGovernanceDecision("autodesk:alice", "project-b", "large-membership", "snoozed", now + 31 * day);
  assert.equal(governanceDecisions("autodesk:alice", now + 31 * day).get("large-membership:project-b")?.untilAt,
    now + 61 * day);
});

test("lifecycle states persist per user and a 90-day snooze returns to review", () => {
  setLifecycleDecision("autodesk:alice", "Project-A", "keep-active", now);
  setLifecycleDecision("autodesk:bob", "Project-A", "prepare-archive", now);
  assert.equal(lifecycleDecisions("autodesk:alice", now).get("project-a")?.choice, "keep-active");
  assert.equal(lifecycleDecisions("autodesk:bob", now).get("project-a")?.choice, "prepare-archive");

  setLifecycleDecision("autodesk:alice", "Project-A", "snoozed", now);
  assert.equal(lifecycleDecisions("autodesk:alice", now + 90 * day - 1).get("project-a")?.untilAt,
    now + 90 * day);
  assert.equal(lifecycleDecisions("autodesk:alice", now + 90 * day).has("project-a"), false);
  assert.equal(lifecycleDecisions("autodesk:bob", now + 90 * day).get("project-a")?.choice, "prepare-archive");

  clearLifecycleDecision("autodesk:bob", "project-a");
  assert.equal(lifecycleDecisions("autodesk:bob", now).has("project-a"), false);
});

test("unrecognized choices cannot be stored", () => {
  assert.throws(() => setGovernanceDecision("autodesk:alice", "p", "unknown" as never, "ignored", now));
  assert.throws(() => setLifecycleDecision("autodesk:alice", "p", "archive-now" as never, now));
});

test("a saved decision survives closing and reopening SQLite", () => {
  setLifecycleDecision("autodesk:alice", "project-c", "prepare-archive", now);
  closeDb();
  assert.equal(lifecycleDecisions("autodesk:alice", now).get("project-c")?.choice, "prepare-archive");
});
