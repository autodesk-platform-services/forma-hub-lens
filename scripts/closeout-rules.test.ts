import assert from "node:assert/strict";
import test from "node:test";
import { compileCloseoutNamePattern, defaultCloseoutRules, evaluateCloseoutRules,
  type CloseoutRuleConfig } from "../src/lib/closeoutRules.ts";
import type { CloseoutSource } from "../src/lib/closeoutEngine.ts";
import type { SelectedRecord } from "../src/lib/closeoutStore.ts";

const source = (domain: CloseoutSource["domain"], rows: Record<string, unknown>[], complete = true): CloseoutSource => ({
  domain, rows, kind: "live-aps", table: null, revision: `live:${domain}:1`, collectedAt: 1,
  complete, coverage: complete ? "verified-live" : "unverified", note: null, rowCount: rows.length,
});
const version = "urn:adsk.wipprod:fs.file:vf.test?version=2";
const selection: SelectedRecord = {
  id: "selection", projectId: "project", domain: "files", externalId: "file-1", versionId: version,
  sourceRevision: "live:files:1", sourceKind: "live-aps", name: "Final-AsBuilt.pdf",
  selectedBy: "admin", selectedAt: 1,
};
const base = () => ({ rules: defaultCloseoutRules(), sources: [] as CloseoutSource[],
  selections: [] as SelectedRecord[], expected: [] });

test("profile rules are opt-in, and an explicitly empty folder can satisfy a folder requirement", () => {
  const input = base();
  input.sources = [source("issues", [{ id: "open-1", status: "open" }]),
    source("files", [{ record_kind: "folder", id: "folder-1", name: "Closeout", folder_path: "Project Files/Closeout" }])];
  assert.deepEqual(evaluateCloseoutRules(input), []);
  input.rules.files = [{ id: "folder", label: "Closeout folder", folderPath: "/Project Files//Closeout/" }];
  assert.deepEqual(evaluateCloseoutRules(input), []);
  input.rules.files.push({ id: "missing-folder", label: "O&M folder", folderPath: "Project Files/O&M" });
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => [item.code, item.kind]), [["required-folder-missing", "blocker"]]);
});

test("file rules require matching path, extension, name and a pinned latest exact version", () => {
  const rules = defaultCloseoutRules();
  rules.files = [{ id: "asbuilt", label: "As-built", folderPath: "Project Files/Closeout", extensions: ["pdf"],
    namePattern: "^Final-AsBuilt\\.pdf$", requireLatestFinalVersion: true, requiredMetadata: ["discipline"] }];
  const files = source("files", [{ id: "file-1", item_id: "file-1", version_id: version, name: "Final-AsBuilt.pdf",
    folder_path: "Project Files/Closeout", is_latest: true, discipline: "Civil" }]);
  const input = { rules, sources: [files], selections: [selection], expected: [] };
  assert.deepEqual(evaluateCloseoutRules(input), []);
  input.selections = [];
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => [item.code, item.kind]), [["latest-final-version-missing", "blocker"]]);
  input.selections = [selection];
  delete files.rows[0].is_latest;
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => [item.code, item.kind]), [["latest-final-version-missing", "unknown"]]);
  files.rows[0].is_latest = true;
  files.rows[0].name = "Draft-AsBuilt.dwg";
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => [item.code, item.kind]), [["required-file-missing", "blocker"]]);
  files.complete = false; files.coverage = "unverified";
  assert.equal(evaluateCloseoutRules(input)[0].kind, "unknown");
});

