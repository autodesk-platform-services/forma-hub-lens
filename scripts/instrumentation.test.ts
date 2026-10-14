import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const loader = fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url));
const entry = new URL("../src/instrumentation.ts", import.meta.url).href;

/** Run the actual entry and Node worker in a clean process, replacing only their
 * external config/monitor dependencies and timers. No APS calls or disk cache. */
function runRegistration(options: {
  runtime?: string;
  phase?: string;
  configProblems?: string[];
  registrations?: number;
  rejectMonitor?: boolean;
  fireTimer?: boolean;
}) {
  const script = `
    import { registerHooks } from "node:module";
    const options = ${JSON.stringify(options)};
    if (options.runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = options.runtime;
    if (options.phase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = options.phase;
    const state = globalThis.instrumentationTest = {
      nodeImports: 0, configImports: 0, monitorImports: 0, configChecks: 0,
      timerStarts: 0, timerDelay: null, unrefs: 0, ticks: 0,
      problems: options.configProblems ?? [], rejectMonitor: options.rejectMonitor ?? false,
    };
    const modules = {
      "./lib/env": "export function configProblems() { globalThis.instrumentationTest.configChecks++; return globalThis.instrumentationTest.problems; }",
      "./lib/integrationMonitor": "export async function runScheduledIntegrationChecks() { globalThis.instrumentationTest.ticks++; if (globalThis.instrumentationTest.rejectMonitor) throw new Error('synthetic monitor failure'); }",
    };
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === "./instrumentation-node") {
        state.nodeImports++;
        if (options.runtime !== "nodejs") throw new Error("Node worker imported outside nodejs runtime");
      }
      if (specifier in modules) {
        if (specifier === "./lib/env") state.configImports++;
        else state.monitorImports++;
        return { url: "data:text/javascript," + encodeURIComponent(modules[specifier]), shortCircuit: true };
      }
      return nextResolve(specifier, context);
    } });
    let timerCallback;
    globalThis.setInterval = (callback, delay) => {
      state.timerStarts++; state.timerDelay = delay; timerCallback = callback;
      return { unref() { state.unrefs++; } };
    };
    const { register } = await import(${JSON.stringify(entry)});
    for (let i = 0; i < (options.registrations ?? 1); i++) await register();
    if (options.fireTimer && timerCallback) timerCallback();
    await new Promise(resolve => setImmediate(resolve));
    console.log(JSON.stringify(state));
  `;
  const child = spawnSync(process.execPath, [
    "--conditions=react-server", "--import", loader,
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "--eval", script,
  ], { encoding: "utf8", timeout: 15_000 });
  assert.equal(child.status, 0, child.stderr || String(child.error ?? "Instrumentation child failed"));
  return JSON.parse(child.stdout.trim()) as {
    nodeImports: number; configImports: number; monitorImports: number; configChecks: number;
    timerStarts: number; timerDelay: number | null; unrefs: number; ticks: number;
  };
}

for (const runtime of ["edge", undefined, "unexpected"]) {
  test(`register does not import Node worker for ${runtime ?? "unset"} runtime`, () => {
    const state = runRegistration({ runtime });
    assert.equal(state.nodeImports, 0);
    assert.equal(state.configImports, 0);
    assert.equal(state.monitorImports, 0);
    assert.equal(state.timerStarts, 0);
    assert.equal(state.ticks, 0);
  });
}

test("production build skips config and monitor imports", () => {
  const state = runRegistration({ runtime: "nodejs", phase: "phase-production-build" });
  assert.equal(state.nodeImports, 1);
  assert.equal(state.configImports, 0);
  assert.equal(state.monitorImports, 0);
  assert.equal(state.timerStarts, 0);
  assert.equal(state.ticks, 0);
});

test("incomplete configuration does not import or start the monitor", () => {
  const state = runRegistration({ runtime: "nodejs", configProblems: ["synthetic missing configuration"] });
  assert.equal(state.configChecks, 1);
  assert.equal(state.monitorImports, 0);
  assert.equal(state.timerStarts, 0);
  assert.equal(state.ticks, 0);
});

test("node registration starts one unrefed timer and an immediate tick", () => {
  const state = runRegistration({ runtime: "nodejs", registrations: 2, fireTimer: true });
  assert.equal(state.timerStarts, 1);
  assert.equal(state.timerDelay, 60_000);
  assert.equal(state.unrefs, 1);
  assert.equal(state.ticks, 2, "one immediate tick plus one simulated scheduled tick");
});

test("monitor rejection is handled without failing registration", () => {
  const state = runRegistration({ runtime: "nodejs", rejectMonitor: true, fireTimer: true });
  assert.equal(state.timerStarts, 1);
  assert.equal(state.unrefs, 1);
  assert.equal(state.ticks, 2);
});
