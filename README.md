# Forma Hub Lens

An internal console for an Autodesk Forma hub, for someone holding **Hub Admin** (or Executive
Overview) rights. It covers three things:

1. **Tools** — a dashboard per Forma tool, laid out to match Autodesk's Power BI template for that
   tool, driven by an uploaded Data Connector CSV extract.
2. **Cross-project activity** — projects, activity explorer and extract management.
3. **Hub management** — bulk member add/remove, bulk project creation, company and role views.

---

## The one thing to know first

**Forma has no live cross-project activity endpoint.** Activity is only available through the
**Data Connector API**, which is asynchronous and batch-oriented:

```
POST a data request  →  Autodesk spawns a job  →  job completes (minutes)  →  extract = CSV files
```

That shapes the whole tool. The console cannot "just query" activity on page load, so it:

1. submits Data Connector requests for the `activities` service group,
2. downloads and parses the resulting CSVs once,
3. caches the normalised rows in a local SQLite file, and
4. serves every dashboard view from that cache.

**Autodesk caps extraction at 24 jobs per hub per 24 hours** (and 24 per user), so treat each
extract as expensive. The Overview page shows your running count.

Other limits worth knowing:

| Limit | Value |
| --- | --- |
| Activity history available | last 12 months |
| Max window per request | 31 days |
| Activity replication lag | up to ~20 minutes |
| Signed download URL lifetime | 60 seconds |
| Projects per request (`projectIdList`) | 50 (omit it for the whole hub) |

---

## Setup

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill it in. `.env.local` is gitignored — keep it that way.

| Variable | Meaning |
| --- | --- |
| `APS_CLIENT_ID` / `APS_CLIENT_SECRET` | From <https://aps.autodesk.com/myapps>. The app must be a **Traditional Web App**. |
| `APS_CALLBACK_URL` | Must exactly match a callback registered on the APS app. Default `http://localhost:3000/api/aps/callback`. |
| `FORMA_HUB_ID` | Hub ID **without** the `b.` prefix that the Data Management API uses. |
| `FORMA_REGION` | Optional: `US`, `EMEA` or `AUS`. Blank lets Autodesk route automatically. |
| `DATA_DIR` | Where the local cache lives. Default `.data`. |

Then:

```bash
npm run dev
```

Open <http://localhost:3000> and sign in.

### Why you must sign in (3-legged, not 2-legged)

Data Connector requires a **user context** token. A two-legged client-credentials token will not
work, because Autodesk scopes the extract to the signed-in user's hub permissions. Sign in with an
account that actually holds Hub Admin or Executive Overview — otherwise you will silently get only
the projects you are a member of, not the hub.

Scopes requested: `data:read`, `data:create`, `account:read`, `account:write`, `user-profile:read`,
`openid`.

> `account:write` backs the Hub management writes. If you signed in before that scope was added,
> **sign out and back in** or the bulk operations will return 403.

---

## Using it

**Overview** — hub-wide totals, events per day, busiest projects and people, and which projects
have *no* activity in the ingested window. `Sync projects` pulls the hub project list from the
Admin API; `Refresh jobs` pulls Data Connector job state.

**Projects** — every project from the Admin API joined against ingested activity: events, distinct
people, last event, services touched, member and sheet counts. Click a project to filter Activity
to it.

**Activity** — the event explorer. Filter by date, project, service, action, person or free text
(free text also searches the untouched source row). `Export CSV` downloads exactly what is on
screen, filters included. Every row can be expanded to show the raw extract row.

**Extracts** — submit a data request, watch jobs, and ingest completed extracts. Also shows the
column mapping report (see below).

**Tools** — the 21 Forma tool dashboards. See below.

**Manage** — hub management writes. See below.

### The normal loop

1. **Extracts** → pick a window → check `activities` → *Submit data request*.
2. Wait a few minutes. → *Refresh jobs* until the job reads `complete`.
3. → *Ingest*. The rows land in the cache and every other page fills in.

Ingesting overlapping windows is safe — rows are de-duplicated by fingerprint, so you can re-ingest
without creating duplicates.

---

## How activity CSVs are interpreted

Autodesk versions the activity CSV schemas independently per service, and the authoritative column
list ships as a `README.html` *inside each extract* rather than in the public docs. Rather than
hard-code a schema that may not match your hub, the ingester maps whatever columns arrive onto a
small canonical shape:

