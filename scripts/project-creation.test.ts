import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { fetchLiveProjectNames, normalizedProjectName } = await import("../src/lib/projectCreation.ts");
const session = {
  id: "session-1", mode: "live" as const, accessToken: "test", refreshToken: null,
  expiresAt: Date.now() + 60_000, scope: null, userId: "u1", userName: "Admin",
  userEmail: "admin@example.com", hubVerifiedAt: Date.now(), hubRole: "hub_admin" as const,
};
const actualFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = actualFetch; });

test("live guard sees a project name added after the local preview", async () => {
  globalThis.fetch = (async () => Response.json({
    results: [{ id: "new-project", name: " North   Tower " }],
    pagination: { totalResults: 1 },
  })) as typeof fetch;
  const names = await fetchLiveProjectNames(session);
  assert.equal(names.has(normalizedProjectName("north tower")), true);
  assert.equal(names.size, 1);
});

test("live guard fails closed on incomplete names, duplicate IDs, and API failure", async () => {
  globalThis.fetch = (async () => Response.json({ results: [{ id: "p1" }] })) as typeof fetch;
  await assert.rejects(() => fetchLiveProjectNames(session), /incomplete or duplicate project list/);

  globalThis.fetch = (async () => Response.json({
    results: [{ id: "p1", name: "One" }, { id: "p1", name: "Two" }],
  })) as typeof fetch;
  await assert.rejects(() => fetchLiveProjectNames(session), /incomplete or duplicate project list/);

  globalThis.fetch = (async () => new Response("denied", { status: 403 })) as typeof fetch;
  await assert.rejects(() => fetchLiveProjectNames(session), /403/);
});

test("live guard checks every APS page and rejects duplicate IDs on a later page", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `p${index}`, name: `Project ${index}` }));
  const offsets: number[] = [];
  globalThis.fetch = (async (request) => {
    const offset = Number(new URL(String(request)).searchParams.get("offset"));
    offsets.push(offset);
    return Response.json({
      results: offset === 0 ? firstPage : [{ id: "p0", name: "Duplicate on next page" }],
      pagination: { totalResults: 101 },
    });
  }) as typeof fetch;
  await assert.rejects(() => fetchLiveProjectNames(session), /incomplete or duplicate project list/);
  assert.deepEqual(offsets, [0, 100]);
});

test("live guard includes names found only on later APS pages", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `p${index}`, name: `Project ${index}` }));
  globalThis.fetch = (async (request) => {
    const offset = Number(new URL(String(request)).searchParams.get("offset"));
    return Response.json({
      results: offset === 0 ? firstPage : [{ id: "p100", name: "New After Preview" }],
      pagination: { totalResults: 101 },
    });
  }) as typeof fetch;
  const names = await fetchLiveProjectNames(session);
  assert.equal(names.size, 101);
  assert.equal(names.has(normalizedProjectName("New After Preview")), true);
});
