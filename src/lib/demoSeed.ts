import { DatabaseSync } from "node:sqlite";
import { DEMO_HUB_ID } from "./demoConfig";
import { sampleExtractTables } from "./demoFixtures";

/** Demo data is generated entirely in process. It never uses APS or the live cache. */
const SEED_VERSION = 1;
/** Stable across cold starts and visitors. These dates are part of the fictional sample. */
export const DEMO_SNAPSHOT_AT = Date.UTC(2026, 9, 1, 12, 0, 0);
const DEMO_ACTOR = "demo.admin@example.com";
type Row = Record<string, string | number>;

function fakeId(group: number, index: number): string {
  return `${String(group).padStart(8, "0")}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}
function iso(now: number, daysAgo: number): string {
  return new Date(now - daysAgo * 86_400_000).toISOString();
}
function sqlIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}
function sanitize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "col";
}

/** Mirrors the lazy module-owned schemas needed by the synthetic tour without calling getDb(). */
function ensureTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_seed_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, seeded_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, status TEXT, type TEXT, platform TEXT,
      job_number TEXT, member_count INTEGER, sheet_count INTEGER, company_count INTEGER, created_at TEXT,
      updated_at TEXT, last_sign_in TEXT, raw TEXT NOT NULL, synced_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
      source_file TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, occurred_ms INTEGER, occurred_at TEXT,
      project_id TEXT, actor_id TEXT, actor_name TEXT, actor_email TEXT, service TEXT, action TEXT,
      target_type TEXT, target_name TEXT, raw TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS extract_jobs (job_id TEXT PRIMARY KEY, request_id TEXT, status TEXT,
      completion_status TEXT, created_at TEXT, started_at TEXT, completed_at TEXT, start_date TEXT,
      end_date TEXT, service_groups TEXT, created_by_email TEXT, ingested_at INTEGER, ingest_error TEXT,
      activity_rows INTEGER NOT NULL DEFAULT 0, raw TEXT);
    CREATE TABLE IF NOT EXISTS extract_files (job_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER, rows INTEGER,
      skipped INTEGER NOT NULL DEFAULT 0, ingested_at INTEGER, PRIMARY KEY(job_id,name));
    CREATE TABLE IF NOT EXISTS dataset_tables (name TEXT PRIMARY KEY, sql_name TEXT NOT NULL, columns TEXT NOT NULL,
      row_count INTEGER NOT NULL, truncated INTEGER NOT NULL DEFAULT 0, uploaded_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dataset_uploads (id TEXT PRIMARY KEY, file_name TEXT, size INTEGER, tables INTEGER,
      rows INTEGER, uploaded_at INTEGER NOT NULL, notes TEXT);
    CREATE TABLE IF NOT EXISTS data_connector_requests (id TEXT PRIMARY KEY, raw TEXT NOT NULL, last_seen_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS data_connector_request_refreshes (id INTEGER PRIMARY KEY CHECK(id=1), refreshed_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS data_health_schema_baseline (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL,
      captured_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS integration_manifests (id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT);
    CREATE TABLE IF NOT EXISTS integration_manifest_revisions (manifest_id TEXT NOT NULL, version INTEGER NOT NULL,
      body TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT, PRIMARY KEY(manifest_id,version));
    CREATE TABLE IF NOT EXISTS closeout_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL,
      business_unit TEXT NOT NULL, project_type TEXT NOT NULL, required_domains TEXT NOT NULL,
      required_asset_fields TEXT NOT NULL, region TEXT NOT NULL DEFAULT '', delivery_model TEXT NOT NULL DEFAULT '',
      rules TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS closeout_deliverables (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, domain TEXT NOT NULL,
      label TEXT NOT NULL, external_id TEXT NOT NULL, required_metadata TEXT NOT NULL, project_id TEXT,
      name_pattern TEXT NOT NULL DEFAULT '', folder_path TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS closeout_assignments (project_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
      assigned_by TEXT NOT NULL, assigned_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS closeout_live_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      collected_at INTEGER NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS closeout_selected_records (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      domain TEXT NOT NULL, external_id TEXT NOT NULL, version_id TEXT, source_revision TEXT NOT NULL,
      source_kind TEXT NOT NULL, name TEXT NOT NULL, selected_by TEXT NOT NULL,
      selected_at INTEGER NOT NULL, is_current INTEGER NOT NULL DEFAULT 1);
  `);
}

