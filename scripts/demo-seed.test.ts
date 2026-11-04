import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DEMO_HUB_ID } from "../src/lib/demoConfig.ts";
import { sampleExtractTables } from "../src/lib/demoFixtures.ts";
import { seedDemoDatabase } from "../src/lib/demoSeed.ts";
import { TOOL_SPECS } from "../src/lib/dashboards/specs.ts";

test("synthetic demo seed is idempotent, separate and covers all dashboard source tables", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedDemoDatabase(db);
    const count = (name: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n);
    assert.equal(count("projects"), 8);
    assert.ok(count("activities") >= 800);
    assert.ok(count("dataset_tables") >= 40);
    assert.equal(count("extract_jobs"), 4);
    assert.equal(count("data_connector_requests"), 3);
    assert.equal(count("integration_manifests"), 1);
    assert.equal(count("closeout_live_snapshots"), 1);
    assert.equal(count("closeout_assignments"), 1);
    const tables = new Set((db.prepare("SELECT name FROM dataset_tables").all() as Array<{ name: string }>).map((row) => row.name));
    for (const spec of TOOL_SPECS) for (const required of spec.requires) {
      assert.ok(tables.has(required), `${spec.id} is missing ${required}`);
    }
    assert.ok(Object.keys(sampleExtractTables()).length >= 35);
    const projects = db.prepare("SELECT id,raw,member_count FROM projects").all() as Array<
      { id: string; raw: string; member_count: number }>;
    assert.ok(projects.every((project) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(project.id)));
    assert.ok(projects.every((project) => JSON.parse(project.raw).bim360_account_id === DEMO_HUB_ID));
    const memberships = db.prepare("SELECT bim360_project_id,user_id FROM ds_admin_project_users").all() as Array<
      { bim360_project_id: string; user_id: string }>;
    const membershipPairs = new Set(memberships.map((row) => `${row.bim360_project_id}:${row.user_id}`));
    assert.equal(membershipPairs.size, memberships.length, "one membership row per project and user");
    for (const project of projects) {
      const distinct = new Set(memberships.filter((row) => row.bim360_project_id === project.id)
        .map((row) => row.user_id));
      assert.equal(project.member_count, distinct.size, `member count for ${project.id}`);
    }
    const products = db.prepare("SELECT bim360_project_id,user_id FROM ds_admin_project_user_products").all() as Array<
      { bim360_project_id: string; user_id: string }>;
    assert.ok(products.every((row) => membershipPairs.has(`${row.bim360_project_id}:${row.user_id}`)),
      "product access belongs to a current sample membership");
    const emails = db.prepare("SELECT email FROM ds_admin_users").all() as Array<{ email: string }>;
    assert.ok(emails.every((row) => row.email.endsWith("@example.com")));
    const uploads = db.prepare("SELECT notes FROM dataset_uploads").all() as Array<{ notes: string }>;
    assert.ok(uploads.every((row) => JSON.parse(row.notes).provenance === "synthetic_demo"));
    seedDemoDatabase(db);
    assert.equal(count("projects"), 8);
    assert.equal(count("extract_jobs"), 4);
    assert.equal(count("activities"), 900);
    assert.throws(() => seedDemoDatabase(db, "real-hub-id"), /fixed synthetic hub ID/);
  } finally { db.close(); }
});

test("demo Closeout and classification fixtures are internally linked and explicitly synthetic", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedDemoDatabase(db);
    const snapshot = db.prepare("SELECT project_id,payload FROM closeout_live_snapshots").get() as { project_id: string; payload: string };
    const sources = JSON.parse(snapshot.payload) as Array<{ domain: string; rows: Array<Record<string, unknown>> }>;
    const files = sources.find((source) => source.domain === "files")!.rows;
    const selected = db.prepare("SELECT external_id,version_id,source_revision FROM closeout_selected_records").get() as
      { external_id: string; version_id: string; source_revision: string };
    assert.equal(selected.external_id, files.find((row) => row.record_kind === "file")?.id);
    assert.equal(selected.version_id, files.find((row) => row.record_kind === "file")?.version_id);
    assert.match(selected.source_revision, /^live:/);
    const relationships = sources.find((source) => source.domain === "relationships")!.rows;
    assert.ok(relationships.some((row) => (row.entities as Array<{ id: string }>).some((end) => end.id === "demo-asset-ahu-1")));
    const expected = db.prepare("SELECT external_id,name_pattern,folder_path FROM closeout_deliverables").get() as
      { external_id: string; name_pattern: string; folder_path: string };
    assert.equal(expected.external_id, "");
    assert.ok(expected.name_pattern && expected.folder_path);
    const manifest = JSON.parse((db.prepare("SELECT body FROM integration_manifests").get() as { body: string }).body) as
      { classification: Record<string, boolean>; name: string; capabilities: Record<string, { status: string }> };
    assert.match(manifest.name, /^Demo ·/);
    assert.equal(manifest.classification.takeoff, true);
    assert.ok(Object.values(manifest.capabilities).every((capability) => capability.status === "unknown"));
  } finally { db.close(); }
});
