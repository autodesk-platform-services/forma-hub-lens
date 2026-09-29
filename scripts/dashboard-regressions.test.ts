import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-dashboard-regressions-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { ingestZip } = await import("../src/lib/dataset.ts");
const { runChart, runKpi } = await import("../src/lib/dashboards/engine.ts");
const { TOOL_SPECS } = await import("../src/lib/dashboards/specs.ts");
const { closeDb } = await import("../src/lib/db.ts");

after(() => {
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

const day = 86_400_000;
const past = new Date(Date.now() - 7 * day).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const future = new Date(Date.now() + 7 * day).toISOString().slice(0, 10);

const meetingRows = ["id,bim360_project_id,company_id,status"];
for (let series = 0; series < 10; series++) {
  for (let item = 0; item < 2; item++) {
    meetingRows.push(`a-${series}-${item},pa,ca,status-${series}`);
  }
}
for (let item = 0; item < 15; item++) meetingRows.push(`b-${item},pb,cb,main`);

const zip = zipSync({
  "admin_projects.csv": strToU8("id,name\npa,Project A\npb,Project B\n"),
  "admin_companies.csv": strToU8("id,name\nca,Company A\ncb,Company B\n"),
  "meetingminutes_meetings.csv": strToU8(meetingRows.join("\n") + "\n"),
  "submittalsacc_items.csv": strToU8(
    `id,status_value,due_date,created_at\n` +
    `past-open,Open,${past},${past}\n` +
    `future-open,Open,${future},${today}\n` +
    `today-open,Open,${today},${today}\n` +
    `past-closed,Closed,${past},${past}\n`,
  ),
});

test("stacked bars select categories by their complete totals and keep every series", async () => {
  await ingestZip("regressions.zip", zip);
  const meetings = TOOL_SPECS.find((spec) => spec.id === "meetings");
  assert.ok(meetings);
  const chart = meetings.charts.find((item) => item.title === "Meetings by Project");
  assert.ok(chart);
  const result = runChart({ ...chart, limit: 1 });
  assert.equal(result.available, true, result.reason);
  assert.equal(result.points.length, 10);
  assert.deepEqual([...new Set(result.points.map((point) => point.label))], ["Project A"]);
  assert.equal(result.points.reduce((total, point) => total + point.value, 0), 20);
});

test("overdue KPI and trend exclude future, today, and closed submittals", () => {
  const quality = TOOL_SPECS.find((spec) => spec.id === "quality-ddr");
  assert.ok(quality);
  const kpi = quality.kpis.find((item) => item.label === "Overdue Submittals");
  const chart = quality.charts.find((item) => item.title === "Overdue submittals trend");
  assert.ok(kpi);
  assert.ok(chart);
  assert.equal(runKpi(kpi).value, 1);
  assert.equal(runChart(chart).points.reduce((total, point) => total + point.value, 0), 1);
});

test("table charts can join two distinct dimension tables", () => {
  const result = runChart({
    kind: "table", title: "Two dimensions", table: "meetingminutes_meetings",
    columns: [
      { table: "admin_projects", column: "name", label: "Project" },
      { table: "admin_companies", column: "name", label: "Company" },
    ],
    limit: 1,
  });
  assert.equal(result.available, true, result.reason);
  assert.deepEqual(result.rows?.[0], { c0: "Project A", c1: "Company A" });
});

test("aggregates requiring a column report a clear unavailable reason", () => {
  const result = runKpi({ label: "Invalid sum", table: "admin_projects", agg: "sum" });
  assert.equal(result.available, false);
  assert.match(result.reason ?? "", /requires a column/);
});
