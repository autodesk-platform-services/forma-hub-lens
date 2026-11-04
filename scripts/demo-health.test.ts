import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import type { DatabaseSync } from "node:sqlite";

const variableNames = [
  "APS_CLIENT_ID", "APS_CLIENT_SECRET", "APS_CALLBACK_URL", "DEMO_SESSION_SECRET",
  "FORMA_HUB_ID", "FORMA_REGION", "LENS_MODE", "DATA_DIR", "LENS_DEMO_URL", "LENS_LIVE_URL",
];
const originalEnvironment = new Map(variableNames.map((name) => [name, process.env[name]]));
const realFetch = globalThis.fetch;
const privatePath = "/private/health-test/cache-volume";
const privateDatabaseError = `SQLITE_ERROR: failed to prepare private health SQL at ${privatePath}`;

function validConfiguration() {
  for (const name of variableNames) delete process.env[name];
  process.env.LENS_MODE = "demo";
  process.env.DATA_DIR = privatePath;
}

validConfiguration();
const { GET } = await import("../src/app/api/health/route.ts");
const { closeDb } = await import("../src/lib/db.ts");
afterEach(() => { closeDb(); validConfiguration(); globalThis.fetch = realFetch; });
after(() => {
  closeDb();
  globalThis.fetch = realFetch;
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

async function publicBody(expectedStatus: number) {
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("Health must not make network requests."); };
  const response = await GET();
  assert.equal(networkCalls, 0);
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["checks", "status", "time"]);
  assert.deepEqual(Object.keys(body.checks).sort(), ["config", "database"]);
  assert.ok(Number.isFinite(Date.parse(body.time)));
  const serialized = JSON.stringify(body);
  const privateValues = variableNames.flatMap((name) => process.env[name] ? [process.env[name]!, process.env[name]!.toUpperCase()] : []);
  for (const privateText of [...variableNames, ...privateValues, privatePath, privateDatabaseError, "SQLITE_ERROR"]) {
    assert.ok(!serialized.includes(privateText), `Public response must not reveal ${privateText}`);
  }
  return body;
}

test("public health hides invalid runtime mode details", async () => {
  process.env.LENS_MODE = "private-invalid-runtime-mode";
  const body = await publicBody(503);
  assert.equal(body.status, "degraded");
  assert.deepEqual(body.checks, { config: "unavailable", database: "unavailable" });
});

test("public health hides real-hub configuration and ignored credentials", async () => {
  process.env.FORMA_HUB_ID = "private-real-hub-identifier";
  process.env.APS_CLIENT_ID = "private-health-client";
  process.env.APS_CLIENT_SECRET = "private-health-secret";
  process.env.APS_CALLBACK_URL = "https://private.example/api/aps/callback";
  const body = await publicBody(503);
  assert.equal(body.status, "degraded");
  assert.deepEqual(body.checks, { config: "unavailable", database: "ok" });
});

test("public health does not echo invalid region names or values", async () => {
  process.env.FORMA_REGION = "private-health-region";
  const body = await publicBody(503);
  assert.equal(body.status, "degraded");
  assert.deepEqual(body.checks, { config: "unavailable", database: "ok" });
});

test("database failures expose no filesystem paths or SQL details", async () => {
  const previousDb = globalThis.__formaDb;
  globalThis.__formaDb = {
    prepare() { throw new Error(privateDatabaseError); },
  } as unknown as DatabaseSync;
  try {
    const body = await publicBody(503);
    assert.equal(body.status, "degraded");
    assert.deepEqual(body.checks, { config: "ok", database: "unavailable" });
  } finally {
    globalThis.__formaDb = previousDb;
  }
});

test("anonymous health returns generic 200 without credentials, network calls or sample counts", async () => {
  for (const name of ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "APS_CALLBACK_URL", "DEMO_SESSION_SECRET"]) {
    assert.equal(process.env[name], undefined);
  }
  const body = await publicBody(200);
  assert.equal(body.status, "ok");
  assert.deepEqual(body.checks, { config: "ok", database: "ok" });
});
