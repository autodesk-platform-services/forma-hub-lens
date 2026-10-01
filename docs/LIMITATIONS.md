# Known limitations

- **No live cross-project activity endpoint.** Activity depends on asynchronous Data Connector extracts and the local SQLite cache.
- **Recurring APS requests do not auto-ingest.** Autodesk schedules future jobs, but Lens currently requires a user to refresh jobs and ingest completed activity CSVs. Persistent hosting alone does not add a background worker.
- **Extraction is quota-limited.** Autodesk caps extraction at 24 jobs per hub per 24 hours and 24 per user.
- **Activity history is limited to the last 12 months**, with a maximum 31-day window per request and replication lag of up to approximately 20 minutes.
- **Dashboards represent the hub-level page of each Power BI template**, not every page or every visual in the source templates.
- **Computed Power BI columns are not available in the CSV extracts.** The dashboard specs use the closest raw equivalent where necessary.
- **There is no hub-wide roles endpoint.** The Roles view depends on `admin_project_roles.csv` from the uploaded extract.
- **People and Access matrix are uploaded snapshots.** Missing, duplicate, or truncated Admin CSV records reduce coverage. Product rows join on exact IDs; `admin_project_roles.csv` defines roles but does not establish who holds them.
- **Permission records are assignments, not effective access.** The Docs explorer shows folder assignments returned by Autodesk for folders visible to the signed-in user. It does not calculate all inherited, group, product, and user-specific access for a person.
- **Governance and lifecycle findings are review prompts.** They use local project, activity, and workflow evidence; missing windows or tables can make quiet or clear projects appear incorrectly. Confirm current status and obligations in Forma.
- **Offboarding removes project memberships only.** It does not deprovision the person's Autodesk organization account. Last observed activity comes from the local extract and may be incomplete.
- **Provisioning recipes do not add members during project creation.** Their member, product, and access selections can prefill a separate reviewed Manage import after the project is active. Project creation and native template application may finish asynchronously.
- **The administration audit is local to Lens.** It excludes actions made elsewhere, and an accepted asynchronous import is recorded as submitted until its final result is known in Autodesk.
- **Saved views and watchlists are local bookmarks.** They do not refresh sources, detect changes, or send alerts.
- **Data health is a local diagnostic.** Its 72-hour age threshold and CSV-header baseline do not verify Autodesk's source freshness, extract project coverage, or a complete source schema.
- **Project archiving uses an older BIM 360 Account Admin endpoint.** The source implementation notes state that it works for the tested Forma hub even though Autodesk's compatibility table marks the endpoint as unsupported for Forma projects.
- **There is no un-archive action in the UI.** Restoring a project requires the reverse status change in Forma or an additional implementation in this app.
- **Product access mapping should be verified against the hub's entitlements** before a large import.
- **The Tools CSV import caps each table at 400,000 rows.** The Tools page identifies truncated tables so dashboard totals can be interpreted accordingly.
- **Activity CSV files over 400,000 rows are rejected individually.** Other valid files in the same completed job can still ingest.
- **Serverless hosting is not supported without architectural changes** because the app depends on writable, persistent SQLite storage and extract uploads.

## Operational considerations

- **The cache holds real hub data** — both the activity cache and the uploaded CSV extract. `.data/` is gitignored; treat it as sensitive and delete it when you are done. Deleting it is safe because re-uploading and re-ingesting rebuilds it.
- **Uploading an extract replaces the tables it contains** and leaves other tables alone. Mixing two extracts is therefore possible; upload a complete one to keep the picture consistent.
- **Sessions are server-side.** The cookie is an opaque random ID; tokens live in SQLite, never in the browser. Refresh tokens are rotated on use.
