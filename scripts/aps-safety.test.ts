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

const { apsFetch, apsPaginate } = await import("../src/lib/aps/client.ts");
const { buildAuthorizeUrl, consumeBrowserState, readSession, refreshIfNeeded, SCOPES } = await import("../src/lib/aps/auth.ts");
const { configProblems } = await import("../src/lib/env.ts");
const { cachedProjects, syncProjects } = await import("../src/lib/aps/admin.ts");
const { getDb, closeDb } = await import("../src/lib/db.ts");

const session = {
  id: "refresh-session", mode: "live" as const, accessToken: "old-access", refreshToken: "old-refresh",
  expiresAt: Date.now() - 1_000, scope: null, userId: "u1", userName: "Test",
  userEmail: "test@example.com", hubVerifiedAt: Date.now(), hubRole: "hub_admin" as const,
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

test("OAuth state is one-use and bound to the browser that started sign-in", () => {
  const { state } = buildAuthorizeUrl();
  assert.match(state, /^live\./);
  assert.equal(consumeBrowserState(state, undefined), false);
  assert.equal(consumeBrowserState(state, "state-from-another-browser"), false);
  assert.equal(consumeBrowserState("demo.fake", "demo.fake"), false);
  assert.equal(consumeBrowserState(state, state), true);
  assert.equal(consumeBrowserState(state, state), false);
});

test("live release rejects a leftover demo deployment setting and keeps live scopes", () => {
  const previous = process.env.LENS_MODE;
  try {
    process.env.LENS_MODE = "demo";
    assert.match(configProblems().join("\n"), /LENS_MODE must be live or unset/);
    assert.deepEqual(SCOPES, ["data:read", "data:create", "account:read", "account:write", "user-profile:read", "openid"]);
  } finally {
    if (previous === undefined) delete process.env.LENS_MODE;
    else process.env.LENS_MODE = previous;
  }
});

test("invalid deployment configuration blocks APS requests before network access", async () => {
  const previous = process.env.LENS_MODE;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  try {
    process.env.LENS_MODE = "demo";
    await assert.rejects(() => apsFetch(session, "/test"), /configuration is incomplete/);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.LENS_MODE;
    else process.env.LENS_MODE = previous;
  }
});

test("former demo and unknown session modes cannot read live cached data or call APS", async () => {
  for (const mode of ["demo", "unknown"]) {
    const id = `nonlive-${mode}`;
    getDb().prepare(
      `INSERT INTO sessions (id, access_token, expires_at, created_at, mode)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, "untrusted", Date.now() + 60_000, Date.now(), mode);
    assert.equal(readSession(id), null);
  }
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  await assert.rejects(() => apsFetch({ ...session, mode: "demo" } as unknown as typeof session, "/test"), /live session/);
  assert.equal(calls, 0);
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

test("pagination refuses a malformed or capped collection instead of caching partial data", async () => {
  globalThis.fetch = (async () => Response.json({ pagination: { totalResults: 5 } })) as typeof fetch;
  await assert.rejects(() => apsPaginate(session, "/test", { limit: 2 }), /unreadable paginated response/);

  globalThis.fetch = (async () => Response.json({
    results: [{ id: "a" }, { id: "b" }], pagination: { totalResults: 5 },
  })) as typeof fetch;
  await assert.rejects(() => apsPaginate(session, "/test", { limit: 2, maxPages: 2 }), /exceeded 2 pages/);
});

test("complete project sync removes absent cached projects and rejects malformed refreshes", async () => {
  let response: unknown = { results: [{ id: "project-a", name: "A" }, { id: "project-b", name: "B" }] };
  globalThis.fetch = (async () => Response.json(response)) as typeof fetch;
  await syncProjects(session);
  assert.deepEqual(cachedProjects().map((project) => project.id), ["project-a", "project-b"]);

  response = { results: [{ id: "project-b", name: "B" }] };
  await syncProjects(session);
  assert.deepEqual(cachedProjects().map((project) => project.id), ["project-b"]);

  response = { results: [{ id: "project-b" }, { id: "project-b" }] };
  await assert.rejects(() => syncProjects(session), /duplicate project list/);
  assert.deepEqual(cachedProjects().map((project) => project.id), ["project-b"]);

  response = { pagination: { totalResults: 1 } };
  await assert.rejects(() => syncProjects(session), /unreadable paginated response/);
  assert.deepEqual(cachedProjects().map((project) => project.id), ["project-b"]);
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
