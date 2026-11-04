import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { DEMO_HUB_ID, hubDeploymentUrl, lensMode } from "../src/lib/demoConfig.ts";

function resetEnvironment() {
  process.env.LENS_MODE = "demo";
  for (const name of ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "APS_CALLBACK_URL", "DEMO_SESSION_SECRET", "FORMA_HUB_ID", "LENS_DEMO_URL", "LENS_LIVE_URL", "FORMA_REGION"]) delete process.env[name];
}
resetEnvironment();
const { configProblems, env } = await import("../src/lib/env.ts");
afterEach(resetEnvironment);

test("public sample requires no APS app, callback, credentials or encryption key", () => {
  assert.deepEqual(configProblems(), []);
  assert.equal(env.mode, "demo");
  assert.equal(env.hubId, DEMO_HUB_ID);
  for (const name of ["clientId", "clientSecret", "callbackUrl", "demoSessionSecret"]) assert.equal(name in env, false);
  process.env.APS_CLIENT_ID = "obsolete-app";
  process.env.APS_CLIENT_SECRET = "obsolete-secret";
  process.env.APS_CALLBACK_URL = "obsolete-invalid-url";
  process.env.DEMO_SESSION_SECRET = "obsolete-invalid-key";
  assert.deepEqual(configProblems(), []);
});

test("this repository is always synthetic and rejects live or unknown runtime modes", () => {
  assert.equal(lensMode(""), "demo");
  assert.equal(lensMode(" DEMO "), "demo");
  assert.throws(() => lensMode("live"), /demo-only/);
  assert.throws(() => lensMode("pretend-admin"), /LENS_MODE/);
  process.env.LENS_MODE = "live";
  assert.ok(configProblems().some((message) => message.includes("demo-only")));
  assert.throws(() => env.hubId, /demo-only/);
  process.env.LENS_MODE = "demo";
  process.env.FORMA_HUB_ID = "a-real-autodesk-hub";
  assert.ok(configProblems().some((message) => message.includes("must not identify a real hub")));
  process.env.FORMA_HUB_ID = DEMO_HUB_ID;
  assert.deepEqual(configProblems(), []);
});

test("deployment links reject unsafe URL configurations", () => {
  assert.equal(hubDeploymentUrl("https://live.example.com"), "https://live.example.com/");
  for (const value of ["javascript:alert(1)", "https://user:pass@example.com", "https://example.com?mode=live", "https://example.com/#token"]) {
    assert.equal(hubDeploymentUrl(value), undefined);
    process.env.LENS_LIVE_URL = value;
    assert.ok(configProblems().some((message) => message.startsWith("LENS_LIVE_URL")));
  }
});
