import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEMO_SNAPSHOT_AT, seedDemoDatabase } from "../src/lib/demoSeed.ts";
import { initializeDemoReadSchemas } from "../src/lib/demoReadSchemas.ts";
import { TOOL_SPECS } from "../src/lib/dashboards/specs.ts";
import { demoPreferencesKey, parseDemoPreferences, safeDemoViewPath } from "../src/lib/demoBrowserState.ts";

test("cold starts recreate an identical fictional snapshot instead of relying on shared disk", () => {
  const first = new DatabaseSync(":memory:");
  const second = new DatabaseSync(":memory:");
  try {
    for (const db of [first, second]) { initializeDemoReadSchemas(db); seedDemoDatabase(db); }
    for (const name of ["projects", "activities", "extract_jobs", "dataset_tables", "integration_manifests", "closeout_profiles"]) {
      assert.deepEqual(first.prepare(`SELECT * FROM ${name}`).all(), second.prepare(`SELECT * FROM ${name}`).all(), name);
    }
    assert.equal((first.prepare("SELECT seeded_at FROM demo_seed_meta").get() as { seeded_at: number }).seeded_at, DEMO_SNAPSHOT_AT);
    const tableNames = new Set((first.prepare("SELECT name FROM dataset_tables").all() as Array<{ name: string }>).map((row) => row.name));
    for (const spec of TOOL_SPECS) for (const table of spec.requires) assert.ok(tableNames.has(table), `${spec.name}: ${table}`);
  } finally { first.close(); second.close(); }
});

test("the public demo database performs no filesystem writes and denies server-side mutations", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-demo-no-disk-"));
  const forbidden = path.join(temp, "must-not-be-created");
  process.env.LENS_MODE = "demo";
  process.env.DATA_DIR = forbidden;
  const { getDb, closeDb } = await import("../src/lib/db.ts");
  try {
    closeDb();
    const db = getDb();
    assert.equal(fs.existsSync(forbidden), false);
    assert.equal((db.prepare("PRAGMA query_only").get() as { query_only: number }).query_only, 1);
    const rows = db.prepare("SELECT * FROM projects").all();
    assert.throws(() => db.exec("DELETE FROM projects"), /readonly/i);
    assert.throws(() => db.prepare("INSERT INTO saved_views VALUES (?,?,?,?,?,?)").run("bad", "visitor", "bad", "/projects", 1, 1), /readonly/i);
    const stores = await Promise.all([
      import("../src/lib/savedViews.ts"), import("../src/lib/reviewDecisions.ts"),
      import("../src/lib/integrationStore.ts"), import("../src/lib/closeoutStore.ts"),
    ]);
    assert.deepEqual(stores[0].listSavedViews("visitor"), []);
    assert.deepEqual(stores[0].listWatchItems("visitor"), []);
    assert.equal(stores[1].governanceDecisions("visitor").size, 0);
    assert.equal(stores[2].listManifests().length, 1);
    assert.equal(stores[3].listCloseoutProfiles().length, 1);
    const { runDashboard, toolStatus } = await import("../src/lib/dashboards/engine.ts");
    for (const spec of TOOL_SPECS) {
      assert.equal(toolStatus(spec).enabled, true, spec.name);
      const dashboard = runDashboard(spec);
      assert.equal(dashboard.charts.length, spec.charts.length);
      assert.equal(dashboard.kpis.length, spec.kpis.length);
    }
    const { assessCloseoutProject } = await import("../src/lib/closeoutEngine.ts");
    const { evaluateIntegration } = await import("../src/lib/integrationAnalysis.ts");
    const { getDataHealth } = await import("../src/lib/dataHealth.ts");
    const { closeoutPortfolioStatus } = await import("../src/lib/closeoutPortfolio.ts");
    assert.ok(assessCloseoutProject("00000001-0000-4000-8000-000000000001"));
    assert.ok(evaluateIntegration(stores[2].listManifests()[0], DEMO_SNAPSHOT_AT).checks.length);
    assert.equal(getDataHealth(DEMO_SNAPSHOT_AT).readyToolCount, 21);
    assert.ok(closeoutPortfolioStatus());
    closeDb();
    assert.deepEqual(getDb().prepare("SELECT * FROM projects").all(), rows);
    assert.equal(fs.existsSync(forbidden), false);
  } finally { closeDb(); fs.rmSync(temp, { recursive: true, force: true }); delete process.env.DATA_DIR; }
});

test("anonymous preferences use the browser demo namespace and reject hostile or malformed links", async () => {
  const { savedViewsOwner } = await import("../src/lib/savedViews.ts");
  const { requireSession } = await import("../src/lib/aps/auth.ts");
  const owner = savedViewsOwner(await requireSession());
  assert.equal(owner, "demo:browser");
  assert.ok(demoPreferencesKey(owner));
  assert.equal(demoPreferencesKey(null), null);
  assert.equal(safeDemoViewPath("//attacker.example"), null);
  assert.equal(safeDemoViewPath("https://attacker.example"), null);
  assert.equal(safeDemoViewPath("/api/aps/logout"), null);
  assert.equal(safeDemoViewPath("/projects?sort=name"), "/projects?sort=name");
  const view = { id: "example", name: "Projects", path: "/projects", createdAt: 1, updatedAt: 1 };
  const state = parseDemoPreferences(JSON.stringify({ views: [view, { ...view, path: "javascript:alert(1)" }], watched: [], reviews: [] }));
  assert.deepEqual(state.views, [view]);
  assert.deepEqual(parseDemoPreferences("not JSON"), { views: [], watched: [], reviews: [] });
});
