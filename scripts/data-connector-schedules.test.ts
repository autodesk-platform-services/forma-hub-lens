import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-schedules-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { createRecurringDataRequest, listRequests, rememberRequests, storedRequests, rememberJobs, storedJobs } =
  await import("../src/lib/aps/dataConnector.ts");
const { closeDb } = await import("../src/lib/db.ts");
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

const session = {
  id: "session", mode: "live" as const, accessToken: "token", refreshToken: null, expiresAt: Date.now() + 100_000,
  scope: "data:read data:create", userId: "user", userName: "Admin", userEmail: "admin@example.test",
  hubVerifiedAt: Date.now(), hubRole: "hub_admin" as const,
};

test("recurring request sends official schedule fields and stores its definition", async () => {
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "schedule-1", scheduleInterval: "DAY", isActive: true });
  }) as typeof fetch;
  const input = {
    description: "Daily activity",
    serviceGroups: ["activities", "admin"],
    scheduleInterval: "DAY" as const,
    effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
    effectiveTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    dateRange: "YESTERDAY" as const,
    projectStatus: "active" as const,
  };
  const response = await createRecurringDataRequest(session, input);
  assert.equal(response.id, "schedule-1");
  assert.deepEqual(bodies[0], {
    description: "Daily activity", isActive: true, scheduleInterval: "DAY",
    reoccuringInterval: 1, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
    serviceGroups: ["activities", "admin"], sendEmail: false, dateRange: "YESTERDAY",
    projectStatus: "active",
  });
  rememberRequests([{ ...input, ...response }], 1234);
  assert.equal(storedRequests()[0].lastSeenAt, 1234);
  assert.equal(storedRequests()[0].scheduleInterval, "DAY");
  rememberJobs([{ id: "job-1", requestId: "schedule-1", status: "complete", completionStatus: "success" }]);
  assert.equal(storedJobs()[0].serviceGroups, "activities,admin");
});

test("invalid recurrence or fixed activity window is rejected before an APS write", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ id: "unexpected" });
  }) as typeof fetch;
  const input = {
    description: "Bad request", serviceGroups: ["activities"],
    scheduleInterval: "DAY" as const,
    effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
    effectiveTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    dateRange: "YESTERDAY" as const,
    projectStatus: "active" as const,
  };
  await assert.rejects(
    () => createRecurringDataRequest(session, { ...input, effectiveFrom: new Date(Date.now() - 1000).toISOString() }),
    /future/,
  );
  await assert.rejects(
    () => createRecurringDataRequest(session, { ...input, dateRange: "CUSTOM" as never }),
    /relative/,
  );
  assert.equal(calls, 0);
});

test("recurring requests can scope extraction to selected projects", async () => {
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ id: "scoped-schedule" });
  }) as typeof fetch;
  const projectId = "11111111-1111-4111-8111-111111111111";
  await createRecurringDataRequest(session, {
    description: "Scoped activity", serviceGroups: ["activities"],
    scheduleInterval: "DAY", effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
    effectiveTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    dateRange: "YESTERDAY", projectStatus: "active", projectIdList: [projectId],
  });
  assert.deepEqual((body as Record<string, unknown> | null)?.projectIdList, [projectId]);
});

test("a complete APS refresh marks missing cached schedules as unverified", async () => {
  rememberRequests([{ id: "schedule-old", scheduleInterval: "DAY", isActive: true }], 2000);
  rememberRequests([{ id: "schedule-new", scheduleInterval: "WEEK", isActive: true }], 3000, true);
  const requests = storedRequests();
  assert.equal(requests.find((request) => request.id === "schedule-old")?.seenInLastRefresh, false);
  assert.equal(requests.find((request) => request.id === "schedule-new")?.seenInLastRefresh, true);
});

test("APS request listing reads past ten pages before it can reconcile the cache", async () => {
  const items = Array.from({ length: 501 }, (_, index) => ({ id: `schedule-${index}` }));
  let pages = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    pages++;
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    return Response.json({ results: items.slice(offset, offset + limit), pagination: { totalResults: items.length } });
  }) as typeof fetch;
  const listed = await listRequests(session);
  assert.equal(listed.length, 501);
  assert.equal(pages, 11);
});