`occurred_at`, `project_id`, `actor_id`, `actor_name`, `actor_email`, `service`, `action`,
`target_type`, `target_name`

The full untouched row is always stored as JSON alongside, so nothing is lost and free-text search
still reaches unmapped columns.

**Check the "Column mapping" panel on the Extracts page after your first ingest.** It lists every
column in your extract and what it was mapped to. If something important shows as `unmapped`, or is
mapped to the wrong field, add the column name to `COLUMN_CANDIDATES` in
[`src/lib/activitySchema.ts`](src/lib/activitySchema.ts) and re-ingest. That table is the single
place schema guesses live.

Only files matching `activities*.csv` are ingested. Other service groups still land in the extract
and are recorded in `extract_files`, but they don't feed the activity views.

---

## Tools tab — the 21 dashboards

Upload the ZIP of CSVs from **Insight › Data Connector**. Each file is loaded under its own name:
`admin_projects.csv` becomes the `admin_projects` table. That is exactly how the Power BI templates
bind their data (`Csv.Document(File.Contents(SourceFolder & "\admin_projects.csv"))`), so the same
extract that drives the .pbit files drives these dashboards.

Selecting a tool opens a near-full-screen dashboard; **Esc**, **Close**, **Back to tools** or a
click outside returns to the menu. A tool is greyed out when its primary CSV isn't in the extract.

Each dashboard is distilled from the matching Autodesk template — KPI cards, chart types, titles and
groupings are taken from that template's hub page:

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

### What these dashboards are, and are not

They reproduce each template's **hub-level page** — its KPI row and its main visuals — not all of
its pages or all ~1,000 visuals across the set. Where a template's field is a Power BI *computed*
column (`Activity Status`, `Category Name`, `Is Delayed Finish`) rather than a real CSV column, the
spec uses the closest raw equivalent, because those columns exist only inside the .pbit.

Every spec lives in [`src/lib/dashboards/specs.ts`](src/lib/dashboards/specs.ts) as plain data —
add a KPI or chart by adding an object, no rendering code required. Panels whose table or column is
missing say so on the card instead of rendering a misleading zero.

Facts join to dimensions on `bim360_project_id → admin_projects.id`, `company_id →
admin_companies.id`, `created_by → admin_users.autodesk_id` and a few tool-specific keys; the table
is in [`src/lib/dashboards/engine.ts`](src/lib/dashboards/engine.ts).

---

## Manage tab — hub management

All of these write to the live hub and need `account:write`.

| Operation | Endpoint |
| --- | --- |
| Bulk add members | `POST construction/admin/v2/projects/:projectId/users:import` (≤200 per call) |
| Bulk remove members | `DELETE construction/admin/v1/projects/:projectId/users/:userId` |
| Bulk create projects | `POST construction/admin/v1/accounts/:hub/projects` (≤50 per run) |
| Companies | `GET construction/admin/v1/accounts/:hub/companies` |
| Roles | read from `admin_project_roles.csv` in the extract |

Add and remove take a list of projects and a newline-separated member list, so one submission fans
out across projects. Removal requires typing `REMOVE` to confirm.

There is **no hub-wide "list roles" endpoint** in the Forma Admin API, so the Roles view reads
`admin_project_roles.csv` from the uploaded extract.

### Product access mapping

The **Choose product access…** options are commercial bundle names; the Admin API takes product
*keys*. This mapping is the console's interpretation — **verify it against your hub's entitlements
before a large import** and edit `PRODUCT_ACCESS_OPTIONS` in
[`src/lib/aps/hubAdmin.ts`](src/lib/aps/hubAdmin.ts) if your account provisions a bundle differently:

| Option | Product keys |
| --- | --- |
| BIM Collaborate | `designCollaboration`, `modelCoordination` |
| Forma Takeoff | `takeoff` |
| Forma for Preconstruction | `takeoff`, `cost` |
| AutoSpecs | `autoSpecs` |
| Forma Build | `build` |
| Forma Design Collaboration | `designCollaboration` |

---

## Layout

