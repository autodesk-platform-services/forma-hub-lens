import assert from "node:assert/strict";
import test, { after } from "node:test";
import { runDashboard, toolStatus, runKpi } from "../src/lib/dashboards/engine.ts";
import { TOOL_SPECS } from "../src/lib/dashboards/specs.ts";
import { getDb, closeDb } from "../src/lib/db.ts";

after(closeDb);

test("all 21 dashboards render from the immutable fictional snapshot without outbound requests", () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("A demo dashboard attempted a network request"); };
  try {
    assert.equal(TOOL_SPECS.length, 21);
    const fingerprint = getDb().prepare("SELECT COUNT(*) AS n FROM activities").get();
    for (const spec of TOOL_SPECS) {
      const status = toolStatus(spec);
      assert.equal(status.enabled, true, `${spec.id}: missing ${status.missing.join(", ")}`);
      const result = runDashboard(spec);
      assert.equal(result.kpis.length, spec.kpis.length, spec.id);
      assert.equal(result.charts.length, spec.charts.length, spec.id);
      assert.ok(result.kpis.some((kpi) => kpi.available), `${spec.id} needs a meaningful sample KPI`);
      assert.doesNotThrow(() => JSON.stringify(result), spec.id);
    }
    assert.deepEqual(getDb().prepare("SELECT COUNT(*) AS n FROM activities").get(), fingerprint);
  } finally { globalThis.fetch = original; }
});

test("unresolvable dashboard columns stay visibly unavailable instead of widening a query", () => {
  const result = runKpi({ label: "Missing required column", table: "admin_projects", agg: "sum" });
  assert.equal(result.available, false);
  assert.match(result.reason ?? "", /requires a column/);
});
