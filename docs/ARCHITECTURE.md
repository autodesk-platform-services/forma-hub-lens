# Architecture

## Data Connector architecture

**Forma has no live cross-project activity endpoint.** Activity is only available through the **Data Connector API**, which is asynchronous and batch-oriented:

```text
POST a data request  →  Autodesk spawns a job  →  job completes (minutes)  →  extract = CSV files
```

That shapes the whole tool. The console cannot simply query activity on page load, so it:

1. submits Data Connector requests for the `activities` service group,
2. downloads and parses the resulting CSVs once,
3. caches the normalised rows in a local SQLite file, and
4. serves every dashboard view from that cache.

Autodesk caps extraction at **24 jobs per hub per 24 hours** and **24 per user**, so treat each extract as expensive. The Overview page shows your running count.

Other limits worth knowing:

| Limit | Value |
| --- | --- |
| Activity history available | Last 12 months |
| Max window per request | 31 days |
| Activity replication lag | Up to ~20 minutes |
| Signed download URL lifetime | 60 seconds |
| Projects per request (`projectIdList`) | 50; omit it for the whole hub |

## Activity data schema

Autodesk versions the activity CSV schemas independently per service, and the authoritative column list ships as a `README.html` *inside each extract* rather than in the public docs.

Rather than hard-code a schema that may not match your hub, the ingester maps whatever columns arrive onto a small canonical shape:

`occurred_at`, `project_id`, `actor_id`, `actor_name`, `actor_email`, `service`, `action`, `target_type`, `target_name`

The full untouched row is always stored as JSON alongside, so nothing is lost and free-text search still reaches unmapped columns.

**Check the "Column mapping" panel on the Extracts page after your first ingest.** It lists every column in your extract and what it was mapped to. If something important shows as `unmapped`, or is mapped to the wrong field, add the column name to `COLUMN_CANDIDATES` in [`src/lib/activitySchema.ts`](../src/lib/activitySchema.ts) and re-ingest. That table is the single place schema guesses live.

Only files matching `activities*.csv` are ingested. Other service groups still land in the extract and are recorded in `extract_files`, but they do not feed the activity views.

APS can own a recurring Data Connector request and spawn future jobs. Lens stores request definitions and known job states when the user refreshes them. There is no background worker that refreshes or ingests completed jobs; ingestion remains an explicit action. An automatic ingestion service would need persistent hosting, a scheduler, a verified service identity and permissions, job de-duplication, and recovery behavior.

## Tool dashboards

Each dashboard is distilled from the matching Autodesk Power BI template. KPI cards, chart types, titles, and groupings are taken from that template's hub page.

| Tool | Template |
| --- | --- |
| Activities | `data-connector-activities-dashboard-csv-v1-3.pbit` |
| Administration | `data-connector-admin-dashboard-connector-v1-3.pbit` |
| Assets | `data-connector-assets-dashboard-connector-v2-4.pbit` |
| Cost | `data-connector-cost-kpis-project-connector-v1-1.pbit` |
| Cost KPIs | `data-connector-cost-management-dashboard-connector-v2-3.pbit` |
| Estimate | `data-connector-estimate-dashboard-connector-v1-1.pbit` |
| Forms | `data-connector-forms-dashboard-connector-v2-5.pbit` |
| IQ | `data-connector-iq-dashboard-connector-v2-5.pbit` |
| Issues | `data-connector-issues-dashboard-connector-v3-4.pbit` |
| Meetings | `data-connector-meeting-minutes-dashboard-connector-v1-2.pbit` |
| Photos | `data-connector-photos-dashboard-connector-v1-3.pbit` |
| Quality KPIs (Design & Document Review) | `data-connector-design-and-document-review-dashboard-connector-v3-1.pbit` |
| Quality KPIs (Field Quality) | `data-connector-field-quality-control-connector-v1-4.pbit` |
| Quality KPIs (Model Coordination) | `data-connector-quality-kpis-model-coordination-clash-report-connector-v1-2.pbit` |
| Quality KPIs (Model Coordination Clash Report) | `data-connector-quality-kpis-model-coordination-dashboard-connector-v1-3.pbit` |
| Reviews | `data-connector-reviews-dashboard-connector-v1-4.pbit` |
| RFIs | `data-connector-rfis-dashboard-connector-v1-10.pbit` |
| Schedule | `data-connector-schedule-dashboard-connector-v2-5.pbit` |
| Schedule KPI | `data-connector-schedule-kpi-dashboard-connector-v1-2.pbit` |
| Submittals | `data-connector-submittals-dashboard-connector-v3-4.pbit` |
| Takeoff | `data-connector-takeoff-dashboard-csv-v1-1.pbit` |

### Dashboard scope and limitations

