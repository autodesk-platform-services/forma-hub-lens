/**
 * The hub-membership gate is the one thing standing between a shared
 * deployment and anyone with an Autodesk account, so it gets its own tests.
 *
 * Run with: npm run test:auth
 */

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-auth-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { verifyHubAccess } = await import("../src/lib/aps/authorization.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockHubs(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

test("admits an account whose hub list contains this hub", async () => {
  mockHubs({
    data: [
      { id: "b.99999999-0000-0000-0000-000000000000", attributes: { name: "Other Hub" } },
      { id: "b.aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", attributes: { name: "Our Hub" } },
    ],
  });
  const result = await verifyHubAccess("token");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.hubName, "Our Hub");
});

test("accepts the id with or without the Data Management 'b.' prefix", async () => {
  mockHubs({ data: [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", attributes: {} }] });
  assert.equal((await verifyHubAccess("token")).ok, true);
});

test("is case-insensitive on the hub id", async () => {
  mockHubs({ data: [{ id: "B.AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", attributes: {} }] });
  assert.equal((await verifyHubAccess("token")).ok, true);
});

test("refuses a valid Autodesk account that is in other hubs only", async () => {
  mockHubs({
    data: [{ id: "b.11111111-2222-3333-4444-555555555555", attributes: { name: "Someone Else" } }],
  });
  const result = await verifyHubAccess("token");
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /not a member of this hub/i);
});

test("refuses an account with no hubs at all", async () => {
  mockHubs({ data: [] });
  assert.equal((await verifyHubAccess("token")).ok, false);
});

test("refuses when Autodesk rejects the token", async () => {
  mockHubs({ error: "unauthorized" }, 401);
  const result = await verifyHubAccess("token");
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /rejected the access token/i);
});

test("fails closed when Autodesk is unreachable", async () => {
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const result = await verifyHubAccess("token");
  assert.equal(result.ok, false, "a network failure must never be treated as authorised");
});

test("fails closed on a 5xx from Autodesk", async () => {
  mockHubs({}, 503);
  assert.equal((await verifyHubAccess("token")).ok, false);
});

test("fails closed on an unreadable response body", async () => {
  globalThis.fetch = (async () =>
    new Response("<html>not json</html>", { status: 200 })) as typeof fetch;
  assert.equal((await verifyHubAccess("token")).ok, false);
});

test("does not match on a hub id that merely contains ours as a substring", async () => {
  mockHubs({ data: [{ id: "b.aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-extra", attributes: {} }] });
  assert.equal((await verifyHubAccess("token")).ok, false);
});
