import assert from "node:assert/strict";
import test from "node:test";

import {
  executeDemoChange,
  isDemoEmail,
  previewDemoChange,
  type DemoWorkspace,
} from "../src/lib/demoSimulation.ts";

function workspace(): DemoWorkspace {
  return {
    projects: [
      { id: "p1", name: "Northwind Clinic", status: "active" },
      { id: "p2", name: "Northwind Warehouse", status: "active" },
      { id: "p3", name: "Northwind Library", status: "archived" },
    ],
    members: [
      { email: "Alex@Northwind.Example", name: "Alex", projectIds: ["p1"] },
      { email: "priya@example.com", name: "Priya", projectIds: ["p2"] },
    ],
  };
}

test("add preview deduplicates selections, skips existing access, and changes only the returned workspace", () => {
  const before = workspace();
  const original = structuredClone(before);
  const plan = previewDemoChange(before, "add", ["p1", "p1", "p2"],
    " ALEX@northwind.example\nAlex@northwind.example\nnew@northwind.example",
    ["Docs", "Docs", "Build"]);

  assert.equal(plan.changes.length, 3);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0], /already a member/);
  assert.deepEqual(plan.products, ["Docs", "Build"]);
  assert.deepEqual(before, original, "preview must be read-only");

  const after = executeDemoChange(before, plan);
  assert.deepEqual(before, original, "execute must preserve its input for reset");
  assert.deepEqual(after.members.find((member) => member.email === "Alex@Northwind.Example")?.projectIds,
    ["p1", "p2"]);
  assert.equal(after.members.filter((member) => member.email.toLowerCase() === "alex@northwind.example").length, 1);
  assert.deepEqual(after.members.find((member) => member.email === "new@northwind.example")?.projectIds,
    ["p1", "p2"]);
});

test("remove preview distinguishes existing memberships from absent ones", () => {
  const before = workspace();
  const plan = previewDemoChange(before, "remove", ["p1", "p2"],
    "alex@northwind.example\nmissing@northwind.example");
  assert.deepEqual(plan.changes.map((change) => [change.projectId, change.email]),
    [["p1", "alex@northwind.example"]]);
  assert.equal(plan.skipped.length, 3);
  assert.ok(plan.skipped.every((reason) => reason.includes("not a member")));

  const after = executeDemoChange(before, plan);
  assert.deepEqual(after.members[0].projectIds, []);
  assert.deepEqual(before.members[0].projectIds, ["p1"]);
  assert.throws(() => previewDemoChange(after, "remove", ["p1"], "alex@northwind.example"),
    /No changes remain/);
});

test("project creation skips names already present or repeated in the same batch", () => {
  const before = workspace();
  const plan = previewDemoChange(before, "projects", [],
    "northwind clinic\nNew Transit Hub\nNEW TRANSIT HUB\nCoastal School");
  assert.deepEqual(plan.changes.map((change) => change.name), ["New Transit Hub", "Coastal School"]);
  assert.equal(plan.skipped.length, 2);
  const after = executeDemoChange(before, plan);
  assert.equal(after.projects.length, before.projects.length + 2);
  assert.deepEqual(after.projects.slice(-2).map((project) => project.status), ["active", "active"]);
  assert.equal(before.projects.length, 3);
  assert.throws(() => previewDemoChange(after, "projects", [], "coastal school"), /No changes remain/);
});

test("archive preview skips nonactive projects and execute changes only its returned copy", () => {
  const before = workspace();
  const plan = previewDemoChange(before, "archive", ["p1", "p3", "p1"], "");
  assert.deepEqual(plan.changes.map((change) => change.projectId), ["p1"]);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0], /already archived/);
  const after = executeDemoChange(before, plan);
  assert.equal(after.projects.find((project) => project.id === "p1")?.status, "archived");
  assert.equal(before.projects.find((project) => project.id === "p1")?.status, "active");
});

test("only fictional addresses can enter add or remove simulations", () => {
  assert.equal(isDemoEmail("test@example.com"), true);
  assert.equal(isDemoEmail("alex@northwind.example"), true);
  assert.equal(isDemoEmail("real@company.com"), false);
  for (const task of ["add", "remove"] as const) {
    assert.throws(() => previewDemoChange(workspace(), task, ["p1"], "real@company.com"),
      /Use fictional addresses/);
  }
  assert.throws(() => previewDemoChange(workspace(), "add", ["unknown"], "new@northwind.example"),
    /sample workspace/);
});