The dashboards reproduce each template's **hub-level page** — its KPI row and main visuals — rather than all pages or all ~1,000 visuals across the set.

Where a template's field is a Power BI *computed* column (`Activity Status`, `Category Name`, `Is Delayed Finish`) rather than a real CSV column, the spec uses the closest raw equivalent because those columns exist only inside the `.pbit`.

Every spec lives in [`src/lib/dashboards/specs.ts`](../src/lib/dashboards/specs.ts) as plain data. Add a KPI or chart by adding an object; no rendering code is required. Panels whose table or column is missing say so on the card instead of rendering a misleading zero.

Facts join to dimensions on `bim360_project_id → admin_projects.id`, `company_id → admin_companies.id`, `created_by → admin_users.autodesk_id`, and a few tool-specific keys. The join logic is in [`src/lib/dashboards/engine.ts`](../src/lib/dashboards/engine.ts).

## Hub management

At sign-in and at least every 30 minutes while a session is used, Lens checks the signed-in Autodesk identity against the configured hub's account directory. One exact directory match with `account_admin` (Hub Admin) or `executive` (Executive Overview) can enter. Unknown roles, ambiguous identities, and failed verification are denied. This gate protects locally cached views, which Autodesk does not check on each read. A live Hub Admin check is repeated before hub administration writes and project sync. Autodesk still enforces each API's own scopes and permissions. See [`src/lib/aps/authorization.ts`](../src/lib/aps/authorization.ts).

Hub-management writes need `account:write` and a Hub Admin session. The application records a preview before execution and per-item outcomes afterward in its local SQLite audit. Previews expire after ten minutes, belong to the originating session, and are single-use. Some endpoints accept work asynchronously; the audit distinguishes a submitted import from a confirmed success. It is a record of Lens actions, not a complete Autodesk account audit.

### Archiving projects

Archive moves a project from **Active** to **Archived**. Nothing is deleted: the project keeps all its data and members, drops off users' active project lists, and can be set back to active.

This operation is unusual:

- The **Forma Hub Admin API has no project update endpoint** at all; the only PATCH on a project is `/image`. Archiving therefore goes through the older BIM 360 Account Admin endpoint, `PATCH hq/v1/accounts/:hub/projects/:id`, with a body of exactly `{"status":"archived"}`.
- Autodesk's [Forma compatibility table](https://aps.autodesk.com/en/docs/acc/v1/overview/bim360-compatibility/compatibility-table/) marks that endpoint **"No"** for Forma projects. The original implementation notes state that this is out of date and that the endpoint was verified against a live Forma-platform (`acc`) project on this hub: archive returned 200, the status changed, the Forma Admin API reflected it, and restoring to active worked the same way. If Autodesk ships a native Hub Admin equivalent, switch to it.
- The endpoint is **app-only**, so it needs a two-legged token. This is the one place in the app that does not act as the signed-in user, which means Autodesk is not checking that person's permissions for this endpoint.

Because of the last point, the archive action calls `requireAccountAdmin()` before using the app-only token. It looks the signed-in user up in the hub directory and requires `access_level === "account_admin"`. It fails closed if the lookup errors. This check is in addition to the app's Hub Admin role gate for administration writes.

Additional guards:

- only projects currently **active** are offered,
- each project's live status is re-read immediately before writing,
- anything already archived or suspended is skipped rather than overwritten,
- the user must type `ARCHIVE` to confirm, and
- a run is capped at 50 projects.

There is no un-archive action in the UI. Restoring is the same one-field change in reverse (`{"status":"active"}`) and can be done in Forma or added to this app.

### Product access mapping

The **Choose product access…** options are commercial bundle names; the Admin API takes product *keys*.

This mapping is the console's interpretation. **Verify it against your hub's entitlements before a large import** and edit `PRODUCT_ACCESS_OPTIONS` in [`src/lib/aps/hubAdmin.ts`](../src/lib/aps/hubAdmin.ts) if your account provisions a bundle differently.

| Option | Product keys |
| --- | --- |
| BIM Collaborate | `designCollaboration`, `modelCoordination` |
| Forma Takeoff | `takeoff` |
| Forma for Preconstruction | `takeoff`, `cost` |
| AutoSpecs | `autoSpecs` |
| Forma Build | `build` |
| Forma Design Collaboration | `designCollaboration` |

## Project structure

