import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { execFileSync } from "node:child_process";

const credentialNames = ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "APS_CALLBACK_URL", "DEMO_SESSION_SECRET"];
function resetEnvironment() {
  process.env.LENS_MODE = "demo";
  for (const name of [...credentialNames, "FORMA_HUB_ID", "LENS_DEMO_URL", "LENS_LIVE_URL", "FORMA_REGION"]) delete process.env[name];
}
resetEnvironment();
const auth = await import("../src/lib/aps/auth.ts");
const { DEMO_VISITOR_ID, getSession, requireSession, requirePortfolioAccess, requireHubAdminSession, refreshIfNeeded } = auth;
const { apsFetch, requireLiveApsSession } = await import("../src/lib/aps/client.ts");
const { getTwoLeggedToken } = await import("../src/lib/aps/twoLegged.ts");
const { verifyHubAccess } = await import("../src/lib/aps/authorization.ts");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetEnvironment(); });

function prohibitNetwork() {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Network prohibited"); };
  return () => calls;
}

test("public demo opens without credentials, cookies, request context or network", async () => {
  const calls = prohibitNetwork();
  const session = await getSession();
  assert.ok(session);
  assert.deepEqual(session, {
    id: DEMO_VISITOR_ID, mode: "demo", accessToken: "", refreshToken: null,
    expiresAt: Number.MAX_SAFE_INTEGER, scope: null, userId: DEMO_VISITOR_ID,
    userName: "Demo visitor", userEmail: null, hubVerifiedAt: null, hubRole: null,
  });
  assert.deepEqual(await requireSession(), session);
  assert.deepEqual(await requirePortfolioAccess(), session);
  const second = await getSession();
  assert.notEqual(second, session);
  session.userName = "Changed by a caller";
  assert.equal(second?.userName, "Demo visitor");
  assert.equal(calls(), 0);
  for (const name of ["exchangeCode", "buildAuthorizeUrl", "consumeBrowserState", "readSession", "setSessionCookie", "SESSION_COOKIE", "OAUTH_STATE_COOKIE"]) {
    assert.equal(name in auth, false, `Removed OAuth helper ${name} must not remain available`);
  }
});

test("obsolete APS and session settings do not reinstate sign-in or identify the visitor", async () => {
  const calls = prohibitNetwork();
  process.env.APS_CLIENT_ID = "old-client";
  process.env.APS_CLIENT_SECRET = "old-secret";
  process.env.APS_CALLBACK_URL = "not-even-a-url";
  process.env.DEMO_SESSION_SECRET = "not-a-valid-key";
  const session = await requireSession();
  assert.equal(session.userId, DEMO_VISITOR_ID);
  assert.equal(session.userEmail, null);
  assert.equal(session.accessToken, "");
  assert.equal(calls(), 0);
});

test("public visitor is deterministic in a cold server process with no session store", async () => {
  const output = execFileSync(process.execPath, ["--conditions=react-server", "--import", "./scripts/resolve-ts.mjs", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e",
    "import {getSession} from './src/lib/aps/auth.ts'; globalThis.fetch=async()=>{throw new Error('Network prohibited')}; process.stdout.write(JSON.stringify(await getSession()));"],
    { cwd: process.cwd(), env: { ...process.env }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), await getSession());
});

test("anonymous access never authorizes live APS calls or administrative actions", async () => {
  const calls = prohibitNetwork();
  const session = await requireSession();
  await assert.rejects(() => requireHubAdminSession(), /disabled/);
  await assert.rejects(() => apsFetch(session, "/construction/admin/v1/accounts/real-hub/projects"), /disabled/);
  await assert.rejects(() => apsFetch(session, "https://developer.api.autodesk.com/data/v1/projects/real-project/folders"), /disabled/);
  await assert.rejects(() => getTwoLeggedToken(), /disabled/);
  assert.throws(() => requireLiveApsSession(session), /disabled/);
  assert.equal((await verifyHubAccess("forged-token", "someone@example.test")).ok, false);
  assert.deepEqual(await refreshIfNeeded(session), session);
  for (const candidate of [
    { ...session, mode: "live" as const },
    { ...session, accessToken: "forged-token" },
    { ...session, refreshToken: "forged-refresh" },
    { ...session, hubRole: "hub_admin" as const },
  ]) {
    assert.equal(await refreshIfNeeded(candidate), null);
    await assert.rejects(() => apsFetch(candidate, "/anything"), /disabled/);
  }
  assert.equal(calls(), 0);
});

test("live or real-hub runtime configuration fails closed even with copied credentials", async () => {
  const calls = prohibitNetwork();
  process.env.APS_CLIENT_ID = "copied-client";
  process.env.APS_CLIENT_SECRET = "copied-secret";
  for (const mode of ["live", "unknown"]) {
    process.env.LENS_MODE = mode;
    assert.equal(await getSession(), null);
    await assert.rejects(() => requirePortfolioAccess(), /configuration is invalid/);
    await assert.rejects(() => requireHubAdminSession(), /configuration is invalid/);
  }
  process.env.LENS_MODE = "demo";
  process.env.FORMA_HUB_ID = "real-hub";
  assert.equal(await getSession(), null);
  await assert.rejects(() => requireSession(), /configuration is invalid/);
  await assert.rejects(() => getTwoLeggedToken(), /disabled/);
  assert.equal(calls(), 0);
});
