import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-entities-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { ingestZip } = await import("../src/lib/dataset.ts");
const { closeDb, getDb } = await import("../src/lib/db.ts");
const { companyActivity, companySnapshot, localCompany, permissionSubjectIdentities, resolveCompanyNames, resolveUserIdentities } = await import("../src/lib/entityProfiles.ts");

after(() => {
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("company profile joins only exact company and user IDs", async () => {
  await ingestZip("entities.zip", zipSync({
    "admin_users.csv": strToU8("id,autodesk_id,name,email,default_company_id\nu1,a1,Ada,ada@example.com,c1\nu2,a2,Bob,bob@example.com,c1\nu3,a3,Cara,cara@example.com,c2\n"),
    "admin_project_users.csv": strToU8("user_id,bim360_project_id\nu1,p1\nu1,p1\nu2,p2\nu3,p3\n"),
    "admin_companies.csv": strToU8("id,name,trade,city\nc1,Turner,General Contractor,New York\nc2,Other,,\nc3,Local only,Architect,Boston\n"),
    "admin_project_roles.csv": strToU8("id,name\nr1,Project Admin\n"),
  }));
  const company = companySnapshot("c1");
  assert.equal(company.available, true);
  assert.equal(company.userCount, 2);
  assert.equal(company.projectCount, 2);
  assert.deepEqual(company.projects.map((row) => [row.id, row.people]), [["p1", 1], ["p2", 1]]);
  assert.equal(companySnapshot("c2").projectCount, 1);
  assert.equal(companySnapshot("c-not-found").userCount, 0);
  assert.equal(companySnapshot("c3").userCount, 0);
  const uploadedOnly = localCompany("c3");
  assert.equal(uploadedOnly.state, "found", "an uploaded-only company must remain addressable");
  assert.deepEqual(uploadedOnly.state === "found" ? { name: uploadedOnly.company.name, city: uploadedOnly.company.city } : null,
    { name: "Local only", city: "Boston" });
  assert.equal(localCompany("unknown").state, "missing");
  assert.deepEqual([...resolveCompanyNames(["c1", "c2", "unknown", "c1"])], [["c1", "Turner"], ["c2", "Other"]]);
  const insert = getDb().prepare(`INSERT INTO activities
    (job_id, source_file, fingerprint, occurred_ms, project_id, actor_id, actor_email, raw)
    VALUES ('job', 'activities.csv', ?, ?, ?, ?, ?, '{}')`);
  insert.run("company-1", 1000, "p1", "a1", "ada@example.com");
  insert.run("company-2", 2000, "p2", null, "bob@example.com");
  insert.run("other", 3000, "p3", "a3", "cara@example.com");
  assert.deepEqual({ events: companyActivity("c1").events, projects: companyActivity("c1").projectCount, last: companyActivity("c1").lastObservedAt },
    { events: 2, projects: 2, last: 2000 });
  assert.equal(companyActivity("c1").activityDataThrough, 3000);
  await ingestZip("overlapping-email.zip", zipSync({
    "admin_users.csv": strToU8("id,autodesk_id,name,email,default_company_id\nu1,a1,Ada,ada@example.com,c1\nu2,a2,Bob,bob@example.com,c1\nu3,a3,Cara,cara@example.com,c2\nu4,a4,Second Bob,bob@example.com,c2\n"),
  }));
  assert.equal(companyActivity("c1").events, 1, "cross-company email collision must not attribute activity");
  await ingestZip("ambiguous-company.zip", zipSync({
    "admin_companies.csv": strToU8("id,name\nc1,Turner\nc3,Local only\nc3,Another label\n"),
  }));
  assert.equal(localCompany("c3").state, "ambiguous", "duplicate company IDs must not get an arbitrary name");
  assert.equal(resolveCompanyNames(["c3"]).has("c3"), false, "batch labels must reject duplicate IDs too");
});

test("permission labels preserve raw ID fallback and link to the source user ID", async () => {
  const identities = resolveUserIdentities(["a1", "u2", "unknown"]);
  assert.deepEqual(identities.get("a1"), { name: "Ada", sourceId: "u1", email: "ada@example.com" });
  assert.deepEqual(identities.get("u2"), { name: "Bob", sourceId: "u2", email: "bob@example.com" });
  assert.equal(identities.has("unknown"), false);
  const entries = [
    { subjectType: "user", subjectId: "a1" },
    { subjectType: "company", subjectId: "c1" },
    { subjectType: "role", subjectId: "r1" },
    { subjectType: "user", subjectId: "unknown" },
  ].map((row) => ({ ...row, actions: [], inherited: null, comparable: true, parseIssue: null, raw: {} }));
  const labels = permissionSubjectIdentities(entries);
  assert.deepEqual(labels.get("user:a1"), { name: "Ada", href: "/people/u1", detail: "ada@example.com" });
  assert.deepEqual(labels.get("company:c1"), { name: "Turner", href: "/companies/c1" });
  assert.deepEqual(labels.get("role:r1"), { name: "Project Admin", href: null });
  assert.equal(labels.has("user:unknown"), false);

  await ingestZip("ambiguous-users.zip", zipSync({
    "admin_users.csv": strToU8("id,autodesk_id,name,email,default_company_id\nu1,a1,Ada,ada@example.com,c1\nu1,a1,Other,other@example.com,c1\n"),
  }));
  assert.equal(resolveUserIdentities(["a1"]).has("a1"), false);
});
