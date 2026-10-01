import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../src/lib/aps/auth.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-offboarding-"));
process.env.DATA_DIR = dir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { getDb, closeDb } = await import("../src/lib/db.ts");
const { inspectOffboarding, normaliseTargetEmail, projectRemovalIds } = await import("../src/lib/offboarding.ts");
const db = getDb();
const realFetch = globalThis.fetch;
const hubId = process.env.FORMA_HUB_ID!;
const session = {
  id: "session-1", mode: "live", accessToken: "signed-in-token", refreshToken: null,
  expiresAt: Date.now() + 60_000, scope: "account:read", userId: "admin-1",
  userName: "Admin", userEmail: "admin@example.com", hubVerifiedAt: Date.now(), hubRole: "hub_admin",
} satisfies Session;

type MockOptions = {
  directory?: unknown;
  directoryStatus?: number;
  projectStatusById?: Record<string, number>;
  projects?: unknown[];
  products?: unknown[];
  roles?: unknown[];
};

function mockAutodesk(options: MockOptions = {}) {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.__formaTwoLegged = undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("Authorization");
    calls.push({ url, authorization });
    if (url.includes("/authentication/v2/token")) {
      return Response.json({ access_token: "app-token", expires_in: 3600 });
    }
    if (url.includes(`/hq/v1/accounts/${hubId}/users/search`)) {
      return Response.json(options.directory ?? [{ id: "hq-1", email: "person@example.com", name: "Person One" }], {
        status: options.directoryStatus ?? 200,
      });
    }
    const match = url.match(/\/construction\/admin\/v1\/accounts\/[^/]+\/users\/([^/?]+)\/(projects|products|roles)/);
    if (match) {
      const userId = decodeURIComponent(match[1]);
      const resource = match[2];
      if (resource === "projects" && options.projectStatusById?.[userId]) {
        return Response.json({ error: "Not found" }, { status: options.projectStatusById[userId] });
      }
      const items = resource === "projects" ? options.projects ?? []
        : resource === "products" ? options.products ?? [] : options.roles ?? [];
      const parsed = new URL(url);
      const offset = Number(parsed.searchParams.get("offset") ?? 0);
      const limit = Number(parsed.searchParams.get("limit") ?? 200);
      return Response.json({ results: items.slice(offset, offset + limit), pagination: { totalResults: items.length } });
    }
    throw new Error(`Unexpected Autodesk request: ${url}`);
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.__formaTwoLegged = undefined;
});
after(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("exact email search rejects fuzzy matches and separates live access from local activity", async () => {
  const calls = mockAutodesk({
    directory: [
      { id: "fuzzy-id", email: "person+other@example.com" },
      { id: "exact-id", email: "PERSON@example.com", name: "Person One", company: "Builder" },
    ],
    projects: [{ id: "11111111-1111-4111-8111-111111111111", name: "Project One" }],
    products: [{ key: "docs", projectIds: ["11111111-1111-4111-8111-111111111111"] }],
    roles: [{ name: "Manager", projectIds: ["11111111-1111-4111-8111-111111111111"] }],
  });
  db.prepare(`INSERT INTO activities
    (job_id, source_file, fingerprint, occurred_ms, project_id, actor_email, raw)
    VALUES ('job', 'activity.csv', ?, ?, 'project-1', ?, '{}')`).run(
    "person-event", Date.parse("2026-09-15T12:00:00Z"), "PERSON@example.com",
  );
  db.prepare(`INSERT INTO activities
    (job_id, source_file, fingerprint, occurred_ms, project_id, actor_email, raw)
    VALUES ('job', 'activity.csv', ?, ?, 'project-1', ?, '{}')`).run(
    "other-event", Date.parse("2026-09-20T12:00:00Z"), "other@example.com",
  );
  const summary = await inspectOffboarding(session, " PERSON@EXAMPLE.COM ");
  assert.equal(summary?.userId, "exact-id");
  assert.equal(summary?.email, "person@example.com");
  assert.equal(summary?.company, "Builder");
  assert.equal(summary?.projects.length, 1);
  assert.equal(summary?.products.length, 1);
  assert.equal(summary?.roles.length, 1);
  assert.equal(summary?.lastObservedActivityAt, Date.parse("2026-09-15T12:00:00Z"));
  assert.equal(summary?.activityDataThrough, Date.parse("2026-09-20T12:00:00Z"));
  const search = calls.find((call) => call.url.includes("/users/search"))!;
  assert.equal(new URL(search.url).searchParams.get("email"), "person@example.com");
  assert.equal(new URL(search.url).searchParams.get("partial"), "false");
  assert.equal(search.authorization, "Bearer app-token");
  assert.ok(calls.filter((call) => call.url.includes("/construction/admin/")).every((call) => call.authorization === "Bearer signed-in-token"));
  assert.ok(calls.some((call) => call.url.includes("/users/exact-id/projects")));
  assert.ok(!calls.some((call) => call.url.includes("/users/fuzzy-id/")));
});

test("duplicate exact hub identities halt inspection before Forma Admin reads", async () => {
  const calls = mockAutodesk({ directory: [
    { id: "one", email: "person@example.com" },
    { id: "two", email: "PERSON@example.com" },
  ] });
  await assert.rejects(inspectOffboarding(session, "person@example.com"), /Multiple hub records match/);
  assert.ok(!calls.some((call) => call.url.includes("/construction/admin/")));
});

test("Forma Admin ID fallback occurs on 404 and carries the successful ID to all reads", async () => {
  const calls = mockAutodesk({
    directory: [{ id: "hq-id", autodeskId: "forma-id", uid: "third-id", email: "person@example.com" }],
    projectStatusById: { "hq-id": 404 },
    projects: [{ id: "22222222-2222-4222-8222-222222222222" }],
  });
  const summary = await inspectOffboarding(session, "person@example.com");
  assert.equal(summary?.userId, "forma-id");
  assert.ok(calls.some((call) => call.url.includes("/users/hq-id/projects")));
  assert.ok(calls.some((call) => call.url.includes("/users/forma-id/projects")));
  assert.ok(calls.some((call) => call.url.includes("/users/forma-id/products")));
  assert.ok(calls.some((call) => call.url.includes("/users/forma-id/roles")));
  assert.ok(!calls.some((call) => call.url.includes("/users/third-id/")));
});

test("a 403 is surfaced without trying an alternate user ID", async () => {
  const calls = mockAutodesk({
    directory: [{ id: "hq-id", autodeskId: "forma-id", email: "person@example.com" }],
    projectStatusById: { "hq-id": 403 },
  });
  await assert.rejects(inspectOffboarding(session, "person@example.com"), /403/);
  assert.ok(!calls.some((call) => call.url.includes("/users/forma-id/")));
});

test("project associations paginate beyond one 200-record page", async () => {
  const projects = Array.from({ length: 201 }, (_, index) => ({ id: `project-${index}` }));
  const calls = mockAutodesk({ projects });
  const summary = await inspectOffboarding(session, "person@example.com");
  assert.equal(summary?.projects.length, 201);
  const pages = calls.filter((call) => call.url.includes("/users/hq-1/projects"));
  assert.equal(pages.length, 2);
  assert.equal(new URL(pages[1].url).searchParams.get("offset"), "200");
});

test("unmatched, unreadable, or ID-less directory entries cannot start a removal plan", async () => {
  mockAutodesk({ directory: [{ id: "other", email: "person+other@example.com" }] });
  assert.equal(await inspectOffboarding(session, "person@example.com"), null);
  mockAutodesk({ directory: { malformed: true } });
  await assert.rejects(inspectOffboarding(session, "person@example.com"), /unreadable hub directory/);
  mockAutodesk({ directory: [{ email: "person@example.com" }] });
  await assert.rejects(inspectOffboarding(session, "person@example.com"), /without an ID/);
});

test("removal candidates are deduplicated and limited to project-shaped IDs", () => {
  const one = "11111111-1111-4111-8111-111111111111";
  const two = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(projectRemovalIds([
    { id: one }, { id: one }, { id: "not-a-project" }, { id: "------------------------------------" }, { id: two },
  ]), [one, two]);
  assert.equal(normaliseTargetEmail(" Person@Example.com "), "person@example.com");
  assert.throws(() => normaliseTargetEmail("person@example.com,other@example.com"), /one valid email/);
});