function remapTables(hubId: string, now: number): { tables: Record<string, Row[]>; projectIds: string[]; userIds: string[]; companyIds: string[] } {
  const originals = sampleExtractTables(now);
  const projectMap = new Map(originals.admin_projects.map((row, index) => [String(row.id), fakeId(1, index)]));
  const userMap = new Map(originals.admin_users.map((row, index) => [String(row.id), fakeId(2, index)]));
  const companyMap = new Map(originals.admin_companies.map((row, index) => [String(row.id), fakeId(3, index)]));
  const translate = (value: string | number): string | number => typeof value === "string" ?
    projectMap.get(value) ?? userMap.get(value) ?? companyMap.get(value) ?? value : value;
  const tables = Object.fromEntries(Object.entries(originals).map(([name, rows]) => [name,
    rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, key === "bim360_account_id" ? hubId : translate(value)])) as Row)])) as Record<string, Row[]>;
  const projectIds = [...projectMap.values()];
  const userIds = [...userMap.values()];
  const companyIds = [...companyMap.values()];
  // Deliberate, visible exceptions make governance and lifecycle screens useful.
  tables.admin_projects[2].job_number = "";
  tables.admin_projects[5].end_date = iso(now, 90);
  tables.admin_projects[6].status = "archived";
  tables.admin_projects[7].status = "pending";
  tables.admin_users[5].status = "inactive";
  tables.admin_users[5].last_sign_in = iso(now, 240);
  tables.admin_project_user_roles = tables.admin_project_users.slice(0, 24).map((row, index) => ({
    bim360_account_id: hubId, bim360_project_id: row.bim360_project_id, user_id: row.user_id,
    role_id: `role-${index % 5}`, name: ["Project Manager", "Architect", "Engineer", "Field Lead", "Owner"][index % 5],
  }));
  const primary = projectIds[0];
  tables.assets_assets.push({ id: "demo-asset-ahu-1", bim360_account_id: hubId, bim360_project_id: primary,
    name: "AHU-1", client_asset_id: "AHU-1", category: "HVAC", status: "Installed", location_path: "Building A/Level 1",
    location_id: "demo-location-1", serial_number: "SN-001", barcode: "DEMO-0001", updated_at: iso(now, 1) });
  tables.issues_issues.push({ issue_id: "demo-issue-1", bim360_account_id: hubId, bim360_project_id: primary,
    title: "AHU commissioning observation", status: "open", created_at: iso(now, 8), due_date: iso(now, -3) });
  tables.rfis_rfis.push({ id: "demo-rfi-1", bim360_account_id: hubId, bim360_project_id: primary,
    title: "AHU access clearance", status: "closed", created_at: iso(now, 12) });
  tables.forms_forms.push({ id: "demo-form-1", bim360_account_id: hubId, bim360_project_id: primary,
    name: "AHU prestart checklist", status: "closed", created_at: iso(now, 5) });
  tables.submittalsacc_items.push({ id: "demo-submittal-1", bim360_account_id: hubId, bim360_project_id: primary,
    title: "AHU O&M manual", status_value: "Closed", response_value: "Approved", created_at: iso(now, 15) });
  tables.photos_photos.push({ id: "demo-photo-1", bim360_account_id: hubId, bim360_project_id: primary,
    title: "AHU installed.jpg", status: "active", taken_on: iso(now, 2) });
  tables.files_files = [
    { id: "demo-folder-1", project_id: primary, record_kind: "folder", name: "Closeout", folder_path: "Project Files/Closeout" },
    { id: "demo-file-1", item_id: "demo-file-1", project_id: primary, record_kind: "file",
      name: "AHU-1-OM-Manual.pdf", folder_path: "Project Files/Closeout",
      version_id: "urn:adsk.wipprod:fs.file:vf.demoFile1?version=2", is_latest: "true", discipline: "Mechanical" },
  ];
  tables.locations_locations = [{ id: "demo-location-1", project_id: primary,
    name: "Level 1", path: "Building A/Level 1" }];
  const linked = [
    ["files", "demo-file-1"], ["forms", "demo-form-1"], ["issues", "demo-issue-1"],
    ["rfis", "demo-rfi-1"], ["submittals", "demo-submittal-1"],
    ["photos", "demo-photo-1"], ["locations", "demo-location-1"],
  ];
  tables.relationships_relationships = linked.map(([domain, id], index) => ({
    id: `demo-relation-${index + 1}`, project_id: primary, relationship_type: "references",
    entities: JSON.stringify([{ id: "demo-asset-ahu-1", domain: "assets" }, { id, domain }]),
  }));
  return { tables, projectIds, userIds, companyIds };
}

