import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forma-admin-audit-"));
process.env.DATA_DIR = directory;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const {
  saveAdminPlan, readAdminPlan, claimAdminPlan, InvalidAdminPlanError,
  startAdminItem, finishAdminItem, recordAdminSkip, finishAdminOperation,
  adminOperation, adminOperationItems,
} = await import("../src/lib/adminOperations.ts");
const { closeDb, getDb } = await import("../src/lib/db.ts");

const session = {
  id: "session-1", mode: "live" as const, accessToken: "token", refreshToken: null, expiresAt: Date.now() + 100_000,
  scope: null, userId: "autodesk-user-1", userName: "Ada", userEmail: "ada@example.com",
  hubVerifiedAt: Date.now(), hubRole: "hub_admin" as const,
};

after(() => {
  closeDb();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("preview is bound to the same session and is claimed only once", () => {
  const preview = saveAdminPlan(session, {
    kind: "create_projects",
    targets: [{ name: "North Tower", type: "Office", classification: "production" }],
    skips: [{ key: "Duplicate", label: "Duplicate", reason: "Already exists." }],
  }, "Create one project", ["North Tower"]);
  assert.equal(preview.planned, 1);
  assert.equal(preview.skipped, 1);
  assert.equal(readAdminPlan(session, preview.id).preview.id, preview.id);
  assert.throws(
    () => readAdminPlan({ ...session, id: "another-session" }, preview.id),
    InvalidAdminPlanError,
  );

  assert.throws(
    () => claimAdminPlan({ ...session, id: "another-session" }, preview.id, "create_projects"),
    InvalidAdminPlanError,
  );
  assert.throws(
    () => claimAdminPlan(session, preview.id, "archive_projects"),
    InvalidAdminPlanError,
  );
  const claimed = claimAdminPlan(session, preview.id, "create_projects");
  assert.equal(claimed.plan.kind, "create_projects");
  assert.throws(
    () => claimAdminPlan(session, preview.id, "create_projects"),
    InvalidAdminPlanError,
  );

  recordAdminSkip(claimed.operationId, 0, { key: "Duplicate", label: "Duplicate", reason: "Already exists." });
  startAdminItem(claimed.operationId, 1, "North Tower", "North Tower");
  finishAdminItem(claimed.operationId, 1, "succeeded", "Created");
  finishAdminOperation(claimed.operationId, "Created one project");
  const operation = adminOperation(claimed.operationId);
  assert.equal(operation?.status, "complete");
  assert.equal(operation?.succeeded, 1);
  assert.equal(operation?.skipped, 1);
  assert.deepEqual(adminOperationItems(claimed.operationId).map((item) => item.status), ["skipped", "succeeded"]);
});

test("expired preview cannot be executed", () => {
  const preview = saveAdminPlan(session, {
    kind: "archive_projects",
    targets: [{ projectId: "p1", name: "Old Project" }],
    skips: [],
  }, "Archive project", ["Old Project"]);
  getDb().prepare("UPDATE admin_operation_plans SET expires_at = ? WHERE id = ?")
    .run(Date.now() - 1, preview.id);
  assert.throws(() => claimAdminPlan(session, preview.id, "archive_projects"), InvalidAdminPlanError);
});

test("interrupted item stays visible instead of being reported as success", () => {
  const preview = saveAdminPlan(session, {
    kind: "remove_members",
    targets: [{ projectId: "p2", userId: "u2", email: "person@example.com" }],
    skips: [],
  }, "Remove member", ["person@example.com"]);
  const claimed = claimAdminPlan(session, preview.id, "remove_members");
  startAdminItem(claimed.operationId, 0, "p2:u2", "person@example.com");
  finishAdminOperation(claimed.operationId, "Interrupted");
  assert.equal(adminOperation(claimed.operationId)?.status, "incomplete");
  assert.equal(adminOperationItems(claimed.operationId)[0]?.status, "started");
});
