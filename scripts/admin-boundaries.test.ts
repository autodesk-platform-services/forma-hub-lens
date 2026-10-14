/** Run actual administrative entry points against real session/role gates. */
import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-admin-boundaries-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "review-test";
process.env.APS_CLIENT_SECRET = "review-test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
process.env.LENS_MODE = "live";
delete process.env.FORMA_REGION;

const context = globalThis as typeof globalThis & {
  __reviewCookieJar?: Map<string, { value: string }>;
  __reviewRevalidatedPaths?: string[];
};
const { closeDb, getDb } = await import("../src/lib/db.ts");
const { HubAdminRequiredError, UnauthorizedError } = await import("../src/lib/aps/auth.ts");
const actions = await import("../src/app/actions.ts");
const { ingestReportingExtract } = await import("../src/app/extracts/reportingActions.ts");
const { acknowledgeCurrentSchema } = await import("../src/app/data-health/actions.ts");
const { GET: downloadPackage } = await import("../src/app/closeout/packages/[id]/download/route.ts");
const { GET: exportAudit } = await import("../src/app/manage/audit/[id]/export/route.ts");
const { default: auditIndex } = await import("../src/app/manage/audit/page.tsx");
const { default: auditDetail } = await import("../src/app/manage/audit/[id]/page.tsx");
const { default: extractsPage } = await import("../src/app/extracts/page.tsx");
const { default: dataHealthPage } = await import("../src/app/data-health/page.tsx");
const { default: packagePage } = await import("../src/app/closeout/packages/[id]/page.tsx");
const { getDataHealth } = await import("../src/lib/dataHealth.ts");
const { saveCloseoutAssessment, saveCloseoutPackage } = await import("../src/lib/closeoutStore.ts");
const { readSession } = await import("../src/lib/aps/auth.ts");
const { saveAdminPlan, claimAdminPlan } = await import("../src/lib/adminOperations.ts");

const db = getDb();
const originalPrepare = db.prepare.bind(db);
const sql: string[] = [];
let failOperationRead = false;
db.prepare = ((query: string) => {
  sql.push(query);
  if (failOperationRead && /SELECT.*FROM admin_operations/.test(query)) {
    throw new Error("Audit storage unavailable");
  }
  return originalPrepare(query);
}) as typeof db.prepare;
const realFetch = globalThis.fetch;
let liveRole: "account_admin" | "executive" = "executive";
let directoryRequests = 0;
let businessRequests = 0;
const id = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const request = new Request("http://localhost/test");
const routeParams = { params: Promise.resolve({ id }) };

function signIn(cachedRole: "hub_admin" | "executive") {
  originalPrepare("DELETE FROM sessions").run();
  originalPrepare(`INSERT INTO sessions
    (id, access_token, expires_at, user_id, user_email, created_at, hub_verified_at, hub_role, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live')`).run(
      "review-session", "user-token", Date.now() + 3600_000, "review-user",
      "review@example.com", Date.now(), Date.now(), cachedRole,
    );
  context.__reviewCookieJar = new Map([["forma_session", { value: "review-session" }]]);
}

function sensitiveQueries(): string[] {
  return sql.filter((query) => /\b(?:extract_jobs|data_connector_requests|data_health_schema_baseline|admin_operations|admin_operation_items|closeout_packages)\b/i.test(query));
}

function propsInTree(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(propsInTree);
  if (!value || typeof value !== "object") return [];
  const element = value as { props?: Record<string, unknown> };
  if (!element.props) return [];
  return [element.props, ...Object.values(element.props).flatMap(propsInTree)];
}