```text
src/
  app/
    page.tsx                Overview
    projects/               Cross-project rollup
    activity/               Event explorer
    extracts/               Data Connector requests, jobs, ingest
    tools/                  21 tool dashboards + extract upload
    people/                 User profiles and access matrix from Admin CSVs
    permissions/            Live Docs folder assignment explorer
    governance/             Review rules and evidence
    data-health/            Local source freshness and schema checks
    search/                 Paginated portfolio search
    views/                  Per-user saved filters and bookmarks
    lifecycle/              Archive review candidates
    offboarding/            Live account association review
    recipes/                Project creation presets and preview
    manage/                 Bulk operations, preview, and local audit
    actions.ts              Server actions (sync, request, ingest)
    api/aps/login|callback  OAuth 3-legged flow
    api/activity/export     Filtered CSV download
    api/dataset/upload      Extract ZIP ingestion
    api/dashboards/[id]     Computes one dashboard on demand
  lib/
    dashboards/specs.ts     The 21 dashboard definitions  ← add KPIs/charts here
    dashboards/engine.ts    Spec -> SQL, join rules
    people.ts               Source-aware people and membership joins
    governance.ts           Project evidence and review rules
    permissions.ts          Docs folder and assignment API reads
    dataHealth.ts           Local source checks and schema baseline
    portfolioSearch.ts      Bounded project/people/company search
    savedViews.ts           Per-user saved filters and watchlist
    offboarding.ts          Live account association lookup
    recipes.ts              User-owned provisioning presets
    adminOperations.ts      Single-use previews and item audit
    dataset.ts              Extract ZIP -> one SQLite table per CSV
    aps/hubAdmin.ts         Bulk member / project writes
    aps/auth.ts             OAuth, session, token refresh
    aps/client.ts           Authenticated fetch, retry, pagination
    aps/admin.ts            Hub Admin API (projects)
    aps/dataConnector.ts    Data Connector API
    activitySchema.ts       Column mapping heuristics  ← tune schema guesses here
    csv.ts                  Streaming RFC-4180 reader
    ingest.ts               Extract → cache
    queries.ts              Dashboard aggregations
    db.ts                   SQLite schema
```

## APS endpoints used

| Purpose | Endpoint | Scope |
| --- | --- | --- |
| Authorize / token | `authentication/v2/authorize`, `/token` | — |
| Hub role gate | `GET hq/v1/accounts/:hub/users/search` after Autodesk userinfo identity check | app-only token; exact email match |
| Hub projects | `GET construction/admin/v1/accounts/:hub/projects` | `account:read` |
| Create request | `POST data-connector/v1/accounts/:hub/requests` | `data:create` |
| List jobs | `GET data-connector/v1/accounts/:hub/jobs` | `data:read` |
| Extract file list | `GET .../jobs/:jobId/data-listing` | `data:read` |
| Signed download | `GET .../jobs/:jobId/data/:name` | `data:read` |
| Companies | `GET construction/admin/v1/accounts/:hub/companies` | `account:read` |
| Bulk add members | `POST construction/admin/v2/projects/:id/users:import` | `account:write` |
| Remove member | `DELETE construction/admin/v1/projects/:id/users/:userId` | `account:write` |
| Create project | `POST construction/admin/v1/accounts/:hub/projects` | `account:write` |
| Archive project | `PATCH hq/v1/accounts/:hub/projects/:id` | `account:write` (2-legged) |
| Admin check | `GET hq/v1/accounts/:hub/users/search` | `account:read` (2-legged) |
| Live offboarding associations | `GET construction/admin/v1/accounts/:hub/users/:id/{projects,products,roles}` | `account:read` |
| Docs folders and permission assignments | Data Management `topFolders`/`folders` and Docs `folders/:id/permissions` | `data:read` and signed-in user's Docs access |

People, Search, Governance, Lifecycle, and Data health primarily read Lens's local SQLite cache. Permission assignments returned by Docs are not expanded into a person's effective access. Uploaded tables can represent different source periods when the user uploads ZIPs containing only some CSVs.

## UI conventions

Autodesk brand colours only. Dark surfaces use black backgrounds with white body text and yellow titles; light surfaces are off-white with black text. Blue and Teal carry data, per the rule that Blue is for data/tech rather than a general accent.

**Yellow `#FFFE00` is the action accent** — buttons, active tabs, selected-state borders, and status dots. Anything sitting on yellow is black text, and every yellow *fill* carries a 1px `#D5D5CB` (`accent6`) border, the same border used on cards, inputs, and tables, so the fills stay defined against both the off-white body and the black header.

Yellow *outlines* — active tab underline, selected chips, and focus rings — keep their yellow because a gray border there would erase the signal it exists to carry.

This deliberately departs from the brand note that yellow is for dark-slide titles only. Flame Orange stays defined in the palette but is unused.

The header mark is `public/autodesk-logo.png` — the white-on-transparent "dark background" variant — so it reads on the black header only. Do not reuse it on light surfaces.

Type is Artifakt Legend for headings and Artifakt Element for body, with Arial as the sole fallback; the two are never mixed.
