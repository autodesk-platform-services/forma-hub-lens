import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-people-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { ingestZip } = await import("../src/lib/dataset.ts");
const { closeDb, getDb } = await import("../src/lib/db.ts");
const { getPerson, listAccessMatrix, listPeople, peopleSourceStatus, personActivityObservation } = await import("../src/lib/people.ts");
const { comparePersonAccess } = await import("../src/lib/personCompare.ts");

after(() => {
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("people and access matrix use exact IDs, report unknown identities and paginate", async () => {
  const projectRows = Array.from({ length: 60 }, (_, index) => {
    const id = `p${String(index + 1).padStart(2, "0")}`;
    return `${id},Project ${String(index + 1).padStart(2, "0")}`;
  });
  const memberships = Array.from({ length: 60 }, (_, index) => {
    const id = `p${String(index + 1).padStart(2, "0")}`;
    return `u1,${id},active,member`;
  });
  memberships.push("ghost,p61,active,member");
  const zip = zipSync({
    "admin_users.csv": strToU8("id,autodesk_id,name,email,status,last_sign_in\nu1,adsk-1,Ada,ada@example.com,active,2026-09-01\n"),
    "admin_projects.csv": strToU8(`id,name\n${projectRows.join("\n")}\n`),
    "admin_project_users.csv": strToU8(`user_id,bim360_project_id,status,access_level\n${memberships.join("\n")}\n`),
    "admin_project_user_products.csv": strToU8("user_id,bim360_project_id,product_key,access_level\nu1,p01,build,member\n"),
  });
  await ingestZip("people.zip", zip);

  const sources = peopleSourceStatus();
  assert.equal(sources.directoryReady, true);
  assert.equal(sources.matrixReady, true);
  assert.equal(sources.productsReady, true);
  const directory = listPeople("ada@example.com", 1);
  assert.equal(directory.total, 1);
  assert.equal(directory.rows[0].memberships, 60);
  assert.equal(getPerson("u1").state, "found");
  getDb().prepare(`INSERT INTO activities
    (job_id, source_file, fingerprint, occurred_ms, actor_id, actor_email, raw)
    VALUES (?, ?, ?, ?, ?, ?, '{}')`).run("job-1", "activity.csv", "ada-event", 1000, "adsk-1", null);
  getDb().prepare(`INSERT INTO activities
    (job_id, source_file, fingerprint, occurred_ms, actor_id, actor_email, raw)
    VALUES (?, ?, ?, ?, ?, ?, '{}')`).run("job-1", "activity.csv", "other-event", 2000, "other", "other@example.com");
  const person = getPerson("u1");
  assert.equal(person.state, "found");
  if (person.state === "found") {
    assert.deepEqual(personActivityObservation(person.person), {
      lastObservedAt: 1000, activityDataThrough: 2000,
    });
  }

  const first = listAccessMatrix({ userId: "u1", page: 1 });
  const second = listAccessMatrix({ userId: "u1", page: 2 });
  assert.equal(first.total, 60);
  assert.equal(first.rows.length, 50);
  assert.equal(second.rows.length, 10);
  assert.equal(first.rows[0].projectName, "Project 01");
  assert.equal(first.rows[0].identity, "matched");
  assert.deepEqual(first.rows[0].products, [{ key: "build", access: "member" }]);
  assert.equal(listAccessMatrix({ search: "ada@example.com", project: "Project 01", page: 1 }).total, 1);
  const unknown = listAccessMatrix({ userId: "ghost", page: 1 });
  assert.equal(unknown.rows[0].identity, "missing");
  assert.equal(unknown.rows[0].email, null);

  // Replacing only the user table can make IDs ambiguous. Never attach one of
  // the two people's name or email to a membership at random.
  await ingestZip("duplicate-users.zip", zipSync({
    "admin_users.csv": strToU8("id,name,email\nu1,Ada,ada@example.com\nu1,Other,other@example.com\n"),
  }));
  assert.equal(getPerson("u1").state, "ambiguous");
  assert.equal(listAccessMatrix({ userId: "u1", page: 1 }).rows[0].identity, "ambiguous");
  assert.equal(listPeople("Ada", 1).rows[0].duplicateId, true);
});

test("person comparison uses exact IDs and marks missing or duplicate access fields unknown", async () => {
  await ingestZip("compare.zip", zipSync({
    "admin_users.csv": strToU8("id,name,email\nu1,Ada,ada@example.com\nu2,Bea,bea@example.com\nu10,Namesake,namesake@example.com\n"),
    "admin_projects.csv": strToU8("id,name\np1,Shared\np2,First only\np3,Second only\np4,Unknown level\np5,Duplicate\np6,Namesake only\np7,Unknown product access\n"),
    "admin_project_users.csv": strToU8("user_id,bim360_project_id,status,access_level\nu1,p1,active,admin\nu2,p1,active,member\nu1,p2,active,member\nu2,p3,active,member\nu1,p4,active,\nu2,p4,active,member\nu1,p5,active,member\nu1,p5,active,admin\nu2,p5,active,member\nu10,p6,active,admin\nu1,p7,active,member\nu2,p7,active,member\n"),
    "admin_project_user_products.csv": strToU8("user_id,bim360_project_id,product_key,access_level\nu1,p1,build,admin\nu2,p1,build,member\nu1,p7,docs,\nu2,p7,docs,member\n"),
  }));
  assert.equal(getPerson("u1").state, "found");
  assert.equal(getPerson("u2").state, "found");
  assert.equal(getPerson("u").state, "missing");
  const result = comparePersonAccess("u1", "u2");
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.shared.map((row) => row.projectId), ["p1", "p4", "p5", "p7"]);
  assert.deepEqual(result.onlyFirst.map((row) => row.projectId), ["p2"]);
  assert.deepEqual(result.onlySecond.map((row) => row.projectId), ["p3"]);
  assert.equal(result.shared[0].result, "different");
  assert.deepEqual(result.shared[0].differences, ["Access level", "Products"]);
  assert.equal(result.shared[1].result, "unknown");
  assert.equal(result.shared[2].result, "unknown");
  assert.equal(result.shared[2].first?.ambiguous, true);
  assert.equal(result.shared[3].result, "unknown");
  assert.equal(result.coverageComplete, true);
  assert.ok(![...result.shared, ...result.onlyFirst, ...result.onlySecond].some((row) => row.projectId === "p6"));

  getDb().prepare("UPDATE dataset_tables SET truncated = 1 WHERE name = 'admin_project_users'").run();
  const truncated = comparePersonAccess("u1", "u2");
  assert.equal(truncated.state, "ready");
  if (truncated.state === "ready") assert.equal(truncated.coverageComplete, false);
  assert.equal(comparePersonAccess("u1", "u1").state, "unavailable");
});
