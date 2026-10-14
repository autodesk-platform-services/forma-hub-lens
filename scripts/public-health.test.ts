import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-health-"));
const variableNames = ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "APS_CALLBACK_URL", "FORMA_HUB_ID", "FORMA_REGION", "LENS_MODE", "DATA_DIR"];
const originalEnvironment = new Map(variableNames.map((name) => [name, process.env[name]]));
const realFetch = globalThis.fetch;

function validConfiguration() {
  process.env.DATA_DIR = directory;
  process.env.LENS_MODE = "live";
  process.env.APS_CLIENT_ID = "health-test-client";
  process.env.APS_CLIENT_SECRET = "health-test-private-value";
  process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
  process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  delete process.env.FORMA_REGION;
}

validConfiguration();
const { GET } = await import("../src/app/api/health/route.ts");
const { closeDb } = await import("../src/lib/db.ts");
afterEach(() => { closeDb(); validConfiguration(); globalThis.fetch = realFetch; });
after(() => {
  closeDb();
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

async function publicBody(expectedStatus: number) {
  globalThis.fetch = async () => { throw new Error("Health must not contact Autodesk."); };
  const response = await GET();
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["checks", "status", "time"]);
  assert.deepEqual(Object.keys(body.checks).sort(), ["config", "database"]);
  assert.ok(Number.isFinite(Date.parse(body.time)));
  const serialized = JSON.stringify(body);
  for (const privateText of [...variableNames, "health-test-client", "health-test-private-value", process.env.FORMA_HUB_ID!, directory]) {
    assert.ok(!serialized.includes(privateText), `Public response must not reveal ${privateText}`);
  }
  return body;
}

test("public health returns generic 503 for missing configuration without exposing variable names", async () => {
  for (const name of variableNames.filter((name) => name !== "DATA_DIR")) delete process.env[name];
  // Keep a private fixture hub identifier only for the database namespace.
  process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const body = await publicBody(503);
  assert.equal(body.status, "degraded");
  assert.equal(body.checks.config, "unavailable");
});

test("public health does not echo an invalid region value", async () => {
  const privateRegion = "private-region-review-value";
  process.env.FORMA_REGION = privateRegion;
  const body = await publicBody(503);
  assert.equal(body.checks.config, "unavailable");
  assert.ok(!JSON.stringify(body).includes(privateRegion));
});

test("database failures disclose no filesystem or database error details", async () => {
  const file = path.join(directory, "private-volume-path");
  fs.writeFileSync(file, "not a directory");
  process.env.DATA_DIR = file;
  const body = await publicBody(503);
  assert.deepEqual(body.checks, { config: "ok", database: "unavailable" });
  assert.ok(!JSON.stringify(body).includes(file));
});

test("healthy readiness is public and returns generic 200 without cached portfolio counts", async () => {
  const body = await publicBody(200);
  assert.equal(body.status, "ok");
  assert.deepEqual(body.checks, { config: "ok", database: "ok" });
});
