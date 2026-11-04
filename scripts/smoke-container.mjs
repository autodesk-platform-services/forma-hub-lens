/** Validate the production image without credentials, cookies, or persistent storage. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const image = process.argv[2];
assert.ok(image, "Usage: node scripts/smoke-container.mjs <image>");

function docker(...args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const [imageInfo] = JSON.parse(docker("image", "inspect", image));
assert.ok(imageInfo, "image inspection must return the requested image");
const configuredUser = imageInfo.Config.User;
assert.ok(configuredUser, "image must declare a non-root user");
assert.ok(!["root", "0"].includes(configuredUser.split(":")[0]), "image must not run as root");
const bakedEnv = new Map((imageInfo.Config.Env ?? []).map((entry) => {
  const separator = entry.indexOf("=");
  return [entry.slice(0, separator), entry.slice(separator + 1)];
}));
assert.ok(![...bakedEnv.keys()].some((name) => /^APS_/i.test(name)), "image must not contain APS environment variables");
assert.equal(bakedEnv.get("LENS_MODE"), "demo");
assert.equal(bakedEnv.get("PORT"), "3000");
assert.equal(bakedEnv.get("HOSTNAME"), "0.0.0.0");
assert.equal(bakedEnv.get("NODE_ENV"), "production");
assert.deepEqual(Object.keys(imageInfo.Config.Volumes ?? {}), [], "the demo must not declare persistent volumes");
assert.ok(imageInfo.Config.Healthcheck?.Test?.length, "image must include a health check");

const name = `lens-demo-smoke-${randomUUID()}`;
const containerPort = 3100;
let created = false;
try {
  // Exercise PORT overrides and let Docker allocate a host port bound only to loopback.
  docker("create", "--name", name, "--env", `PORT=${containerPort}`, "--publish", `127.0.0.1::${containerPort}`, image);
  created = true;
  docker("start", name);
  const [container] = JSON.parse(docker("inspect", name));
  const mapping = container.NetworkSettings.Ports[`${containerPort}/tcp`]?.find((entry) => entry.HostIp === "127.0.0.1");
  assert.ok(mapping?.HostPort, "Docker must publish a temporary loopback port");
  const base = `http://127.0.0.1:${mapping.HostPort}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });

  let ready = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await request("/api/health");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The standalone server can still be starting and seeding its sample data.
    }
    const state = JSON.parse(docker("inspect", "--format", "{{json .State}}", name));
    assert.ok(state.Running, "container exited before becoming ready");
    await delay(500);
  }
  assert.ok(ready, "container did not become healthy within 90 seconds");
  assert.notEqual(docker("exec", name, "id", "-u"), "0", "runtime process must be non-root");

  const health = await request("/api/health");
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.deepEqual(healthBody.checks, { config: "ok", database: "ok" });

  const home = await request("/");
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("set-cookie"), null, "anonymous homepage must not create an identity cookie");
  const html = await home.text();
  assert.match(html, /Synthetic demo hub/);
  assert.match(html, /No Autodesk sign-in required/);
  assert.doesNotMatch(html, /Configuration incomplete|Sign in with Autodesk|Sign out|href="\/api\/aps\/login"|An error occurred in the Server Components render/);
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(home.headers.get("content-security-policy") ?? "", /(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/);

  const dashboard = await request("/api/dashboards/issues");
  assert.equal(dashboard.status, 200);
  const dashboardBody = await dashboard.json();
  assert.equal(dashboardBody.enabled, true);
  assert.deepEqual(dashboardBody.missing, []);
  const issueCount = dashboardBody.kpis?.find((kpi) => kpi.label === "Issues");
  assert.equal(issueCount?.available, true, "seeded Issues KPI must be available");
  assert.ok(typeof issueCount.value === "number" && issueCount.value > 0, "seeded issues must be present");
  assert.equal(dashboard.headers.get("set-cookie"), null);

  for (const path of ["/api/aps/login", "/api/aps/callback?code=not-real&state=forged"]) {
    const response = await request(path, { redirect: "manual" });
    assert.equal(response.status, 307, path);
    assert.equal(new URL(response.headers.get("location"), base).toString(), `${base}/`, path);
    assert.equal(response.headers.get("set-cookie"), null, path);
  }

  const staticPath = html.match(/(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]+)"/)?.[1];
  assert.ok(staticPath, "homepage must reference a built JavaScript or CSS asset");
  const staticAsset = await request(staticPath.replaceAll("&amp;", "&"));
  assert.equal(staticAsset.status, 200, "standalone image must contain .next/static");
  assert.ok((await staticAsset.arrayBuffer()).byteLength > 0);
  const publicAsset = await request("/autodesk-logo.png");
  assert.equal(publicAsset.status, 200, "standalone image must contain public assets");
  assert.match(publicAsset.headers.get("content-type") ?? "", /^image\/png/);
  const optimizedImage = await request("/_next/image?url=%2Fautodesk-logo.png&w=256&q=75");
  assert.equal(optimizedImage.status, 200, "image optimization must work without install scripts");
  assert.match(optimizedImage.headers.get("content-type") ?? "", /^image\//);
  assert.ok((await optimizedImage.arrayBuffer()).byteLength > 0);

  // Run the exact image health-check command too, including its PORT handling.
  const healthCheck = imageInfo.Config.Healthcheck.Test;
  assert.equal(healthCheck[0], "CMD", "health check must use exec form");
  docker("exec", name, ...healthCheck.slice(1));
  console.log("Container smoke passed: non-root, anonymous demo, health, seeded issues, legacy redirects, frame denial, static files and optimized image.");
} catch (error) {
  if (created) {
    try { console.error(docker("logs", "--tail", "100", name)); } catch { /* Keep the original failure. */ }
  }
  throw error;
} finally {
  if (created) {
    try { docker("stop", "--time", "5", name); } finally { docker("rm", "--force", name); }
  }
}
