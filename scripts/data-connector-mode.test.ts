import assert from "node:assert/strict";
import test from "node:test";
import { dataConnectorExtractionMode } from "../src/lib/dataConnectorMode.ts";
test("CDC inventory distinguishes delta, full and mixed without treating partial extracts as full", () => {
  assert.equal(dataConnectorExtractionMode({ serviceGroups: ["issues"], dateRange: "YESTERDAY" }), "full");
  assert.equal(dataConnectorExtractionMode({ serviceGroups: ["cdcissues"], dateRange: "YESTERDAY" }), "delta");
  assert.equal(dataConnectorExtractionMode({ serviceGroups: ["cdcissues", "issues"], startDate: "2026-01-01" }), "mixed");
  assert.equal(dataConnectorExtractionMode({ serviceGroups: ["cdcissues"] }), "full");
  assert.equal(dataConnectorExtractionMode({}), "unknown");
});
