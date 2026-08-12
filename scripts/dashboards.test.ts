/**
 * End-to-end check of the dataset pipeline: ingest a Data Connector-shaped ZIP,
 * then evaluate every tool's dashboard against it.
 *
 * Run with: npm run test:dashboards
 * (needs --conditions=react-server so the `server-only` guard resolves to a no-op)
 */

import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { ingestZip, listTables, getTable } = await import("../src/lib/dataset.ts");
const { TOOL_SPECS } = await import("../src/lib/dashboards/specs.ts");
const { runDashboard, toolStatus } = await import("../src/lib/dashboards/engine.ts");

const zipPath = path.join(workdir, "extract.zip");

before(() => {
  execFileSync(
    process.execPath,
    ["--conditions=react-server", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
     path.join(import.meta.dirname, "make-sample-extract.ts"), zipPath],
    { stdio: "pipe" },
  );
});

after(() => fs.rmSync(workdir, { recursive: true, force: true }));

test("ingests every CSV in the archive", async () => {
  const bytes = new Uint8Array(fs.readFileSync(zipPath));
  const summary = await ingestZip("extract.zip", bytes);
  assert.ok(summary.tables.length >= 35, `only ${summary.tables.length} tables loaded`);
  assert.ok(summary.totalRows > 3_000, `only ${summary.totalRows} rows loaded`);
  assert.equal(summary.skipped.length, 0, `skipped: ${JSON.stringify(summary.skipped)}`);
});

test("table names come from the CSV basename, as the PBIT templates expect", () => {
  const projects = getTable("admin_projects");
  assert.ok(projects, "admin_projects table missing");
  assert.equal(projects.rowCount, 8);
  assert.ok(projects.columns.some((c) => c.name === "name"));
  assert.ok(projects.columns.some((c) => c.name === "bim360_account_id"));
});

test("columns with spaces survive the round trip", () => {
  const activities = getTable("schedule_activities");
  assert.ok(activities);
  const status = activities.columns.find((c) => c.name === "Activity Status");
  assert.ok(status, "‘Activity Status’ column was dropped");
  assert.equal(status.sqlName, "activity_status");
});

test("all 21 tools are enabled by a full extract", () => {
  const disabled = TOOL_SPECS.filter((spec) => !toolStatus(spec).enabled);
  assert.deepEqual(
    disabled.map((s) => `${s.name} needs ${toolStatus(s).missing.join(",")}`),
    [],
  );
  assert.equal(TOOL_SPECS.length, 21);
});

test("every KPI on every dashboard resolves", () => {
  const broken: string[] = [];
  for (const spec of TOOL_SPECS) {
    for (const kpi of runDashboard(spec).kpis) {
      if (!kpi.available) broken.push(`${spec.name} / ${kpi.label}: ${kpi.reason}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every chart on every dashboard resolves and returns data", () => {
  const broken: string[] = [];
  const empty: string[] = [];
  for (const spec of TOOL_SPECS) {
    for (const chart of runDashboard(spec).charts) {
      if (!chart.available) {
        broken.push(`${spec.name} / ${chart.title}: ${chart.reason}`);
        continue;
      }
      const hasData = chart.kind === "table" ? (chart.rows?.length ?? 0) > 0 : chart.points.length > 0;
      if (!hasData) empty.push(`${spec.name} / ${chart.title}`);
    }
  }
  assert.deepEqual(broken, [], "charts failed to resolve");
  assert.deepEqual(empty, [], "charts resolved but returned no rows");
});

test("aggregates match direct SQL", async () => {
  const { getDb } = await import("../src/lib/db.ts");
  const db = getDb();
  const issues = TOOL_SPECS.find((s) => s.id === "issues")!;
  const result = runDashboard(issues);

  const total = db.prepare("SELECT COUNT(*) n FROM ds_issues_issues").get() as { n: number };
  const totalKpi = result.kpis.find((k) => k.label === "Issues");
  assert.equal(Number(totalKpi?.value), total.n);

  const closed = db
    .prepare("SELECT COUNT(*) n FROM ds_issues_issues WHERE status = 'closed'")
    .get() as { n: number };
  const closedKpi = result.kpis.find((k) => k.label === "Closed");
  assert.equal(Number(closedKpi?.value), closed.n);
  assert.ok(closed.n > 0 && closed.n < total.n, "test data should have a mix of statuses");
});

test("a joined dimension resolves to project names, not raw ids", () => {
  const issues = TOOL_SPECS.find((s) => s.id === "issues")!;
  const byProject = runDashboard(issues).charts.find((c) => c.title === "Issues by Project");
  assert.ok(byProject?.available);
  assert.ok(byProject.points.length > 1);
  assert.ok(
    byProject.points.some((p) => p.label.includes("Riverside Medical Center")),
    `expected project names, got: ${byProject.points.slice(0, 3).map((p) => p.label).join(", ")}`,
  );
});

test("month bucketing produces ordered YYYY-MM keys", () => {
  const issues = TOOL_SPECS.find((s) => s.id === "issues")!;
  const byMonth = runDashboard(issues).charts.find((c) => c.title === "Issues by Month");
  assert.ok(byMonth?.available);
  const keys = byMonth.points.map((p) => p.key);
  assert.ok(keys.every((k) => /^\d{4}-\d{2}$/.test(k)), `bad keys: ${keys.slice(0, 4)}`);
  assert.deepEqual(keys, [...keys].sort(), "months should come back in order");
});

test("a missing table degrades to an unavailable panel, not a crash", async () => {
  const { runChart } = await import("../src/lib/dashboards/engine.ts");
  const result = runChart({
    kind: "bar",
    title: "Nonexistent",
    table: "does_not_exist",
    category: { column: "whatever" },
    value: { agg: "count" },
  });
  assert.equal(result.available, false);
  assert.match(result.reason ?? "", /not in dataset/);
});

test("an unresolvable filter column disables the panel rather than widening it", async () => {
  const { runKpi } = await import("../src/lib/dashboards/engine.ts");
  const result = runKpi({
    label: "Bogus filter",
    table: "admin_projects",
    column: "id",
    agg: "count",
    where: [{ column: "no_such_column", equals: "x" }],
  });
  assert.equal(result.available, false);
});
