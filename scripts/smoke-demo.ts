/** Exercise the public production demo with no identity, cookies, or APS credentials. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { getDb, closeDb } from "../src/lib/db.ts";
import { TOOL_SPECS } from "../src/lib/dashboards/specs.ts";

const allocation = createServer();
allocation.listen(0, "127.0.0.1");
await once(allocation, "listening");
const port = (allocation.address() as { port: number }).port;
await new Promise<void>((resolve) => allocation.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const serverEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", LENS_MODE: "demo", FORMA_HUB_ID: "" };
for (const name of ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "APS_CALLBACK_URL", "DEMO_SESSION_SECRET", "LENS_DEMO_URL", "LENS_LIVE_URL", "FORMA_REGION"]) {
  delete serverEnv[name];
}
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
  env: serverEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout!.on("data", (chunk) => { logs += String(chunk); });
server.stderr!.on("data", (chunk) => { logs += String(chunk); });
try {
  let started = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Production server exited: ${logs.slice(-2000)}`);
    try { await fetch(base); started = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.ok(started, "production server did not start");
  const publicHome = await fetch(base);
  assert.equal(publicHome.status, 200);
  const homeHtml = await publicHome.text();
  assert.match(homeHtml, /No Autodesk sign-in required/);
  assert.doesNotMatch(homeHtml, /Configuration incomplete|Sign in with Autodesk|Sign out|href="\/api\/aps\/login"/);
  assert.equal(publicHome.headers.get("set-cookie"), null, "the public demo must not create an identity cookie");
  for (const path of ["/api/aps/login", "/api/aps/callback?code=not-real&state=forged&returnTo=https%3A%2F%2Fexample.com"]) {
    const oldAuth = await fetch(`${base}${path}`, { redirect: "manual" });
    assert.equal(oldAuth.status, 307, path);
    assert.equal(new URL(oldAuth.headers.get("location")!, base).toString(), `${base}/`, path);
    assert.equal(oldAuth.headers.get("set-cookie"), null, path);
  }
  const db = getDb();
  const project = (db.prepare("SELECT id FROM projects ORDER BY id LIMIT 1").get() as { id: string }).id;
  const person = (db.prepare("SELECT id FROM ds_admin_users LIMIT 1").get() as { id: string }).id;
  const company = (db.prepare("SELECT id FROM ds_admin_companies LIMIT 1").get() as { id: string }).id;
  const manifest = (db.prepare("SELECT id FROM integration_manifests LIMIT 1").get() as { id: string }).id;
  const assigned = (db.prepare("SELECT project_id FROM closeout_assignments LIMIT 1").get() as { project_id: string }).project_id;
  const pages = ["/", "/projects", "/people", "/people?view=matrix", "/activity", "/tools", "/governance", "/lifecycle",
    "/extracts", "/data-health", "/integrations", "/integrations/schema", "/integrations/inventory", "/integrations/watch",
    `/integrations/${manifest}`, "/closeout", "/closeout/profiles", `/closeout/${assigned}`, "/manage", "/recipes",
    "/offboarding", "/permissions", "/views", "/search?q=Northwind", `/projects/${project}`, `/people/${person}`, `/companies/${company}`];
  for (const page of pages) {
    const response = await fetch(`${base}${page}`);
    assert.equal(response.status, 200, `${page}: ${logs.slice(-1500)}`);
    const html = await response.text();
    assert.match(html, /Synthetic demo hub/, page);
    assert.doesNotMatch(html, /Configuration incomplete|Sign in with Autodesk|Sign out|href="\/api\/aps\/login"/, `${page} must be open without sign-in`);
    assert.doesNotMatch(html, /An error occurred in the Server Components render/, page);
  }
  for (const spec of TOOL_SPECS) {
    const response = await fetch(`${base}/api/dashboards/${spec.id}`);
    assert.equal(response.status, 200, spec.id);
    assert.equal((await response.json()).enabled, true, spec.id);
  }
  const withOldCookie = await fetch(`${base}/api/dashboards/issues`, { headers: { Cookie: "forma_demo_session=forged-old-identity; forma_demo_oauth_state=forged" } });
  assert.equal(withOldCookie.status, 200, "old identity cookies do not control access to synthetic data");
  const upload = await fetch(`${base}/api/dataset/upload`, { method: "POST" });
  assert.equal(upload.status, 403, "real dataset upload must be disabled");
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const oldLogout = await fetch(`${base}/api/aps/logout`, { method: "POST", redirect: "manual" });
  assert.equal(oldLogout.status, 303);
  assert.equal(new URL(oldLogout.headers.get("location")!, base).toString(), `${base}/`);
  console.log(`Production HTTP smoke passed: ${pages.length} public pages, ${TOOL_SPECS.length} dashboards, no credentials/cookies required, legacy OAuth redirects, upload denial and health.`);
} finally {
  closeDb();
  const exited = once(server, "exit");
  server.kill("SIGTERM");
  await exited;
}
