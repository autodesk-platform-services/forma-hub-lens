import assert from "node:assert/strict";
import test from "node:test";
import { projectSort, sortProjectInventory } from "../src/lib/projectInventory.ts";
import type { ProjectActivityRow } from "../src/lib/queries.ts";

const rows: ProjectActivityRow[] = [
  { projectId: "b", name: "Busy", status: "active", type: null, memberCount: 20, sheetCount: 4, lastSignIn: null, events: 100, actors: 2, lastEventMs: 2000, services: "docs,issues" },
  { projectId: "c", name: "Quiet", status: "archived", type: null, memberCount: 0, sheetCount: 0, lastSignIn: null, events: 0, actors: 0, lastEventMs: null, services: null },
  { projectId: "a", name: "Active", status: "active", type: null, memberCount: 5, sheetCount: 10, lastSignIn: null, events: 10, actors: 8, lastEventMs: 1000, services: "docs,docs,cost,forms" },
  { projectId: "u", name: "Unknown", status: null, type: null, memberCount: null, sheetCount: null, lastSignIn: null, events: 1, actors: 1, lastEventMs: null, services: null },
];
const names = (sort: Parameters<typeof sortProjectInventory>[1]) => sortProjectInventory(rows, sort).map((row) => row.name);

test("membership and observed participation sort independently", () => {
  assert.deepEqual(names("members"), ["Busy", "Active", "Quiet", "Unknown"]);
  assert.deepEqual(names("actors"), ["Active", "Busy", "Unknown", "Quiet"]);
  assert.deepEqual(names("fewest_members"), ["Quiet", "Active", "Busy", "Unknown"]);
});

test("missing measurements sort after known values without implying zero or an old date", () => {
  assert.deepEqual(names("oldest_activity"), ["Active", "Busy", "Quiet", "Unknown"]);
  assert.deepEqual(names("recent"), ["Busy", "Active", "Quiet", "Unknown"]);
  assert.deepEqual(names("sheets"), ["Active", "Busy", "Quiet", "Unknown"]);
  assert.deepEqual(names("no_activity"), ["Quiet", "Active", "Busy", "Unknown"]);
  assert.deepEqual(names("services"), ["Active", "Busy", "Quiet", "Unknown"]);
  assert.deepEqual(names("status"), ["Active", "Busy", "Quiet", "Unknown"]);
  assert.deepEqual(rows.map((row) => row.name), ["Busy", "Quiet", "Active", "Unknown"]);
});

test("old sort URLs remain valid and invalid values use project name order", () => {
  assert.equal(projectSort("actors"), "actors");
  assert.equal(projectSort("members"), "members");
  assert.equal(projectSort("invalid"), "name");
  assert.equal(projectSort(["events"]), "name");
  assert.deepEqual(names(projectSort(undefined)), ["Active", "Busy", "Quiet", "Unknown"]);
});
