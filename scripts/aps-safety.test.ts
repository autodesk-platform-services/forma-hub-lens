import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-aps-safety-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { apsFetch } = await import("../src/lib/aps/client.ts");
const { refreshIfNeeded } = await import("../src/lib/aps/auth.ts");
const { getDb, closeDb } = await import("../src/lib/db.ts");

const session = {
  id: "refresh-session", accessToken: "old-access", refreshToken: "old-refresh",
  expiresAt: Date.now() - 1_000, scope: null, userId: "u1", userName: "Test",
  userEmail: "test@example.com", hubVerifiedAt: Date.now(),
};

const realFetch = globalThis.fetch;
const realWarn = console.warn;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});
after(() => {
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("APS does not replay a POST after an HTTP 503", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("temporary failure", { status: 503 });
  }) as typeof fetch;
  await assert.rejects(() => apsFetch(session, "/data-connector/v1/requests", {
    method: "POST", body: { description: "once" },
  }), /503/);
  assert.equal(calls, 1);
});

test("APS still retries a read after a transient 503", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return calls === 1
      ? new Response("temporary failure", { status: 503, headers: { "Retry-After": "0.001" } })
      : Response.json({ ok: true });
  }) as typeof fetch;
  assert.deepEqual(await apsFetch(session, "/test"), { ok: true });
  assert.equal(calls, 2);
});

test("transient refresh failure denies this request but preserves the session for retry", async () => {
  getDb().prepare(
    `INSERT INTO sessions (id, access_token, refresh_token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(session.id, session.accessToken, session.refreshToken, session.expiresAt, Date.now());
  globalThis.fetch = (async () => { throw new Error("ECONNRESET"); }) as typeof fetch;
  const warnings: string[] = [];
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  assert.equal(await refreshIfNeeded(session), null);
  assert.ok(getDb().prepare("SELECT id FROM sessions WHERE id = ?").get(session.id));
  assert.match(warnings.join("\n"), /retained for retry/);
});

test("invalid_grant removes a revoked refresh session", async () => {
  globalThis.fetch = (async () => Response.json({ error: "invalid_grant" }, { status: 400 })) as typeof fetch;
  console.warn = () => {};
  assert.equal(await refreshIfNeeded(session), null);
  assert.equal(getDb().prepare("SELECT id FROM sessions WHERE id = ?").get(session.id), undefined);
});