function seedDataset(db: DatabaseSync, tables: Record<string, Row[]>, now: number): void {
  const oldUpload = now - 6 * 86_400_000;
  const recentUpload = now - 2 * 3_600_000;
  let oldCount = 0; let recentCount = 0; let totalRows = 0;
  const snapshot: Record<string, string[]> = {};
  const registry = db.prepare(`INSERT INTO dataset_tables (name,sql_name,columns,row_count,truncated,uploaded_at)
    VALUES (?,?,?,?,0,?)`);
  for (const [name, rows] of Object.entries(tables).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !rows.length) continue;
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const seen = new Set<string>();
    const columns = headers.map((header) => {
      let sqlName = sanitize(header);
      while (seen.has(sqlName)) sqlName += "_";
      seen.add(sqlName);
      return { name: header, sqlName };
    });
    const sqlName = "ds_" + sanitize(name);
    db.exec(`CREATE TABLE ${sqlIdentifier(sqlName)} (${columns.map((column) => `${sqlIdentifier(column.sqlName)} TEXT`).join(",")})`);
    const statement = db.prepare(`INSERT INTO ${sqlIdentifier(sqlName)} (${columns.map((column) => sqlIdentifier(column.sqlName)).join(",")})
      VALUES (${columns.map(() => "?").join(",")})`);
    for (const row of rows) statement.run(...columns.map((column) => row[column.name] == null || row[column.name] === "" ? null : String(row[column.name])));
    const old = ["assets_assets", "rfis_rfis", "rfis_category"].includes(name);
    registry.run(name, sqlName, JSON.stringify(columns), rows.length, (old ? oldUpload : recentUpload) - 1_000);
    if (old) oldCount++; else recentCount++;
    totalRows += rows.length;
    snapshot[name] = headers;
  }
  const upload = db.prepare(`INSERT INTO dataset_uploads (id,file_name,size,tables,rows,uploaded_at,notes) VALUES (?,?,?,?,?,?,?)`);
  upload.run(fakeId(5, 0), "SYNTHETIC DEMO · older reporting snapshot", 0, oldCount, 0, oldUpload,
    JSON.stringify({ provenance: "synthetic_demo", note: "Fictional, local-only data. No APS extract was ingested." }));
  upload.run(fakeId(5, 1), "SYNTHETIC DEMO · current reporting snapshot", 0, recentCount, totalRows, recentUpload,
    JSON.stringify({ provenance: "synthetic_demo", note: "Fictional, local-only data. No APS extract was ingested." }));
  // Show a small, explicit schema drift example in Data Health.
  snapshot.assets_assets = snapshot.assets_assets.filter((column) => column !== "Category Name").concat("legacy_status");
  db.prepare("INSERT INTO data_health_schema_baseline (id,snapshot,captured_at) VALUES (1,?,?)")
    .run(JSON.stringify(snapshot), oldUpload);
}