```
src/
  app/
    page.tsx              Overview
    projects/             Cross-project rollup
    activity/             Event explorer
    extracts/             Data Connector requests, jobs, ingest
    tools/                21 tool dashboards + extract upload
    manage/               Bulk member / project operations
    actions.ts            Server actions (sync, request, ingest)
    api/aps/login|callback   OAuth 3-legged flow
    api/activity/export      Filtered CSV download
    api/dataset/upload       Extract ZIP ingestion
    api/dashboards/[id]      Computes one dashboard on demand
  lib/
    dashboards/specs.ts   The 21 dashboard definitions  ← add KPIs/charts here
    dashboards/engine.ts  Spec -> SQL, join rules
    dataset.ts            Extract ZIP -> one SQLite table per CSV
    aps/hubAdmin.ts       Bulk member / project writes
    aps/auth.ts           OAuth, session, token refresh
    aps/client.ts         Authenticated fetch, retry, pagination
    aps/admin.ts          Hub Admin API (projects)
    aps/dataConnector.ts  Data Connector API
    activitySchema.ts     Column mapping heuristics  ← tune schema guesses here
    csv.ts                Streaming RFC-4180 reader
    ingest.ts             Extract → cache
    queries.ts            Dashboard aggregations
    db.ts                 SQLite schema
```

Storage is the Node 22+ built-in `node:sqlite`, so there is no native dependency to compile.

```bash
npm test              # 23 tests: CSV reader, column mapper, and all 21 dashboards end-to-end
npm run typecheck
npm run build
npm run sample-extract   # writes sample-extract.zip — a synthetic extract for trying the Tools tab
```

`npm run test:dashboards` builds a synthetic extract with the real CSV and column names, ingests it,
then asserts that every KPI and every chart on all 21 dashboards resolves and returns rows.

---

## Endpoints used

| Purpose | Endpoint | Scope |
| --- | --- | --- |
| Authorize / token | `authentication/v2/authorize`, `/token` | — |
| Hub projects | `GET construction/admin/v1/accounts/:hub/projects` | `account:read` |
| Create request | `POST data-connector/v1/accounts/:hub/requests` | `data:create` |
| List jobs | `GET data-connector/v1/accounts/:hub/jobs` | `data:read` |
| Extract file list | `GET .../jobs/:jobId/data-listing` | `data:read` |
| Signed download | `GET .../jobs/:jobId/data/:name` | `data:read` |
| Companies | `GET construction/admin/v1/accounts/:hub/companies` | `account:read` |
| Bulk add members | `POST construction/admin/v2/projects/:id/users:import` | `account:write` |
| Remove member | `DELETE construction/admin/v1/projects/:id/users/:userId` | `account:write` |
| Create project | `POST construction/admin/v1/accounts/:hub/projects` | `account:write` |

---

## UI conventions

Autodesk brand colours only. Dark surfaces use black backgrounds with white body text and yellow
titles; light surfaces are off-white with black text. Blue and Teal carry data, per the rule that
Blue is for data/tech rather than a general accent.

**Yellow `#FFFE00` is the action accent** — buttons, active tabs, selected-state borders, status
dots. Anything sitting on yellow is black text, and every yellow *fill* carries a 1px
`#D5D5CB` (accent6) border, the same border used on cards, inputs and tables, so the fills stay
defined against both the off-white body and the black header. Yellow *outlines* (active tab
underline, selected chips, focus rings) keep their yellow, since a gray border there would erase
the signal it exists to carry.

This deliberately departs from the brand note that yellow is for dark-slide titles only. Flame
Orange stays defined in the palette but is unused.

The header mark is `public/autodesk-logo.png` — the white-on-transparent "dark background" variant,
so it reads on the black header only; don't reuse it on the light surfaces.

Type is Artifakt Legend for headings and Artifakt Element for body, with Arial as the sole fallback
and the two never mixed.

---

## Operational notes

- **The cache holds real hub data** — the activity cache *and* the uploaded CSV extract. `.data/` is
  gitignored; treat it as sensitive and delete it when you're done. Deleting it is always safe —
  re-upload and re-ingest rebuild it.
- **Uploading an extract replaces the tables it contains** and leaves other tables alone. Mixing two
  extracts is therefore possible; upload a complete one to keep the picture consistent.
- **Sessions are server-side.** The cookie is an opaque random id; tokens live in SQLite, never in
  the browser. Refresh tokens are rotated on use.
- This is a localhost internal tool with no authorization layer of its own — anyone who can reach
  the port inherits the signed-in session. Don't expose it beyond localhost without adding auth.
