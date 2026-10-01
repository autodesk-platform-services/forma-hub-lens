/** The hub-role gate protects cached portfolio data from ordinary hub members. */

import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
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
const { exchangeCode, HubAccessError } = await import("../src/lib/aps/auth.ts");
const { closeDb, getDb } = await import("../src/lib/db.ts");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.__formaTwoLegged = undefined;
});
after(() => {
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

function mockAutodesk(options: {
  profileEmail?: string;
  profileStatus?: number;
  directory?: unknown;
  directoryStatus?: number;
} = {}) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/authentication/v2/token")) {
      return Response.json({ access_token: "app-token", expires_in: 3600 });
    }
    if (url.endsWith("/userinfo")) {
      return Response.json({ email: options.profileEmail ?? "admin@example.com" }, {
        status: options.profileStatus ?? 200,
      });
    }
    if (url.includes("/users/search")) {
      return Response.json(options.directory ?? [
        { email: "admin@example.com", access_level: "account_admin" },
      ], { status: options.directoryStatus ?? 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  return urls;
}

test("admits a Hub Admin after matching 3LO identity to an exact account member", async () => {
  const urls = mockAutodesk();
  const result = await verifyHubAccess("user-token", "admin@example.com");
  assert.deepEqual(result, { ok: true, role: "hub_admin" });
  assert.ok(urls.some((url) => url.includes("/accounts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/users/search")));
  assert.ok(urls.some((url) => url.includes("email=admin%40example.com")));
});

test("admits Executive Overview without depending on project-oriented hub membership", async () => {
  mockAutodesk({ directory: [{ email: "admin@example.com", access_level: "executive" }] });
  assert.deepEqual(await verifyHubAccess("user-token", "admin@example.com"), { ok: true, role: "executive" });
});

test("rejects ordinary members, fuzzy matches, and duplicate identities", async () => {
  mockAutodesk({ directory: [{ email: "admin@example.com", access_level: "project_user" }] });
  assert.equal((await verifyHubAccess("user-token", "admin@example.com")).ok, false);
  mockAutodesk({ directory: [{ email: "other@example.com", access_level: "account_admin" }] });
  assert.equal((await verifyHubAccess("user-token", "admin@example.com")).ok, false);
  mockAutodesk({ directory: [
    { email: "admin@example.com", access_level: "account_admin" },
    { email: "ADMIN@example.com", access_level: "executive" },
  ] });
  assert.equal((await verifyHubAccess("user-token", "admin@example.com")).ok, false);
});

test("rejects a changed or unverified 3LO identity", async () => {
  mockAutodesk({ profileEmail: "other@example.com" });
  assert.equal((await verifyHubAccess("user-token", "admin@example.com")).ok, false);
  mockAutodesk({ profileStatus: 401 });
  assert.equal((await verifyHubAccess("user-token", "admin@example.com")).ok, false);
  mockAutodesk();
  assert.equal((await verifyHubAccess("user-token", null)).ok, false);
});

test("fails closed when Autodesk account lookup is unavailable or unreadable", async () => {
  mockAutodesk({ directoryStatus: 503 });
  assert.equal((await verifyHubAccess("user-token", "admin@example.com")).ok, false);
  mockAutodesk({ directory: {} });
  assert.equal((await verifyHubAccess("user-token", "admin@example.com")).ok, false);
  globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
  assert.equal((await verifyHubAccess("user-token", "admin@example.com")).ok, false);
});

test("authorization-code sign-in cannot create a session for an ordinary hub member", async () => {
  mockAutodesk({ directory: [{ email: "admin@example.com", access_level: "project_user" }] });
  await assert.rejects(() => exchangeCode("sample-code"), HubAccessError);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count, 0);
});