function seedProjects(db: DatabaseSync, projectIds: string[], tables: Record<string, Row[]>, now: number): void {
  const insert = db.prepare(`INSERT INTO projects (id,name,status,type,platform,job_number,member_count,sheet_count,
    company_count,created_at,updated_at,last_sign_in,raw,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  tables.admin_projects.forEach((row, index) => {
    const memberships = new Set(tables.admin_project_users
      .filter((member) => member.bim360_project_id === projectIds[index])
      .map((member) => String(member.user_id)));
    const raw = { ...row, id: projectIds[index], region: index < 4 ? "Northwest" : "Mid Atlantic",
      delivery_model: index % 2 ? "Design Bid Build" : "Design Build",
      demo: true, source: "synthetic_demo" };
    insert.run(projectIds[index], row.name, row.status, row.type, "acc", row.job_number || null,
      memberships.size, 40 + index * 17, 3 + index, row.created_at, row.updated_at,
      index === 5 ? iso(now, 200) : row.last_sign_in, JSON.stringify(raw), now - 30 * 60_000);
  });
}

function seedActivities(db: DatabaseSync, tables: Record<string, Row[]>, now: number): number {
  const people = new Map(tables.admin_users.map((row) => [String(row.autodesk_id), row]));
  const source = tables.activities_docs_activities;
  const insert = db.prepare(`INSERT INTO activities (job_id,source_file,fingerprint,occurred_ms,occurred_at,
    project_id,actor_id,actor_name,actor_email,service,action,target_type,target_name,raw)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const services = ["docs", "issues", "rfis", "forms", "admin", "sheets", "submittals"];
  source.forEach((row, index) => {
    const actor = people.get(String(row.created_by));
    const service = index % 4 === 0 ? services[index % services.length] : "docs";
    const when = new Date(now - ((index * 13) % 89) * 86_400_000 - (index % 24) * 3_600_000).toISOString();
    const action = String(row.activity_verb);
    insert.run(fakeId(6, 0), "activities_docs_activities.csv", `demo-activity-${index}`, Date.parse(when), when,
      row.bim360_project_id, row.created_by, actor?.name ?? null, actor?.email ?? null, service, action,
      row.object_object_type, row.object_display_name, JSON.stringify({ ...row, demo: true }));
  });
  return source.length;
}

function seedExtracts(db: DatabaseSync, hubId: string, projectIds: string[], activityRows: number, now: number): void {
  const requests = [
    { id: fakeId(7, 0), description: "Demo daily portfolio activity", scheduleInterval: "DAY", reoccuringInterval: 1,
      isActive: true, accountId: hubId, effectiveFrom: iso(now, -1), effectiveTo: iso(now, -180),
      dateRange: "PAST_7_DAYS", projectStatus: "active", serviceGroups: ["activities", "admin"] },
    { id: fakeId(7, 1), description: "Demo weekly governance snapshot", scheduleInterval: "WEEK", reoccuringInterval: 1,
      isActive: true, accountId: hubId, effectiveFrom: iso(now, -3), effectiveTo: iso(now, -180),
      dateRange: "PAST_7_DAYS", projectStatus: "all", serviceGroups: ["admin", "issues", "rfis", "assets"] },
    { id: fakeId(7, 2), description: "Demo selected project extract", scheduleInterval: "ONE_TIME",
      isActive: true, accountId: hubId, effectiveFrom: iso(now, 2), dateRange: "PAST_7_DAYS",
      projectIdList: projectIds.slice(0, 3), projectStatus: "all", serviceGroups: ["activities"] },
  ];
  const requestInsert = db.prepare("INSERT INTO data_connector_requests (id,raw,last_seen_at) VALUES (?,?,?)");
  for (const request of requests) requestInsert.run(request.id, JSON.stringify(request), now - 10 * 60_000);
  db.prepare("INSERT INTO data_connector_request_refreshes (id,refreshed_at) VALUES (1,?)").run(now - 15 * 60_000);
  const jobs = [
    { id: fakeId(6, 0), request: requests[0], status: "complete", completion: "success", ageHours: 2,
      groups: "activities,admin", ingestedAt: now - 75 * 60_000, activityRows, error: null },
    { id: fakeId(6, 1), request: requests[1], status: "complete", completion: "success", ageHours: 30,
      groups: "admin,issues,rfis,assets", ingestedAt: null, activityRows: 0, error: null },
    { id: fakeId(6, 2), request: requests[0], status: "failed", completion: "failed", ageHours: 50,
      groups: "activities", ingestedAt: null, activityRows: 0, error: "Synthetic example: service response timed out." },
    { id: fakeId(6, 3), request: requests[2], status: "running", completion: null, ageHours: 0.4,
      groups: "activities", ingestedAt: null, activityRows: 0, error: null },
  ];
  const insert = db.prepare(`INSERT INTO extract_jobs (job_id,request_id,status,completion_status,created_at,started_at,
    completed_at,start_date,end_date,service_groups,created_by_email,ingested_at,ingest_error,activity_rows,raw)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const job of jobs) {
    const when = now - job.ageHours * 3_600_000;
    const raw = { id: job.id, requestId: job.request.id, accountId: hubId, status: job.status,
      completionStatus: job.completion, createdAt: new Date(when).toISOString(),
      completedAt: job.status === "running" ? null : new Date(when + 10 * 60_000).toISOString(), demo: true };
    insert.run(job.id, job.request.id, job.status, job.completion, raw.createdAt, raw.createdAt,
      raw.completedAt, iso(now, 7), iso(now, 1), job.groups, DEMO_ACTOR, job.ingestedAt,
      job.error, job.activityRows, JSON.stringify(raw));
  }
  db.prepare(`INSERT INTO extract_files (job_id,name,size,rows,skipped,ingested_at) VALUES (?,?,?,?,0,?)`)
    .run(fakeId(6, 0), "activities_docs_activities.csv", 120_000, activityRows, now - 75 * 60_000);
}

function seedIntegration(db: DatabaseSync, projectIds: string[], now: number): void {
  const unknown = { status: "unknown", reference: null };
  const manifest = {
    id: fakeId(8, 0), version: 1, name: "Demo · Takeoff classification migration",
    customer: "Northwind Builders (synthetic)", owner: DEMO_ACTOR,
    description: "Fictional integration contract illustrating a change from numbered columns to structure-aware classification.",
    requestId: null, expectedProjectIds: projectIds.slice(0, 3), expectedServices: ["takeoff", "estimates"],
    dependencies: [{ path: "/data-connector/v1/accounts/{accountId}/jobs", version: "v1", note: "Demo dependency; no APS job is called." }],
    tables: [
      { table: "takeoff_takeoff_items", minRows: 100, maxAgeHours: 72, projectField: "bim360_project_id",
        serviceField: null, baselineRows: 240, baselineMinPct: 80 },
      { table: "takeoff_classification_systems", minRows: 1, maxAgeHours: 72, projectField: "bim360_project_id",
        serviceField: null, baselineRows: 4, baselineMinPct: 80 },
      { table: "estimates_estimation_instances", minRows: 50, maxAgeHours: 72, projectField: "bim360_project_id",
        serviceField: null, baselineRows: 120, baselineMinPct: 80 },
    ],
    fields: [
      { table: "takeoff_takeoff_items", field: "id", type: "text", maxNullPct: 0, consumerField: "takeoff_item_id" },
      { table: "takeoff_takeoff_items", field: "package_id", type: "text", maxNullPct: 0, consumerField: "package_id" },
      { table: "estimates_estimation_instances", field: "total_cost", type: "number", maxNullPct: 5, consumerField: "total_cost" },
    ],
    references: [{ sourceTable: "takeoff_takeoff_items", sourceField: "package_id",
      targetTable: "takeoff_packages", targetField: "id", maxMissingPct: 0 }],
    classification: { takeoff: true, estimates: true, quantities: true, sheetReferences: true },
    capabilities: { fiveLevels: unknown, structureAware: unknown, perProjectSwitch: unknown,
      quantityJoins: unknown, sheetUrnResolution: unknown },
    createdAt: now - 15 * 86_400_000, updatedAt: now - 2 * 86_400_000, updatedBy: DEMO_ACTOR,
  };
  const body = JSON.stringify(manifest);
  db.prepare(`INSERT INTO integration_manifests (id,version,body,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?)`)
    .run(manifest.id, 1, body, manifest.createdAt, manifest.updatedAt, DEMO_ACTOR);
  db.prepare(`INSERT INTO integration_manifest_revisions (manifest_id,version,body,updated_at,updated_by) VALUES (?,?,?,?,?)`)
    .run(manifest.id, 1, body, manifest.updatedAt, DEMO_ACTOR);
}

function seedCloseout(db: DatabaseSync, projectId: string, now: number): void {
  const profileId = fakeId(9, 0);
  const rules = { version: 1, files: [
    { id: "folder", label: "Closeout folder", folderPath: "Project Files/Closeout" },
    { id: "manual", label: "AHU O&M manual", folderPath: "Project Files/Closeout", extensions: ["pdf"],
      namePattern: "^AHU-1-OM-Manual\\.pdf$", requireLatestFinalVersion: true, requiredMetadata: ["discipline"] },
  ], assets: [{ id: "ahu", label: "Installed AHU", category: "HVAC", status: "Installed",
    location: "Building A/Level 1", attributes: { serial_number: "SN-001" },
    requireDocumentRelationship: true }],
  relationships: [{ id: "asset-doc", label: "Asset document link", fromDomain: "assets", toDomain: "files", minCount: 1 }],
  projectMetadata: [{ field: "region", equals: "Northwest" }, { field: "delivery_model", equals: "Design Build" }],
  statusPolicies: [{ domain: "issues", openStatuses: ["open", "pending"], terminalStatuses: ["closed"] }],
  };
  db.prepare(`INSERT INTO closeout_profiles (id,name,client,business_unit,project_type,required_domains,
    required_asset_fields,region,delivery_model,rules,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(profileId, "Demo · Hospital asset handover", "Northwind Health (synthetic)", "Buildings", "Hospital",
      JSON.stringify(["files", "assets", "issues", "forms", "submittals", "reviews", "rfis", "relationships"]),
      JSON.stringify(["serial_number"]), "Northwest", "Design Build", JSON.stringify(rules), DEMO_ACTOR, now - 30 * 86_400_000);
  db.prepare(`INSERT INTO closeout_deliverables (id,profile_id,domain,label,external_id,required_metadata,
    project_id,name_pattern,folder_path,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(fakeId(9, 1), profileId, "files", "AHU O&M manual", "", JSON.stringify(["discipline"]),
      projectId, "^AHU-1-OM-Manual\\.pdf$", "Project Files/Closeout", now - 29 * 86_400_000);
  db.prepare("INSERT INTO closeout_assignments (project_id,profile_id,assigned_by,assigned_at) VALUES (?,?,?,?)")
    .run(projectId, profileId, DEMO_ACTOR, now - 28 * 86_400_000);
  const versionId = "urn:adsk.wipprod:fs.file:vf.demoFile1?version=2";
  const sourceRows: Record<string, Record<string, unknown>[]> = {
    files: [
      { project_id: projectId, record_kind: "folder", id: "demo-folder-1", name: "Closeout", folder_path: "Project Files/Closeout" },
      { project_id: projectId, id: "demo-file-1", item_id: "demo-file-1", record_kind: "file", version_id: versionId,
        name: "AHU-1-OM-Manual.pdf", folder_path: "Project Files/Closeout", is_latest: true, discipline: "Mechanical" },
    ],
    assets: [{ project_id: projectId, id: "demo-asset-ahu-1", name: "AHU-1", category: "HVAC", status: "Installed",
      location_id: "demo-location-1", location_path: "Building A/Level 1", serial_number: "SN-001" }],
    issues: [{ project_id: projectId, id: "demo-issue-1", title: "AHU commissioning observation", status: "open" }],
    forms: [{ project_id: projectId, id: "demo-form-1", name: "AHU prestart checklist", status: "closed" }],
    submittals: [{ project_id: projectId, id: "demo-submittal-1", title: "AHU O&M manual", status: "closed" }],
    reviews: [{ project_id: projectId, id: "demo-review-1", record_kind: "review", status: "CLOSED" },
      { project_id: projectId, id: "demo-review-version-1", record_kind: "review-version", version_id: versionId,
        review_id: "demo-review-1", review_status: "CLOSED", approval_status: "Approved" }],
    rfis: [{ project_id: projectId, id: "demo-rfi-1", title: "AHU access clearance", status: "closed" }],
    relationships: [
      ...([ ["files", "demo-file-1"], ["forms", "demo-form-1"], ["issues", "demo-issue-1"],
        ["rfis", "demo-rfi-1"], ["submittals", "demo-submittal-1"],
        ["photos", "demo-photo-1"], ["locations", "demo-location-1"] ] as const)
        .map(([domain, id], index) => ({ project_id: projectId, id: `demo-relation-${index + 1}`,
          relationship_type: "references", entities: [{ id: "demo-asset-ahu-1", domain: "assets" }, { id, domain }] })),
    ],
  };
  const snapshotId = fakeId(9, 2);
  const sources = Object.entries(sourceRows).map(([domain, rows]) => ({ domain, rows, complete: true,
    error: null, collectedAt: now - 60 * 60_000, source: "live-aps" }));
  db.prepare(`INSERT INTO closeout_live_snapshots (id,project_id,collected_at,actor,payload) VALUES (?,?,?,?,?)`)
    .run(snapshotId, projectId, now - 60 * 60_000, DEMO_ACTOR, JSON.stringify(sources));
  db.prepare(`INSERT INTO closeout_selected_records (id,project_id,domain,external_id,version_id,source_revision,
    source_kind,name,selected_by,selected_at,is_current) VALUES (?,?,?,?,?,?,?,?,?,?,1)`)
    .run(fakeId(9, 3), projectId, "files", "demo-file-1", versionId, `live:${snapshotId}:files`,
      "live-aps", "AHU-1-OM-Manual.pdf", DEMO_ACTOR, now - 30 * 60_000);
}

/** Synchronous, idempotent seed for a separately selected DEMO database. */
export function seedDemoDatabase(db: DatabaseSync, hubId = DEMO_HUB_ID): void {
  if (hubId !== DEMO_HUB_ID) throw new Error("The demo seed only accepts the fixed synthetic hub ID.");
  ensureTables(db);
  const seeded = db.prepare("SELECT version FROM demo_seed_meta WHERE id=1").get() as { version: number } | undefined;
  if (seeded?.version === SEED_VERSION) return;
  if (seeded) throw new Error("This demo database has an older seed version; recreate the disposable demo DB to refresh it.");
  const existing = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
  if (existing.n > 0) throw new Error("Refusing to seed a database that already contains projects.");
  const now = DEMO_SNAPSHOT_AT;
  const { tables, projectIds } = remapTables(hubId, now);
  db.exec("BEGIN IMMEDIATE");
  try {
    seedDataset(db, tables, now);
    seedProjects(db, projectIds, tables, now);
    const activityRows = seedActivities(db, tables, now);
    seedExtracts(db, hubId, projectIds, activityRows, now);
    seedIntegration(db, projectIds, now);
    seedCloseout(db, projectIds[0], now);
    db.prepare("INSERT INTO demo_seed_meta (id,version,seeded_at) VALUES (1,?,?)").run(SEED_VERSION, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