function form(): FormData {
  const data = new FormData();
  data.set("jobId", "review-job");
  data.set("description", "Review extraction");
  data.set("serviceGroups", "activities");
  data.set("dateRange", "PAST_7_DAYS");
  data.set("projectStatus", "all");
  data.set("scheduleInterval", "DAY");
  data.set("effectiveFromUtc", new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  data.set("effectiveToUtc", new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  return data;
}

beforeEach(() => {
  sql.length = 0;
  directoryRequests = businessRequests = 0;
  liveRole = "executive";
  failOperationRead = false;
  context.__reviewCookieJar = new Map();
  context.__reviewRevalidatedPaths = [];
  globalThis.__formaTwoLegged = undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/authentication/v2/token")) {
      return Response.json({ access_token: "app-token", expires_in: 3600 });
    }
    if (url.endsWith("/userinfo")) return Response.json({ email: "review@example.com" });
    if (url.includes("/users/search")) {
      directoryRequests++;
      return Response.json([{ email: "review@example.com", access_level: liveRole }]);
    }
    businessRequests++;
    if (url.includes("/data-connector/") && url.includes("/jobs/review-job")) {
      return Response.json({ id: "review-job", status: "running" });
    }
    if (url.includes("/data-connector/") && init?.method === "POST") {
      return Response.json({ id: "review-request" });
    }
    if (url.includes("/data-connector/")) return Response.json({ results: [] });
    throw new Error(`Unexpected APS business call: ${url}`);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  delete context.__reviewCookieJar;
  delete context.__reviewRevalidatedPaths;
  globalThis.__formaTwoLegged = undefined;
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

const extractActions = {
  refreshJobs: actions.refreshJobs,
  requestExtract: actions.requestExtract,
  refreshSchedules: actions.refreshSchedules,
  requestRecurringExtract: actions.requestRecurringExtract,
  ingestExtract: actions.ingestExtract,
  ingestReportingExtract,
};

for (const cachedRole of ["executive", "hub_admin"] as const) {
  for (const [name, action] of Object.entries(extractActions)) {
    test(`${name} denies ${cachedRole === "hub_admin" ? "a cached Hub Admin demoted to Executive Overview" : "Executive Overview"} before APS work`, async () => {
      signIn(cachedRole);
      const result = await action(null, form());
      assert.equal(result?.ok, false);
      assert.match(result?.message ?? "", /requires Hub Admin/);
      assert.equal(directoryRequests, 1, "must verify the current live role despite a fresh cached role");
      assert.equal(businessRequests, 0);
      assert.deepEqual(sensitiveQueries(), []);
      assert.deepEqual(context.__reviewRevalidatedPaths, []);
    });
  }
  test(`schema acknowledge denies cached ${cachedRole} with live Executive Overview before changing baseline`, async () => {
    signIn(cachedRole);
    await assert.rejects(acknowledgeCurrentSchema, HubAdminRequiredError);
    assert.equal(directoryRequests, 1);
    assert.deepEqual(sensitiveQueries(), []);
  });
  test(`package download denies cached ${cachedRole} with live Executive Overview before package lookup`, async () => {
    signIn(cachedRole);
    const response = await downloadPackage(request, routeParams);
    assert.equal(response.status, 403);
    assert.equal(directoryRequests, 1);
    assert.deepEqual(sensitiveQueries(), []);
  });
  test(`audit export denies cached ${cachedRole} with live Executive Overview before operation lookup`, async () => {
    signIn(cachedRole);
    const response = await exportAudit(request, routeParams);
    assert.equal(response.status, 403);
    assert.equal(directoryRequests, 1);
    assert.deepEqual(sensitiveQueries(), []);
  });
  for (const [name, page] of [["index", () => auditIndex()], ["detail", () => auditDetail({
    params: Promise.resolve({ id }), searchParams: Promise.resolve({}),
  })]] as const) {
    test(`audit ${name} page denies cached ${cachedRole} with live Executive Overview without revealing records`, async () => {
      signIn(cachedRole);
      const output = await page();
      assert.ok(propsInTree(output).some((props) => props.title === "Hub Admin access is required to view the administrative audit."));
      assert.equal(directoryRequests, 1);
      assert.deepEqual(sensitiveQueries(), []);
    });
  }
}

test("download and audit export return 401 for a missing session before record lookup", async () => {
  assert.equal((await downloadPackage(request, routeParams)).status, 401);
  assert.equal((await exportAudit(request, routeParams)).status, 401);
  assert.deepEqual(sensitiveQueries(), []);
  assert.equal(businessRequests, 0);
});

test("fresh Hub Admin may refresh jobs, refresh schedules, and create both extract request types", async () => {
  signIn("hub_admin");
  liveRole = "account_admin";
  for (const action of [actions.refreshJobs, actions.refreshSchedules, actions.requestExtract, actions.requestRecurringExtract]) {
    const result = await action(null, form());
    assert.equal(result?.ok, true, result?.message);
  }
  assert.equal(directoryRequests, 4);
  assert.ok(businessRequests >= 4);
});

test("fresh Hub Admin may inspect an ingest job; incomplete job remains a business failure", async () => {
  signIn("hub_admin");
  liveRole = "account_admin";
  const result = await actions.ingestExtract(null, form());
  assert.equal(result?.ok, false);
  assert.match(result?.message ?? "", /not complete yet/);
  assert.equal(businessRequests, 1);
  assert.equal(directoryRequests, 1);
});

test("fresh Hub Admin may enter reporting ingest validation", async () => {
  signIn("hub_admin");
  liveRole = "account_admin";
  const result = await ingestReportingExtract(null, form());
  assert.equal(result?.ok, false);
  assert.doesNotMatch(result?.message ?? "", /Hub Admin/);
  assert.ok(businessRequests > 0);
  assert.equal(directoryRequests, 1);
});

test("fresh Hub Admin may acknowledge the shared schema baseline", async () => {
  signIn("hub_admin");
  liveRole = "account_admin";
  await acknowledgeCurrentSchema();
  assert.equal(directoryRequests, 1);
  assert.ok(sensitiveQueries().some((query) => /UPDATE data_health_schema_baseline/.test(query)));
  assert.ok(context.__reviewRevalidatedPaths?.includes("/data-health"));
});

test("fresh Hub Admin passes package and audit authorization to normal missing-record responses", async () => {
  signIn("hub_admin");
  liveRole = "account_admin";
  assert.equal((await downloadPackage(request, routeParams)).status, 404);
  assert.equal((await exportAudit(request, routeParams)).status, 404);
  assert.equal(directoryRequests, 2);
  assert.ok(sensitiveQueries().some((query) => /SELECT.*closeout_packages/.test(query)));
  assert.ok(sensitiveQueries().some((query) => /SELECT.*admin_operations/.test(query)));
});

test("fresh Hub Admin can view and export a real local audit operation", async () => {
  signIn("hub_admin");
  liveRole = "account_admin";
  const session = readSession("review-session")!;
  const preview = saveAdminPlan(session, { kind: "create_projects", targets: [], skips: [] }, "Private review operation", []);
  const { operationId } = claimAdminPlan(session, preview.id, "create_projects");
  const index = await auditIndex();
  assert.ok(propsInTree(index).some((props) => props.href === `/manage/audit/${operationId}`));
  const detail = await auditDetail({ params: Promise.resolve({ id: operationId }), searchParams: Promise.resolve({}) });
  assert.ok(propsInTree(detail).some((props) => props.href === `/manage/audit/${operationId}/export`));
  const response = await exportAudit(request, { params: Promise.resolve({ id: operationId }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.equal(directoryRequests, 3);
});

test("authorized audit pages propagate storage errors rather than masking them as permission failures", async () => {
  signIn("hub_admin");
  liveRole = "account_admin";
  failOperationRead = true;
  await assert.rejects(auditIndex, /Audit storage unavailable/);
  await assert.rejects(() => auditDetail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }), /Audit storage unavailable/);
  await assert.rejects(() => exportAudit(request, routeParams), /Audit storage unavailable/);
});

test("verified package bytes are downloadable only after a fresh Hub Admin check", async () => {
  signIn("hub_admin");
  liveRole = "account_admin";
  originalPrepare("INSERT OR REPLACE INTO projects (id, name, raw, synced_at) VALUES (?, ?, ?, ?)")
    .run(id, "Review project", "{}", Date.now());
  const bytes = zipSync({ "approved-index.txt": strToU8("review fixture") });
  const fileName = `${id}.zip`;
  fs.mkdirSync(path.join(workdir, "closeout-packages"), { recursive: true });
  fs.writeFileSync(path.join(workdir, "closeout-packages", fileName), bytes);
  const assessment = saveCloseoutAssessment({ projectId: id, profileId: "review-profile", status: "ready", result: "{}", actor: "review-user" });
  const record = saveCloseoutPackage({ projectId: id, profileId: "review-profile", assessmentId: assessment.id,
    status: "ready", manifest: JSON.stringify({ assessment: { status: "ready", sources: [] },
      files: [], exceptions: [], exceptionOverflow: 0, statement: "Synthetic test fixture" }),
    sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length,
    fileName, actor: "review-user" });
  const params = { params: Promise.resolve({ id: record.id }) };
  const response = await downloadPackage(request, params);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/zip");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(directoryRequests, 1);
  signIn("executive");
  liveRole = "executive";
  const output = await packagePage({ ...params, searchParams: Promise.resolve({}) });
  assert.equal(propsInTree(output).filter((props) => String(props.href ?? "").endsWith("/download")).length, 0);
  assert.equal((await downloadPackage(request, params)).status, 403);
});

test("Executive Overview retains cached extract/data-health reads without administrative controls", async () => {
  signIn("executive");
  const output = await extractsPage();
  const props = propsInTree(output);
  assert.ok(props.some((item) => item.title === "Jobs"));
  assert.ok(props.some((item) => item.title === "Read-only extract history"));
  assert.equal(props.filter((item) => typeof item.action === "function").length, 0);
  // Make a local registry change so the acknowledgement control would otherwise appear.
  getDataHealth();
  originalPrepare(`INSERT OR REPLACE INTO dataset_tables
    (name, sql_name, row_count, columns, uploaded_at) VALUES (?, ?, ?, ?, ?)`).run(
      "review_fixture", "review_fixture", 0, JSON.stringify([{ name: "id", type: "TEXT" }]), Date.now(),
    );
  const health = await dataHealthPage();
  const healthProps = propsInTree(health);
  assert.ok(healthProps.some((item) => item.title === "Schema changes"));
  assert.equal(healthProps.filter((item) => item.action === acknowledgeCurrentSchema).length, 0);
  assert.equal(businessRequests, 0);
});

test("missing session is an authorization failure for the schema action", async () => {
  await assert.rejects(acknowledgeCurrentSchema, UnauthorizedError);
  assert.deepEqual(sensitiveQueries(), []);
});
