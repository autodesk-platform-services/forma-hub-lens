import type { DatabaseSync } from "node:sqlite";

/** Create all read-side schemas before the synthetic snapshot is locked. No visitor writes. */
export function initializeDemoReadSchemas(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dataset_table_sources (
      table_name TEXT PRIMARY KEY, upload_id TEXT NOT NULL, hub_id TEXT NOT NULL,
      job_id TEXT NOT NULL, request_id TEXT NOT NULL, project_scope TEXT NOT NULL,
      service_groups TEXT NOT NULL, job_completed_at TEXT, source_file TEXT NOT NULL,
      source_bytes INTEGER NOT NULL, row_count INTEGER NOT NULL, truncated INTEGER NOT NULL,
      ingested_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_views (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_views_owner ON saved_views (owner_key, updated_at DESC);
    CREATE TABLE IF NOT EXISTS watchlist_items (
      owner_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_key, kind, target_id)
    );
    CREATE INDEX IF NOT EXISTS watchlist_owner ON watchlist_items (owner_key, created_at DESC);


    CREATE TABLE IF NOT EXISTS project_review_decisions (
      owner_key TEXT NOT NULL,
      area TEXT NOT NULL,
      project_id TEXT NOT NULL,
      rule TEXT NOT NULL,
      choice TEXT NOT NULL,
      until_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_key, area, project_id, rule)
    );
    CREATE INDEX IF NOT EXISTS project_review_decisions_owner
      ON project_review_decisions (owner_key, area, updated_at DESC);

CREATE TABLE IF NOT EXISTS provisioning_recipes (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, spec TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS provisioning_recipes_owner ON provisioning_recipes(owner_key); CREATE TABLE IF NOT EXISTS provisioning_templates (owner_key TEXT NOT NULL, template_id TEXT NOT NULL, name TEXT NOT NULL, classification TEXT NOT NULL, status TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY(owner_key,template_id));
CREATE TABLE IF NOT EXISTS integration_manifests (
    id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS integration_manifest_revisions (
    manifest_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
    updated_at INTEGER NOT NULL, updated_by TEXT,
    PRIMARY KEY (manifest_id, version)
  );
  CREATE TABLE IF NOT EXISTS integration_quality_runs (
    id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL, manifest_version INTEGER NOT NULL,
    evaluated_at INTEGER NOT NULL, result TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS integration_runs_manifest ON integration_quality_runs (manifest_id, evaluated_at DESC);
  CREATE TABLE IF NOT EXISTS integration_official_snapshots (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL,
    captured_at INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS integration_snapshots_kind ON integration_official_snapshots (kind, captured_at DESC);
  CREATE TABLE IF NOT EXISTS integration_api_notices (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_url TEXT NOT NULL, published_on TEXT,
    effective_on TEXT, affected_paths TEXT NOT NULL, description TEXT NOT NULL,
    recorded_at INTEGER NOT NULL, recorded_by TEXT
  );
  CREATE TABLE IF NOT EXISTS integration_monitor_state (
    id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0,
    interval_minutes INTEGER NOT NULL DEFAULT 360, last_run_at INTEGER, next_run_at INTEGER,
    last_error TEXT, running_until INTEGER
  );

    CREATE TABLE IF NOT EXISTS closeout_profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL,
      business_unit TEXT NOT NULL, project_type TEXT NOT NULL,
      required_domains TEXT NOT NULL, required_asset_fields TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '', delivery_model TEXT NOT NULL DEFAULT '',
      rules TEXT NOT NULL DEFAULT '{"version":1,"files":[],"assets":[],"relationships":[],"projectMetadata":[],"statusPolicies":[]}',
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_deliverables (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, domain TEXT NOT NULL,
      label TEXT NOT NULL, external_id TEXT NOT NULL, required_metadata TEXT NOT NULL,
      project_id TEXT, name_pattern TEXT NOT NULL DEFAULT '', folder_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(profile_id) REFERENCES closeout_profiles(id)
    );
    CREATE INDEX IF NOT EXISTS closeout_deliverables_profile ON closeout_deliverables(profile_id);
    CREATE TABLE IF NOT EXISTS closeout_deliverable_history (
      id TEXT PRIMARY KEY, deliverable_id TEXT NOT NULL, actor TEXT NOT NULL,
      operation TEXT NOT NULL, before_json TEXT, after_json TEXT,
      changed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_profile_rule_history (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, actor TEXT NOT NULL,
      rules TEXT NOT NULL, changed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_assignments (
      project_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
      assigned_by TEXT NOT NULL, assigned_at INTEGER NOT NULL,
      FOREIGN KEY(profile_id) REFERENCES closeout_profiles(id)
    );
    CREATE TABLE IF NOT EXISTS closeout_assignment_history (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      actor TEXT NOT NULL, assigned_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_source_attestations (
      project_id TEXT NOT NULL, domain TEXT NOT NULL, source_revision TEXT NOT NULL,
      actor TEXT NOT NULL, note TEXT NOT NULL, attested_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, domain, source_revision)
    );
    CREATE TABLE IF NOT EXISTS closeout_source_attestation_history (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, domain TEXT NOT NULL,
      source_revision TEXT NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL,
      attested_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_selected_records (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, domain TEXT NOT NULL,
      external_id TEXT NOT NULL, version_id TEXT, source_revision TEXT NOT NULL,
      source_kind TEXT NOT NULL, name TEXT NOT NULL,
      selected_by TEXT NOT NULL, selected_at INTEGER NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS closeout_selection_project
      ON closeout_selected_records(project_id, domain, is_current);
    CREATE TABLE IF NOT EXISTS closeout_selection_events (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, domain TEXT NOT NULL,
      external_id TEXT NOT NULL, operation TEXT NOT NULL, actor TEXT NOT NULL,
      changed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closeout_live_snapshots (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, collected_at INTEGER NOT NULL,
      actor TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS closeout_live_project
      ON closeout_live_snapshots(project_id, collected_at DESC);
    CREATE TABLE IF NOT EXISTS closeout_assessments (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      status TEXT NOT NULL, result TEXT NOT NULL, actor TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS closeout_assessments_project
      ON closeout_assessments(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS closeout_packages (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      assessment_id TEXT NOT NULL, status TEXT NOT NULL,
      manifest TEXT NOT NULL, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL,
      file_name TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(assessment_id) REFERENCES closeout_assessments(id)
    );
    CREATE INDEX IF NOT EXISTS closeout_packages_project
      ON closeout_packages(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS closeout_acceptances (
      id TEXT PRIMARY KEY, package_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL,
      actor TEXT NOT NULL, note TEXT NOT NULL, acknowledged_exceptions TEXT NOT NULL,
      accepted_at INTEGER NOT NULL,
      FOREIGN KEY(package_id) REFERENCES closeout_packages(id)
    );

`);
  db.prepare(`INSERT OR IGNORE INTO integration_monitor_state (id,enabled,interval_minutes,last_run_at,next_run_at,last_error,running_until) VALUES (1,0,360,NULL,NULL,NULL,NULL)`).run();
}
