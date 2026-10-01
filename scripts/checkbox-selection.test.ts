import assert from "node:assert/strict";
import test from "node:test";
import { hiddenSelectedValues, toggleShownSelection } from "../src/lib/checkboxSelection.ts";

test("bulk selection changes visible rows only and preserves filtered-out submitted IDs", () => {
  const selected = toggleShownSelection(["hidden-project"], ["visible-one", "visible-two"], 50);
  assert.deepEqual(selected, ["hidden-project", "visible-one", "visible-two"]);
  assert.deepEqual(hiddenSelectedValues(selected, ["visible-one", "visible-two"]), ["hidden-project"]);

  const submitted = new FormData();
  for (const id of ["visible-one", "visible-two", ...hiddenSelectedValues(selected, ["visible-one", "visible-two"])]) {
    submitted.append("projectIds", id);
  }
  assert.deepEqual(submitted.getAll("projectIds"), ["visible-one", "visible-two", "hidden-project"]);
  assert.deepEqual(toggleShownSelection(selected, ["visible-one", "visible-two"], 50), ["hidden-project"]);
});

test("select all shown does not partially exceed the 50-project limit", () => {
  const current = Array.from({ length: 49 }, (_, index) => `existing-${index}`);
  assert.deepEqual(toggleShownSelection(current, ["new-one", "new-two"], 50), current);
  assert.equal(toggleShownSelection(current, ["new-one"], 50).length, 50);
});
