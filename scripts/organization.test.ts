import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forma-organization-"));
process.env.DATA_DIR = directory;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
process.env.FORMA_REGION = "EMEA";

const { planCompanyChange, companyHasChangedSincePreview, companyMatchesPlannedValues } =
  await import("../src/lib/organizationModel.ts");
const { readRoleDirectory, readRoleAssignments, assignableRoleIds } = await import("../src/lib/organization.ts");
const { getDb, closeDb } = await import("../src/lib/db.ts");
const { createPartnerCompany, patchPartnerCompany, getCompanyForEdit } = await import("../src/lib/aps/organization.ts");

after(() => {
  closeDb();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("company plans reject duplicate names and preserve immutable before/after values", () => {
  const companies = [
    { id: "c1", name: "Apex", trade: "Architecture", websiteUrl: "https://apex.example" },
    { id: "c2", name: "BuildCo", trade: "Construction Management" },
  ];
  assert.throws(() => planCompanyChange("create", { name: " apex ", trade: "Architecture" }, companies), /already exists/);
  assert.throws(() => planCompanyChange("create", { name: "New", trade: "Not a real trade" }, companies), /trade/);
  const planned = planCompanyChange("update", {
    name: "Apex Group", trade: "Architecture", websiteUrl: "",
  }, companies, "c1");
  assert.deepEqual(planned.changedFields, ["name"]);
  assert.equal(planned.values.websiteUrl, "https://apex.example");
  assert.equal(companyHasChangedSincePreview(planned, { name: "Apex", trade: "Architecture" }), false);
  assert.equal(companyHasChangedSincePreview(planned, { name: "Apex Else", trade: "Architecture" }), true);
  assert.equal(companyMatchesPlannedValues(planned, { name: "Apex Group", trade: "Architecture" }), true);
});

function registerTable(name: string, columns: string[], rows: Array<Record<string, string>>, truncated = false) {
  const db = getDb();
  const sqlName = `ds_${name}`;
  db.exec(`CREATE TABLE "${sqlName}" (${columns.map((column) => `"${column}" TEXT`).join(",")})`);
  const insert = db.prepare(`INSERT INTO "${sqlName}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  for (const row of rows) insert.run(...columns.map((column) => row[column] ?? null));
  db.prepare("INSERT INTO dataset_tables (name,sql_name,columns,row_count,truncated,uploaded_at) VALUES (?,?,?,?,?,?)")
    .run(name, sqlName, JSON.stringify(columns.map((column) => ({ name: column, sqlName: column }))), rows.length, truncated ? 1 : 0, Date.now());
}

test("role directory uses exact IDs and preserves unknown count when assignments are incomplete", () => {
  registerTable("admin_project_roles", ["role_id", "name", "status", "bim360_project_id"], [
    { role_id: "r1", name: "Project Manager", status: "active", bim360_project_id: "p1" },
    { role_id: "r1", name: "Project Manager", status: "active", bim360_project_id: "p2" },
    { role_id: "r2", name: "Old Role", status: "inactive", bim360_project_id: "p1" },
  ]);
  registerTable("admin_project_user_roles", ["role_id", "user_id", "project_id"], [
    { role_id: "r1", user_id: "u1", project_id: "p1" },
  ], true);
  let roles = readRoleDirectory();
  assert.equal(roles.roles.find((role) => role.id === "r1")?.userCount, null);
  assert.deepEqual(assignableRoleIds(roles, ["p1"]), []); // unverified upload is read-only
  assert.equal(readRoleAssignments("r1").total, null);
  assert.equal(readRoleAssignments("r1").partial, true);
  assert.equal(readRoleAssignments("r1").users.length, 1);

  const db = getDb();
  db.prepare("UPDATE dataset_tables SET truncated = 0 WHERE name = 'admin_project_user_roles'").run();
  roles = readRoleDirectory();
  assert.equal(roles.roles.find((role) => role.id === "r1")?.userCount, 1);
  assert.equal(readRoleAssignments("r1").total, 1);
  assert.equal(roles.roles.find((role) => role.id === "r2")?.status, "inactive");

  db.exec(`CREATE TABLE IF NOT EXISTS dataset_table_sources (
    table_name TEXT PRIMARY KEY, upload_id TEXT NOT NULL, hub_id TEXT NOT NULL,
    job_id TEXT NOT NULL, request_id TEXT NOT NULL, project_scope TEXT NOT NULL,
    service_groups TEXT NOT NULL, job_completed_at TEXT, source_file TEXT NOT NULL,
    source_bytes INTEGER NOT NULL, row_count INTEGER NOT NULL, truncated INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL)`);
  db.prepare(`INSERT INTO dataset_table_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "admin_project_roles", "upload1", process.env.FORMA_HUB_ID ?? "", "job1", "request1",
    JSON.stringify({ kind: "all_projects", projectIds: [], projectStatus: "all" }),
    JSON.stringify(["admin"]), null, "admin_project_roles.csv", 100, 3, 0, Date.now(),
  );
  roles = readRoleDirectory();
  assert.deepEqual(assignableRoleIds(roles, ["p1", "p2"]), ["r1"]);
  assert.deepEqual(assignableRoleIds(roles, ["p2", "p3"]), []);
});

test("company adapter uses regional HQ API and snake-case payload without retrying writes", async () => {
  const session = {
    id: "s1", mode: "live" as const, accessToken: "signed-in-token", refreshToken: null, expiresAt: Date.now() + 60_000,
    scope: "account:read account:write", userId: "admin", userName: "Admin", userEmail: "admin@example.com",
    hubVerifiedAt: Date.now(), hubRole: "hub_admin" as const,
  };
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
    const body = method === "POST" ? { id: "c3", name: "New Co", trade: "Architecture" }
      : { id: "c3", name: "New Co", trade: "Architecture", website_url: "https://new.example", erp_id: "ERP-3" };
    return new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const id = await createPartnerCompany(session, { name: "New Co", trade: "Architecture",
      websiteUrl: "https://new.example", erpId: "ERP-3" });
    assert.equal(id, "c3");
    await patchPartnerCompany(session, "c3", { name: "New Co" });
    const readback = await getCompanyForEdit(session, "c3");
    assert.equal(readback.websiteUrl, "https://new.example");
    assert.equal(requests.length, 3);
    assert.ok(requests.every((request) => request.url.startsWith("https://developer.api.autodesk.com/hq/v1/accounts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/companies")));
    assert.ok(requests.every((request) => request.headers.get("Region") === "EMEA"));
    assert.ok(requests.every((request) => request.headers.get("Authorization") === "Bearer signed-in-token"));
    assert.deepEqual(requests[0]?.body, { name: "New Co", trade: "Architecture", website_url: "https://new.example", erp_id: "ERP-3" });
    assert.deepEqual(requests[1]?.body, { name: "New Co" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response("error", { status: 500 }); };
  try {
    await assert.rejects(() => patchPartnerCompany(session, "c3", { name: "New Co" }), /500/);
    assert.equal(attempts, 1, "a failed PATCH must never be retried automatically");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
