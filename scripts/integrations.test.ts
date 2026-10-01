import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-integrations-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const store = await import("../src/lib/integrationStore.ts");
const official = await import("../src/lib/integrationOfficial.ts");
const { evaluateIntegration, captureRowBaselines, isIntegrationPreflightStale } = await import("../src/lib/integrationAnalysis.ts");
const { impactsForManifest, pathsOverlap } = await import("../src/lib/integrationImpact.ts");
const { runScheduledIntegrationChecks } = await import("../src/lib/integrationMonitor.ts");
const { ingestZip } = await import("../src/lib/dataset.ts");
const { rememberRequests } = await import("../src/lib/aps/dataConnector.ts");
const { closeDb } = await import("../src/lib/db.ts");
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; closeDb(); fs.rmSync(workdir, { recursive: true, force: true }); });

function form(): FormData {
  const value = new FormData();
  value.set("name", "Takeoff warehouse");
  value.set("customer", "Field analytics");
  value.set("owner", "Data Engineering");
  value.set("projectIds", "project-1");
  value.set("services", "takeoff\nclassifications");
  value.set("dependencies", "/classification/v1/accounts/{accountId}/trees | v1 | reads isBasedOnAccountTree");
  value.set("tables", "takeoff_quantity_definitions | 1 | 72 | project_id | | 80\nclassifications_nodes | 1 | 72 | | | 80");
  value.set("fields", "takeoff_quantity_definitions.classification1_node_id | uuid | 0 | classification_id");
  value.set("references", "takeoff_quantity_definitions.classification1_node_id | classifications_nodes.id | 0");
  value.set("class_takeoff", "on");
  value.set("class_quantities", "on");
  value.set("class_sheets", "on");
  for (const key of store.CAPABILITY_KEYS) value.set(`capability_${key}`, "unknown");
  return value;
}

test("manifest validation rejects unsafe API dependencies and stores versioned customer mapping", () => {
  const bad = form();
  bad.set("dependencies", "https://attacker.example/steal?token=secret");
  assert.throws(() => store.parseManifestForm(bad), /relative paths/);
  const first = store.parseManifestForm(form());
  store.saveManifest(first, "admin@example.test");
  const edited = form();
  edited.set("owner", "Platform Engineering");
  const second = store.parseManifestForm(edited, first);
  store.saveManifest(second, "admin@example.test");
  assert.equal(store.getManifest(first.id)?.version, 2);
  assert.equal(store.getManifest(first.id)?.owner, "Platform Engineering");
  assert.throws(() => store.saveManifest(second, "admin@example.test"), /changed since editing/);
  assert.deepEqual(store.listManifests().map((item) => item.id), [first.id]);
});

test("Autodesk JSON schema and changes shapes parse with service and type retained", () => {
  const schema = { serviceGroups: { classifications: { nodes: {
    id: { data_type: "UUID", ordinal_position: 1 }, name: { data_type: "STRING", ordinal_position: 2 },
  } }, takeoff: { quantity_definitions: { classification1_node_id: { data_type: "UUID", ordinal_position: 1 } } } } };
  const tables = official.parsePublishedTables(schema);
  assert.deepEqual(tables?.find((item) => item.service === "classifications")?.columns[0], { name: "id", type: "UUID" });
  assert.deepEqual(tables?.find((item) => item.table === "quantity_definitions")?.columns[0].name, "classification1_node_id");
  assert.equal(official.parsePublishedTables({ garbage: true }), null);
  const changes = official.parsePublishedChanges({ watermark: "2026-09", changes: [
    { service_group: "takeoff", table: "quantity_definitions", column: "classification3_node_id", change_type: "Added", notes: "new", year: 2026, month: 9, watermark: "2026-09" },
  ] });
  assert.equal(changes?.changes[0].serviceGroup, "takeoff");
  assert.equal(changes?.changes[0].column, "classification3_node_id");
});

test("public refresh uses only fixed Autodesk documentation URLs and persists captured source", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json(String(input).includes("/changes") ? { watermark: "w", changes: [] } : {
      quantity_definitions: { classification1_node_id: { data_type: "UUID", ordinal_position: 1 } },
    });
  }) as typeof fetch;
  const schema = await official.refreshPublishedSchema(["takeoff"]);
  const changes = await official.refreshPublishedChanges();
  assert.equal(schema.source, "autodesk_endpoint");
  assert.equal(changes.kind, "changes");
  assert.deepEqual(urls, [
    "https://developer.api.autodesk.com/data-connector/v1/doc/schema?name=takeoff&format=json",
    "https://developer.api.autodesk.com/data-connector/v1/doc/changes?format=json",
  ]);
  assert.equal(store.latestOfficialSnapshot("schema")?.digest.length, 64);
  await assert.rejects(() => official.refreshPublishedSchema(["evil"]), /configured/);
  assert.equal(urls.length, 2);
  globalThis.fetch = originalFetch;
});

