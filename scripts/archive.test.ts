/**
 * Archiving runs on app credentials, which bypass the signed-in user's Autodesk
 * permissions, so the admin gate is the only thing enforcing who may do it.
 * These tests pin that gate and the "status only, never delete" contract.
 *
 * Run with: npm run test:archive
 */

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-arch-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { requireAccountAdmin, setProjectStatus, fetchProjectStatus, NotAccountAdminError } =
  await import("../src/lib/aps/hubAdmin.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.__formaTwoLegged = undefined;
});

type Call = { url: string; method: string; body?: string };

/** Serves the 2-legged token, then routes by URL. */
function mockApi(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call = { url, method: init?.method ?? "GET", body: init?.body as string | undefined };
    if (url.includes("/authentication/v2/token")) {
      return new Response(JSON.stringify({ access_token: "app-token", expires_in: 3600 }), {
        status: 200,
      });
    }
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

const session = { mode: "live", userEmail: "admin@example.com" } as Parameters<typeof requireAccountAdmin>[0];

test("admits an account admin", async () => {
  mockApi(() => ({
    status: 200,
    body: [{ email: "admin@example.com", access_level: "account_admin" }],
  }));
  await requireAccountAdmin(session);
});

test("admits the documented account_admin role field", async () => {
  mockApi(() => ({
    status: 200,
    body: [{ email: "admin@example.com", role: "account_admin" }],
  }));
  await requireAccountAdmin(session);
});

test("refuses ambiguous exact admin identities", async () => {
  mockApi(() => ({
    status: 200,
    body: [
      { email: "admin@example.com", role: "account_admin" },
      { email: "ADMIN@example.com", role: "account_admin" },
    ],
  }));
  await assert.rejects(() => requireAccountAdmin(session), NotAccountAdminError);
});

test("refuses a plain project user", async () => {
  mockApi(() => ({
    status: 200,
    body: [{ email: "admin@example.com", access_level: "project_user" }],
  }));
  await assert.rejects(() => requireAccountAdmin(session), NotAccountAdminError);
});

test("refuses when the directory returns somebody else", async () => {
  mockApi(() => ({
    status: 200,
    body: [{ email: "someone.else@example.com", access_level: "account_admin" }],
  }));
  await assert.rejects(() => requireAccountAdmin(session), NotAccountAdminError);
});

test("fails closed when the lookup errors", async () => {
  mockApi(() => ({ status: 500, body: {} }));
  await assert.rejects(() => requireAccountAdmin(session), NotAccountAdminError);
});

test("refuses a session with no email", async () => {
  mockApi(() => ({ status: 200, body: [] }));
  await assert.rejects(
    () => requireAccountAdmin({ ...session, userEmail: null }),
    NotAccountAdminError,
  );
});

test("a former demo session cannot reach the app-only admin lookup", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  await assert.rejects(
    () => requireAccountAdmin({ ...session, mode: "demo" } as unknown as typeof session),
    /live session/,
  );
  assert.equal(calls, 0);
});

test("recovers an admin email when userinfo failed during sign-in", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/userinfo")) return Response.json({ email: "admin@example.com" });
    if (url.includes("/authentication/v2/token")) {
      return Response.json({ access_token: "app-token", expires_in: 3600 });
    }
    return Response.json([{ email: "admin@example.com", access_level: "account_admin" }]);
  }) as typeof fetch;
  await requireAccountAdmin({ ...session, userEmail: null, accessToken: "user-token" });
  assert.ok(calls.some((url) => url.includes("/userinfo")));
  assert.ok(calls.some((url) => url.includes("/users/search")));
});

test("archiving sends only status, and never a DELETE", async () => {
  const calls = mockApi(() => ({ status: 200, body: { status: "archived" } }));
  const result = await setProjectStatus("proj-1", "archived");

  assert.equal(result.status, "archived");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH", "must be a PATCH, never DELETE");
  assert.deepEqual(
    JSON.parse(calls[0].body ?? "{}"),
    { status: "archived" },
    "no field other than status may be sent",
  );
  assert.match(calls[0].url, /\/hq\/v1\/accounts\/[0-9a-f-]+\/projects\/proj-1$/);
});

test("restoring to active uses the same single-field shape", async () => {
  const calls = mockApi(() => ({ status: 200, body: { status: "active" } }));
  await setProjectStatus("proj-1", "active");
  assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), { status: "active" });
});

test("surfaces the API's own error text on failure", async () => {
  mockApi(() => ({ status: 403, body: { detail: "Forbidden for this account" } }));
  await assert.rejects(
    () => setProjectStatus("proj-1", "archived"),
    /403.*Forbidden for this account/,
  );
});

test("reads live status rather than trusting the cache", async () => {
  mockApi(() => ({ status: 200, body: { name: "Riverside", status: "archived" } }));
  assert.deepEqual(await fetchProjectStatus("proj-1"), {
    name: "Riverside",
    status: "archived",
  });
});

test("returns null when a project cannot be read", async () => {
  mockApi(() => ({ status: 404, body: {} }));
  assert.equal(await fetchProjectStatus("missing"), null);
});

test("returns null when a live project status request throws", async () => {
  mockApi(() => { throw new Error("network down"); });
  assert.equal(await fetchProjectStatus("proj-1"), null);
});
