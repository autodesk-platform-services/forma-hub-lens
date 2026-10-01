import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-data-health-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { getDataHealth, acknowledgeSchemaChanges, classifySnapshotLineage, isPendingActivityIngest } =
  await import("../src/lib/dataHealth.ts");
const { ingestZip } = await import("../src/lib/dataset.ts");
const { closeDb } = await import("../src/lib/db.ts");
type StoredJob = import("../src/lib/aps/dataConnector.ts").StoredJob;
type DatasetTable = import("../src/lib/dataset.ts").DatasetTable;

after(() => {
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("schema baseline detects added and changed local CSV headers and can be acknowledged", async () => {
  const before = getDataHealth(1_000);
  assert.equal(before.schemaChanges.length, 0);
  assert.equal(before.schemaBaselineAt, 1_000);

  await ingestZip("first.zip", zipSync({ "admin_projects.csv": strToU8("id,name\np1,First\n") }));
  const first = getDataHealth();
  assert.deepEqual(first.schemaChanges.map((change) => [change.table, change.kind]), [
    ["admin_projects", "table added"],
  ]);

  acknowledgeSchemaChanges(2_000);
  assert.equal(getDataHealth().schemaChanges.length, 0);

  await ingestZip("second.zip", zipSync({ "admin_projects.csv": strToU8("id,project_name\np1,First\n") }));
  const second = getDataHealth();
  assert.deepEqual(second.schemaChanges[0], {
    table: "admin_projects",
    kind: "columns changed",
    addedColumns: ["project_name"],
    removedColumns: ["name"],
  });
});

test("partial ZIP replacement is identified as a mixed local snapshot", async () => {
  await ingestZip("other.zip", zipSync({ "issues_issues.csv": strToU8("id\ni1\n") }));
  const health = getDataHealth();
  assert.equal(health.mixedSnapshot, true);
  assert.equal(health.unknownTableLineage.length, 0);
});

test("unmapped lineage is unknown and non-activity jobs are not marked for activity ingestion", () => {
  const table: DatasetTable = {
    name: "admin_projects", sqlName: "ds_admin_projects", columns: [], rowCount: 0,
    truncated: false, uploadedAt: 500,
  };
  assert.deepEqual(classifySnapshotLineage([table], []), {
    mixed: null, unknownTables: ["admin_projects"],
  });
  const job: StoredJob = {
    jobId: "job", requestId: null, status: "complete", completionStatus: "success",
    createdAt: null, completedAt: null, startDate: null, endDate: null,
    serviceGroups: "admin,issues", ingestedAt: null, ingestError: null, activityRows: 0,
  };
  assert.equal(isPendingActivityIngest(job), false);
  assert.equal(isPendingActivityIngest({ ...job, serviceGroups: "admin,activities" }), true);
  assert.equal(isPendingActivityIngest({ ...job, serviceGroups: "activities", completionStatus: null }), true);
  assert.equal(isPendingActivityIngest({ ...job, serviceGroups: "activities", completionStatus: "failed" }), false);
});