test("asset filters, document links and relationship rules need explicit endpoint evidence", () => {
  const rules = defaultCloseoutRules();
  rules.assets = [{ id: "pump", label: "Turnover pump", category: "Mechanical", status: "Installed",
    location: "Building A/Level 1", attributes: { Serial: "P-001" }, requireDocumentRelationship: true,
    requiredMetadata: ["Serial"] }];
  rules.relationships = [{ id: "asset-doc", label: "Asset to document", fromDomain: "assets", toDomain: "files",
    relationshipType: "references" }];
  const assets = source("assets", [{ id: "asset-1", category: "Mechanical", status: "Installed",
    location_path: "Building A/Level 1", Serial: "P-001" }]);
  const files = source("files", [{ id: "file-1", item_id: "file-1", version_id: version,
    name: "Pump manual.pdf", folder_path: "Closeout" }]);
  const relationships = source("relationships", [{ id: "edge-1", relationship_type: "references",
    entities: [{ id: "asset-1", domain: "assets" }, { id: "file-1", domain: "files" }] }]);
  const input = { rules, sources: [assets, relationships, files], selections: [selection], expected: [] };
  assert.deepEqual(evaluateCloseoutRules(input), []);
  input.selections = [];
  assert.ok(evaluateCloseoutRules(input).some((item) => item.code === "asset-document-unpinned" && item.kind === "blocker"));
  input.selections = [selection];
  files.rows = [];
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => item.kind), ["unknown", "unknown", "blocker"]);
  files.rows = [{ id: "file-1", item_id: "file-1", version_id: version,
    name: "Pump manual.pdf", folder_path: "Closeout" }];
  relationships.rows = [];
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => [item.code, item.kind]),
    [["asset-document-missing", "blocker"], ["required-relationship-missing", "blocker"]]);
  relationships.rows = [{ id: "unparseable" }];
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => item.kind), ["unknown", "unknown"]);
});

test("expected deliverables can match a unique name and folder without a preexisting APS ID", () => {
  const files = source("files", [{ id: "file-1", item_id: "file-1", version_id: version,
    name: "Final-AsBuilt.pdf", folder_path: "Project Files/Closeout", is_latest: true, discipline: "Civil" }]);
  const expected = [{ id: "exp", profileId: "profile", projectId: null, domain: "files" as const, label: "As-built",
    externalId: "", namePattern: "^Final-AsBuilt\\.pdf$", folderPath: "Project Files/Closeout",
    requiredMetadata: ["discipline"], createdAt: 1 }];
  const input = { ...base(), sources: [files], selections: [selection], expected };
  assert.deepEqual(evaluateCloseoutRules(input), []);
  expected[0].folderPath = "Project Files/Wrong";
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => [item.code, item.kind]), [["missing-deliverable", "blocker"]]);
  expected[0].folderPath = "Project Files/Closeout";
  files.rows.push({ ...files.rows[0], id: "file-2", item_id: "file-2" });
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => [item.code, item.kind]), [["ambiguous-deliverable", "unknown"]]);
});

test("project metadata distinguishes missing source fields from blank required values", () => {
  const rules: CloseoutRuleConfig = defaultCloseoutRules();
  rules.projectMetadata = [{ field: "region", label: "Region" }, { field: "delivery_model", label: "Delivery model", equals: "Design Build" }];
  const input = { ...base(), rules, projectMetadata: { region: "", delivery_model: "Design Bid Build" } };
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => item.kind), ["blocker", "blocker"]);
  delete (input.projectMetadata as Record<string, unknown>).region;
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => item.kind), ["unknown", "blocker"]);
});

test("only an explicit status policy treats open records as blockers; unsafe patterns are rejected", () => {
  const input = { ...base(), sources: [source("issues", [{ id: "issue-1", status: "open" }])] };
  assert.deepEqual(evaluateCloseoutRules(input), []);
  input.rules.statusPolicies = [{ domain: "issues", openStatuses: ["open"], terminalStatuses: ["closed"] }];
  assert.deepEqual(evaluateCloseoutRules(input).map((item) => item.code), ["open-record"]);
  assert.equal(compileCloseoutNamePattern("(a+)+$"), null);
  assert.ok(compileCloseoutNamePattern("^Final-.*\\.pdf$"));
});