test("classification preflight checks actual snapshot switches, all five columns, node and quantity joins while leaving code support unknown", async () => {
  const node = "11111111-1111-4111-8111-111111111111";
  await ingestZip("migration.zip", zipSync({
    "takeoff_quantity_definitions.csv": strToU8(`project_id,type_id,quantity_order,classification1_node_id,classification2_node_id,classification3_node_id,classification4_node_id,classification5_node_id\nproject-1,type-1,1,${node},,,,\n`),
    "takeoff_settings.csv": strToU8("project_id,forma_classifications\nproject-1,true\n"),
    "classifications_nodes.csv": strToU8(`id,name\n${node},Structure node\n`),
    "takeoff_takeoff_items.csv": strToU8("project_id,id,type_id,content_version\nproject-1,item-1,type-1,urn:adsk.wipprod:fs.file:vf.x?version=1\n"),
    "takeoff_quantities.csv": strToU8("project_id,item_id,quantity_order\nproject-1,item-1,1\n"),
  }));
  const manifest = store.listManifests()[0];
  const result = evaluateIntegration(manifest);
  const statuses = new Map(result.checks.map((entry) => [entry.id, entry.status]));
  assert.equal(statuses.get("class-columns:takeoff"), "pass");
  assert.equal(statuses.get("class-switch:takeoff"), "pass");
  assert.equal(statuses.get("class-node-refs"), "pass");
  assert.equal(statuses.get("class-quantities"), "pass");
  assert.equal(statuses.get("class-sheet-urn"), "review");
  assert.equal(statuses.get("code:fiveLevels"), "unknown");
  assert.equal(statuses.get("lineage:takeoff_quantity_definitions"), "review");
  assert.equal(statuses.get("implicit-source:takeoff_settings"), "review");
  const revision = captureRowBaselines(manifest, "admin@example.test");
  assert.equal(revision.version, 3);
  assert.equal(revision.tables[0].baselineRows, 1);
  assert.equal(evaluateIntegration(revision).checks.find((item) => item.id === "baseline:takeoff_quantity_definitions")?.status, "pass");
});

test("API watch matches declared template paths but does not infer code use", () => {
  const manifest = store.listManifests()[0];
  assert.equal(pathsOverlap("/classification/v1/accounts/{accountId}/trees", "/classification/v1/accounts/abc/trees"), true);
  const impacts = impactsForManifest(manifest, []);
  assert.equal(impacts.length, 1);
  assert.match(impacts[0].detail, /potential exposure/);
  assert.equal(impacts[0].effectiveOn, "2027-03-23");
});

test("a stored preflight becomes stale when a relevant local table is replaced", async () => {
  const manifest = store.listManifests()[0];
  const recorded = evaluateIntegration(manifest);
  store.recordRun(manifest, recorded);
  assert.equal(isIntegrationPreflightStale(manifest, recorded), false);
  await ingestZip("new-settings.zip", zipSync({
    "takeoff_settings.csv": strToU8("project_id,forma_classifications\nproject-1,true\nproject-2,false\n"),
  }));
  assert.equal(isIntegrationPreflightStale(manifest, recorded), true);
});

test("preflight blocks a cached extract request that excludes a declared project or classifications group", () => {
  const current = store.listManifests()[0];
  const edited = form();
  edited.set("requestId", "request-scoped");
  const linked = store.parseManifestForm(edited, current);
  store.saveManifest(linked, "admin@example.test");
  rememberRequests([{ id: "request-scoped", serviceGroups: ["takeoff"], projectIdList: ["other-project"] }], Date.now(), true);
  const preflight = evaluateIntegration(linked);
  assert.equal(preflight.checks.find((item) => item.id === "request")?.status, "fail");
  assert.equal(preflight.checks.find((item) => item.id === "request-projects")?.status, "fail");
  assert.match(preflight.checks.find((item) => item.id === "request")?.detail ?? "", /classifications/);
});

test("disabled scheduled monitor does not fetch public docs or create runs", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  const result = await runScheduledIntegrationChecks();
  assert.equal(result.ran, false);
  assert.equal(calls, 0);
  globalThis.fetch = originalFetch;
});

test("enabled scheduled monitor captures public documentation and stores a preflight once per interval", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json(String(input).includes("/changes") ? { watermark: "2026-09", changes: [] } : {
      nodes: { id: { data_type: "UUID", ordinal_position: 1 } },
    });
  }) as typeof fetch;
  store.configureIntegrationMonitor(true, 60);
  const first = await runScheduledIntegrationChecks();
  assert.equal(first.ran, true);
  assert.equal(first.manifestsChecked, 1);
  assert.equal(first.schemaRefreshed, true);
  assert.equal(first.changesRefreshed, true);
  assert.equal(urls.length, 4);
  assert.equal(store.latestRun(store.listManifests()[0].id)?.version, 4);
  assert.equal(store.getIntegrationMonitorState().lastError, null);
  const second = await runScheduledIntegrationChecks();
  assert.equal(second.ran, false);
  assert.equal(urls.length, 4);
  globalThis.fetch = originalFetch;
});
