# Known limitations

- **No live cross-project activity endpoint.** Activity depends on asynchronous Data Connector extracts and the local SQLite cache.
- **Extraction is quota-limited.** Autodesk caps extraction at 24 jobs per hub per 24 hours and 24 per user.
- **Activity history is limited to the last 12 months**, with a maximum 31-day window per request and replication lag of up to approximately 20 minutes.
- **Dashboards represent the hub-level page of each Power BI template**, not every page or every visual in the source templates.
- **Computed Power BI columns are not available in the CSV extracts.** The dashboard specs use the closest raw equivalent where necessary.
- **There is no hub-wide roles endpoint.** The Roles view depends on `admin_project_roles.csv` from the uploaded extract.
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
