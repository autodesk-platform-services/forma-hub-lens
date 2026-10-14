/** Exercise the actual npm dev command and production HTTP headers without APS credentials. */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function unusedPort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || !server.pid) return;
  const exited = once(server, "exit");
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  }
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise<void>((resolve) => {
      deadline = setTimeout(() => {
        if (server.exitCode === null) {
          try { process.kill(-server.pid!, "SIGKILL"); } catch { server.kill("SIGKILL"); }
        }
        resolve();
      }, 10_000);
    })]);
  } finally { if (deadline) clearTimeout(deadline); }
}

function assertHeaders(response: Response, development: boolean, https = false): void {
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  const csp = response.headers.get("Content-Security-Policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.equal(csp.includes("'unsafe-eval'"), development);
  assert.equal(csp.includes("upgrade-insecure-requests"), https);
  assert.equal(response.headers.get("Strict-Transport-Security"), https ? "max-age=31536000" : null);
}

async function checkServer(development: boolean): Promise<void> {
  const port = await unusedPort();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-server-review-"));
  const base = `http://127.0.0.1:${port}`;
  const environment: NodeJS.ProcessEnv = { ...process.env,
    NODE_ENV: development ? "development" : "production", LENS_MODE: "live", DATA_DIR: directory,
    APS_CLIENT_ID: "smoke-client", APS_CLIENT_SECRET: "smoke-secret",
    APS_CALLBACK_URL: `${base}/api/aps/callback`, FORMA_HUB_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  };
  delete environment.LENS_REVIEW_BUILD;
  delete environment.LENS_PREVIEW_BUILD;
  delete environment.NEXT_RUNTIME;
  delete environment.NEXT_PHASE;
  delete environment.FORMA_REGION;
  // The dev fixture tests sanitized error output as well as the failing quick start.
  if (development) {
    environment.LENS_PREVIEW_BUILD = "1";
    environment.FORMA_REGION = "private-smoke-region";
    // Multiple local workspaces can exhaust macOS watcher handles. Poll only
    // in this isolated test process; the application's dev command is unchanged.
    environment.WATCHPACK_POLLING = "1000";
  }
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "Run this check with npm run test:server-smoke.");
  const args = development
    ? [npmCli, "run", "dev", "--", "--port", String(port), "--hostname", "127.0.0.1"]
    : ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"];
  const server = spawn(process.execPath, args, { env: environment,
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  server.stdout!.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-80_000); });
  server.stderr!.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-80_000); });
  server.on("error", (error) => { logs += String(error); });
  try {
    let started = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) throw new Error(`Server exited: ${logs.slice(-4000)}`);
      try {
        const readiness = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (readiness.status === 200 || readiness.status === 503) { started = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
    assert.ok(started, `Server did not start: ${logs.slice(-4000)}`);
    const home = await fetch(base, { signal: AbortSignal.timeout(30_000) });
    assert.equal(home.status, 200, logs.slice(-4000));
    const html = await home.text();
    assert.match(html, /Forma Hub Lens/);
    assert.match(html, development ? /Configuration incomplete/ : /Sign in with Autodesk/);
    assert.doesNotMatch(html, /An error occurred in the Server Components render/);
    assertHeaders(home, development);

    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, development ? 503 : 200);
    assert.equal(health.headers.get("Cache-Control"), "no-store");
    assertHeaders(health, development);
    const body = await health.json();
    assert.deepEqual(Object.keys(body.checks).sort(), ["config", "database"]);
    assert.equal(body.checks.config, development ? "unavailable" : "ok");
    const publicResponse = JSON.stringify(body);
    assert.doesNotMatch(publicResponse, /APS_CLIENT|APS_CALLBACK|FORMA_REGION|FORMA_HUB_ID|DATA_DIR|private-smoke-region|smoke-secret/);
    assert.ok(!publicResponse.includes(directory));

    const asset = await fetch(`${base}/autodesk-logo.png`);
    assert.equal(asset.status, 200);
    assertHeaders(asset, development);
    const denied = await fetch(`${base}/closeout/packages/missing/download`);
    assert.equal(denied.status, 401);
    assertHeaders(denied, development);

    const secureResponse = await fetch(base, { headers: { "x-forwarded-proto": "https" } });
    assert.equal(secureResponse.status, 200);
    assertHeaders(secureResponse, development, !development);
    const script = html.match(/src="(\/_next\/static\/[^\"]+\.js[^\"]*)"/);
    assert.ok(script, "Next must emit its local client bundle.");
    const client = await fetch(`${base}${script[1]}`);
    assert.equal(client.status, 200, "the client bundle must load under the same-origin policy");
    assertHeaders(client, development);
    assert.doesNotMatch(logs, /UnhandledSchemeError|Reading from "node:crypto" is not handled|Module not found|Failed to compile/);
    console.log(`${development ? "npm run dev" : "production"} HTTP smoke passed: homepage 200, generic health, headers on pages/APIs/assets, HTTP compatibility and TLS proxy policy.`);
  } finally {
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

await checkServer(true);
await checkServer(false);
