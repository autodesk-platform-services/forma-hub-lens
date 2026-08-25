# Forma Hub Lens

![platforms](https://img.shields.io/badge/platform-local%20%7C%20container-lightgray.svg)
[![node.js](https://img.shields.io/badge/Node.js-22%2B-blue.svg)](https://nodejs.org)
[![license](https://img.shields.io/:license-mit-green.svg)](https://opensource.org/licenses/MIT)

Forma Hub Lens is an internal console for an Autodesk Forma hub, intended for someone holding **Hub Admin** (or Executive Overview) rights. It combines hub-level analytics, cross-project activity, extract management, and bulk hub administration in a single application.

> **Gallery requirement:** Add a 16:9 `thumbnail.png` (or `thumbnail.gif`) to the repository root before publishing this as an Autodesk code sample.

![Forma Hub Lens](thumbnail.png)

## Features

- **Tool dashboards** — a dashboard per Forma tool, laid out to match Autodesk's Power BI template for that tool and driven by an uploaded Data Connector CSV extract.
- **Cross-project activity** — projects, activity explorer, and extract management across the hub.
- **Hub management** — bulk member add/remove, bulk project creation and archiving, company views, role views, and product-access assignment.

## Table of contents

- [Usage](#usage)
- [Development](#development)
- [How it works](#how-it-works)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)
- [Operational considerations](#operational-considerations)
- [License](#license)

---

## Usage

### Overview

The **Overview** page shows hub-wide totals, events per day, busiest projects and people, and which projects have *no* activity in the ingested window.

- `Sync projects` pulls the hub project list from the Admin API.
- `Refresh jobs` pulls Data Connector job state.
- The page also shows the running Data Connector extraction count, which matters because Autodesk caps extraction at 24 jobs per hub per 24 hours and 24 per user.

### Projects

The **Projects** page shows every project from the Admin API joined against ingested activity, including:

- events,
- distinct people,
- last event,
- services touched,
- member counts, and
- sheet counts.

Click a project to filter **Activity** to that project.

### Activity

The **Activity** page is the event explorer. Filter by date, project, service, action, person, or free text. Free-text search also searches the untouched source row.

`Export CSV` downloads exactly what is on screen, including filters. Every row can be expanded to show the raw extract row.

### Extracts

The **Extracts** page lets you:

- submit a Data Connector data request,
- watch jobs,
- ingest completed extracts, and
- review the column-mapping report after ingestion.

### Tools

The **Tools** page contains 21 Forma tool dashboards. Upload the ZIP of CSVs from **Insight › Data Connector** to populate them.

Each file is loaded under its own name. For example, `admin_projects.csv` becomes the `admin_projects` table. That is how the Power BI templates bind their data (`Csv.Document(File.Contents(SourceFolder & "\\admin_projects.csv"))`), so the same extract that drives the `.pbit` files drives these dashboards.

Selecting a tool opens a near-full-screen dashboard. Use **Esc**, **Close**, **Back to tools**, or click outside the dashboard to return to the menu. A tool is greyed out when its primary CSV is not in the extract.

### Manage

The **Manage** page performs hub-management writes. These operations require `account:write`.

| Operation | Endpoint |
| --- | --- |
| Bulk add members | `POST construction/admin/v2/projects/:projectId/users:import` (≤200 per call) |
| Bulk remove members | `DELETE construction/admin/v1/projects/:projectId/users/:userId` |
| Bulk create projects | `POST construction/admin/v1/accounts/:hub/projects` (≤50 per run) |
| **Bulk archive projects** | `PATCH hq/v1/accounts/:hub/projects/:id` (≤50 per run) |
| Companies | `GET construction/admin/v1/accounts/:hub/companies` |
| Roles | Read from `admin_project_roles.csv` in the extract |

Add and remove operations take a list of projects and a newline-separated member list, so one submission fans out across projects. Removal requires typing `REMOVE` to confirm.

There is **no hub-wide "list roles" endpoint** in the Forma Admin API, so the Roles view reads `admin_project_roles.csv` from the uploaded extract.

### Typical workflow

1. Go to **Extracts** → pick a window → check `activities` → **Submit data request**.
2. Wait for the Data Connector job to complete, then use **Refresh jobs** until the job reads `complete`.
3. Select **Ingest**. The rows land in the cache and every other page fills in.

Ingesting overlapping windows is safe. Rows are de-duplicated by fingerprint, so you can re-ingest without creating duplicates.

---

## Development

### Prerequisites

Before running the sample locally, you need:

- Node.js 22 or later,
- npm,
- an Autodesk Platform Services application configured as a **Traditional Web App**,
- access to an Autodesk Forma hub,
- a Forma account with **Hub Admin** or **Executive Overview** rights, and
- APS application credentials.

Storage uses the Node 22+ built-in `node:sqlite`, so there is no native dependency to compile.

### Install dependencies

```bash
npm install
```

### Environment variables

Copy `.env.example` to `.env.local` and fill it in. `.env.local` is gitignored — keep it that way.

| Variable | Meaning |
| --- | --- |
| `APS_CLIENT_ID` / `APS_CLIENT_SECRET` | From <https://aps.autodesk.com/myapps>. The app must be a **Traditional Web App**. |
| `APS_CALLBACK_URL` | Must exactly match a callback registered on the APS app. Default `http://localhost:3000/api/aps/callback`. |
| `FORMA_HUB_ID` | Hub ID **without** the `b.` prefix that the Data Management API uses. |
| `FORMA_REGION` | Optional: `US`, `EMEA`, or `AUS`. Blank lets Autodesk route automatically. |
| `DATA_DIR` | Where the local cache lives. Default `.data`. |

### Authentication and required scopes

Data Connector requires a **user-context** token. A two-legged client-credentials token will not work for Data Connector because Autodesk scopes the extract to the signed-in user's hub permissions.

Sign in with an account that actually holds Hub Admin or Executive Overview. Otherwise, you will silently get only the projects you are a member of rather than the whole hub.

Scopes requested:

- `data:read`
- `data:create`
- `account:read`
- `account:write`
- `user-profile:read`
- `openid`

> `account:write` backs the Hub management writes. If you signed in before that scope was added, **sign out and back in** or the bulk operations will return 403.

### Run locally

```bash
npm run dev
```

Open <http://localhost:3000> and sign in.

### Tests and validation

```bash
npm test                 # 43 tests: CSV reader, column mapper, all 21 dashboards, hub gate, archive guards
npm run typecheck
npm run build
npm run sample-extract   # writes sample-extract.zip — a synthetic extract for trying the Tools tab
```

`npm run test:dashboards` builds a synthetic extract with the real CSV and column names, ingests it, then asserts that every KPI and every chart on all 21 dashboards resolves and returns rows.

---

## How it works

### Data Connector architecture

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

### Activity data schema

Autodesk versions the activity CSV schemas independently per service, and the authoritative column list ships as a `README.html` *inside each extract* rather than in the public docs.

Rather than hard-code a schema that may not match your hub, the ingester maps whatever columns arrive onto a small canonical shape:

`occurred_at`, `project_id`, `actor_id`, `actor_name`, `actor_email`, `service`, `action`, `target_type`, `target_name`

The full untouched row is always stored as JSON alongside, so nothing is lost and free-text search still reaches unmapped columns.

**Check the "Column mapping" panel on the Extracts page after your first ingest.** It lists every column in your extract and what it was mapped to. If something important shows as `unmapped`, or is mapped to the wrong field, add the column name to `COLUMN_CANDIDATES` in [`src/lib/activitySchema.ts`](src/lib/activitySchema.ts) and re-ingest. That table is the single place schema guesses live.

Only files matching `activities*.csv` are ingested. Other service groups still land in the extract and are recorded in `extract_files`, but they do not feed the activity views.

### Tool dashboards

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

#### Dashboard scope and limitations

The dashboards reproduce each template's **hub-level page** — its KPI row and main visuals — rather than all pages or all ~1,000 visuals across the set.

Where a template's field is a Power BI *computed* column (`Activity Status`, `Category Name`, `Is Delayed Finish`) rather than a real CSV column, the spec uses the closest raw equivalent because those columns exist only inside the `.pbit`.

Every spec lives in [`src/lib/dashboards/specs.ts`](src/lib/dashboards/specs.ts) as plain data. Add a KPI or chart by adding an object; no rendering code is required. Panels whose table or column is missing say so on the card instead of rendering a misleading zero.

Facts join to dimensions on `bim360_project_id → admin_projects.id`, `company_id → admin_companies.id`, `created_by → admin_users.autodesk_id`, and a few tool-specific keys. The join logic is in [`src/lib/dashboards/engine.ts`](src/lib/dashboards/engine.ts).

### Hub management

All hub-management operations write to the live hub and need `account:write`.

#### Archiving projects

Archive moves a project from **Active** to **Archived**. Nothing is deleted: the project keeps all its data and members, drops off users' active project lists, and can be set back to active.

This operation is unusual:

- The **Forma Hub Admin API has no project update endpoint** at all; the only PATCH on a project is `/image`. Archiving therefore goes through the older BIM 360 Account Admin endpoint, `PATCH hq/v1/accounts/:hub/projects/:id`, with a body of exactly `{"status":"archived"}`.
- Autodesk's [Forma compatibility table](https://aps.autodesk.com/en/docs/acc/v1/overview/bim360-compatibility/compatibility-table/) marks that endpoint **"No"** for Forma projects. The original implementation notes state that this is out of date and that the endpoint was verified against a live Forma-platform (`acc`) project on this hub: archive returned 200, the status changed, the Forma Admin API reflected it, and restoring to active worked the same way. If Autodesk ships a native Hub Admin equivalent, switch to it.
- The endpoint is **app-only**, so it needs a two-legged token. This is the one place in the app that does not act as the signed-in user, which means Autodesk is not checking that person's permissions for this endpoint.

Because of the last point, the archive action calls `requireAccountAdmin()` first. It looks the signed-in user up in the hub directory and requires `access_level === "account_admin"`. It fails closed: if the lookup errors, access is denied. Hub membership alone is not enough here, unlike everywhere else in the tool.

Additional guards:

- only projects currently **active** are offered,
- each project's live status is re-read immediately before writing,
- anything already archived or suspended is skipped rather than overwritten,
- the user must type `ARCHIVE` to confirm, and
- a run is capped at 50 projects.

There is no un-archive action in the UI. Restoring is the same one-field change in reverse (`{"status":"active"}`) and can be done in Forma or added to this app.

#### Product access mapping

The **Choose product access…** options are commercial bundle names; the Admin API takes product *keys*.

This mapping is the console's interpretation. **Verify it against your hub's entitlements before a large import** and edit `PRODUCT_ACCESS_OPTIONS` in [`src/lib/aps/hubAdmin.ts`](src/lib/aps/hubAdmin.ts) if your account provisions a bundle differently.

| Option | Product keys |
| --- | --- |
| BIM Collaborate | `designCollaboration`, `modelCoordination` |
| Forma Takeoff | `takeoff` |
| Forma for Preconstruction | `takeoff`, `cost` |
| AutoSpecs | `autoSpecs` |
| Forma Build | `build` |
| Forma Design Collaboration | `designCollaboration` |

### Project structure

```text
src/
  app/
    page.tsx                Overview
    projects/               Cross-project rollup
    activity/               Event explorer
    extracts/               Data Connector requests, jobs, ingest
    tools/                  21 tool dashboards + extract upload
    manage/                 Bulk member / project operations
    actions.ts              Server actions (sync, request, ingest)
    api/aps/login|callback  OAuth 3-legged flow
    api/activity/export     Filtered CSV download
    api/dataset/upload      Extract ZIP ingestion
    api/dashboards/[id]     Computes one dashboard on demand
  lib/
    dashboards/specs.ts     The 21 dashboard definitions  ← add KPIs/charts here
    dashboards/engine.ts    Spec -> SQL, join rules
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

### APS endpoints used

| Purpose | Endpoint | Scope |
| --- | --- | --- |
| Authorize / token | `authentication/v2/authorize`, `/token` | — |
| Hub membership gate | `GET project/v1/hubs` | `data:read` |
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

### UI conventions

Autodesk brand colours only. Dark surfaces use black backgrounds with white body text and yellow titles; light surfaces are off-white with black text. Blue and Teal carry data, per the rule that Blue is for data/tech rather than a general accent.

**Yellow `#FFFE00` is the action accent** — buttons, active tabs, selected-state borders, and status dots. Anything sitting on yellow is black text, and every yellow *fill* carries a 1px `#D5D5CB` (`accent6`) border, the same border used on cards, inputs, and tables, so the fills stay defined against both the off-white body and the black header.

Yellow *outlines* — active tab underline, selected chips, and focus rings — keep their yellow because a gray border there would erase the signal it exists to carry.

This deliberately departs from the brand note that yellow is for dark-slide titles only. Flame Orange stays defined in the palette but is unused.

The header mark is `public/autodesk-logo.png` — the white-on-transparent "dark background" variant — so it reads on the black header only. Do not reuse it on light surfaces.

Type is Artifakt Legend for headings and Artifakt Element for body, with Arial as the sole fallback; the two are never mixed.

---

## Deployment

Running this on localhost for yourself and running it for a team are different propositions. The difference is **the local cache**.

Everything the app calls with the signed-in user's token — Admin reads, Data Connector, and Manage writes — is permission-checked by Autodesk. But the dashboards and activity views are served from this app's own SQLite cache, so nothing upstream is checking those cached reads.

For shared deployment, access is gated on **hub membership**. At sign-in, and every 30 minutes thereafter, the app asks Data Management which hubs the account can reach (`GET /project/v1/hubs`) and requires `FORMA_HUB_ID` to be among them. Anyone else gets a 403 explaining why.

The check fails closed: a network error or 5xx from Autodesk denies access rather than allowing it. Re-running the check on a timer means someone removed from the hub loses access without anyone having to remember to revoke it. See [`src/lib/aps/authorization.ts`](src/lib/aps/authorization.ts).

If you need tighter controls — for example, limiting extract submission to a few people because the Data Connector quota of 24 jobs per hub per 24 hours is shared — add a named-user check on top.

### Before the first deployment

1. **Rotate the client secret** if it has ever been pasted into a chat, ticket, or document, and set the new one only in your platform's secret store.
2. **Register the deployment's callback URL** on the APS app — `https://your-host/api/aps/callback` — and set `APS_CALLBACK_URL` to match exactly. It must use HTTPS because the session cookie's `Secure` flag is derived from this value.
3. **Provision a persistent volume** at `/data`. Without one, the uploaded extract, activity cache, and all sessions vanish on restart.
4. **Re-consent.** Existing sessions may predate the `account:write` scope. Sign out and back in or Manage writes return 403.

### Render

The repository ships a Blueprint, so Render does the wiring:

1. Select **New > Blueprint** in Render and point it at this repository. Render reads `render.yaml`.
2. Set the four secrets in the **Environment** tab when prompted: `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, `APS_CALLBACK_URL`, and `FORMA_HUB_ID`. `APS_CALLBACK_URL` should be `https://<your-render-host>/api/aps/callback`.
3. Register that same callback URL on the APS app or sign-in fails with an invalid `redirect_uri`.
4. Deploy. `/api/health` gates it. A 503 there means configuration is incomplete or the disk is not mounted, which is what you want to find out at deploy time.

**The Blueprint is set to Render's free instance type, so storage is temporary.** Free instances get no persistent disk. The original implementation notes describe files as being lost whenever the service redeploys, restarts, or spins down, and note that a free service sleeps after 15 minutes idle, waking in about a minute. Sessions, the uploaded extract, and the activity cache therefore reset on restart or idle-period reset.

The app still runs because, unlike a serverless host, the filesystem is writable. Sign-in and uploads work. `EPHEMERAL_STORAGE=true` shows a banner explaining the behavior so the reset reads as expected rather than as a fault.

To recover after a wipe, sign in and re-ingest a completed job from **Extracts**. That re-downloads from Autodesk and spends none of the hub's 24-jobs-per-24-hours quota.

**To make data stick**, set `plan: starter` in `render.yaml` and uncomment the `disk` block. The original implementation notes estimate approximately $7/month for the instance plus approximately $1.25/month for 5 GB. A service with a disk cannot scale past one instance, which suits SQLite anyway.

### Docker and other hosts

```bash
docker compose up --build
```

`docker-compose.yml` reads secrets from the host environment rather than baking them into the file.

The image is a standalone Next.js server on Node 24 with no database server and no native modules. Adapt it to whatever platform you use; the only hard requirements are a writable volume at `/data` and the four environment variables.

`GET /api/health` is the probe. It returns 503 while configuration is incomplete or the volume is not writable, 200 otherwise, and exposes no hub data.

### Choosing a host

**Container or VM with a volume** — Render (a `render.yaml` Blueprint is included), Railway, Fly.io, ECS/Fargate with EFS, an internal PaaS, or a plain VM all fit the architecture as built.

**Serverless platforms such as Vercel will not work unchanged.** The implementation notes report that this was tried and confirmed. The filesystem is read-only apart from an ephemeral `/tmp`, and this app writes one SQLite file that holds sessions, OAuth state, the extract, and the activity cache.

Specific failure modes documented in the implementation:

- Sign-in 500s on the first click because `buildAuthorizeUrl()` hits the database before any cookie exists, so it tries to create a directory on a read-only volume.
- `DATA_DIR=/tmp` does not rescue it because `/tmp` is per-instance. The OAuth `state` written by `/api/aps/login` often is not visible to `/api/aps/callback`, so sign-in fails on the mismatch.
- The implementation notes state that Vercel caps request bodies around 4.5 MB while a full hub extract is approximately 11 MB, so the upload is rejected outright.

Going the serverless route means moving the dataset, activity cache, and session store to a hosted database and switching the upload to direct-to-blob. That is the largest change on this list.

**Sharing only the code is also a legitimate deployment model.** Each person runs it locally with their own APS credentials and their own cache; nothing is centrally hosted and there is no shared data to protect.

### Data storage and security

The volume holds real hub data, including project names, member emails, activity, and cost figures. Host it somewhere sanctioned for that data and put the deployment through whatever security and privacy review your team normally requires before sharing the URL.

---

## Known limitations

- **No live cross-project activity endpoint.** Activity depends on asynchronous Data Connector extracts and the local SQLite cache.
- **Extraction is quota-limited.** Autodesk caps extraction at 24 jobs per hub per 24 hours and 24 per user.
- **Activity history is limited to the last 12 months**, with a maximum 31-day window per request and replication lag of up to approximately 20 minutes.
- **Dashboards represent the hub-level page of each Power BI template**, not every page or every visual in the source templates.
- **Computed Power BI columns are not available in the CSV extracts.** The dashboard specs use the closest raw equivalent where necessary.
- **There is no hub-wide roles endpoint.** The Roles view depends on `admin_project_roles.csv` from the uploaded extract.
- **Project archiving uses an older BIM 360 Account Admin endpoint.** The source implementation notes state that it works for the tested Forma hub even though Autodesk's compatibility table marks the endpoint as unsupported for Forma projects.
- **There is no un-archive action in the UI.** Restoring a project requires the reverse status change in Forma or an additional implementation in this app.
- **Product access mapping should be verified against the hub's entitlements** before a large import.
- **Serverless hosting is not supported without architectural changes** because the app depends on writable, persistent SQLite storage and extract uploads.

---

## Operational considerations

- **The cache holds real hub data** — both the activity cache and the uploaded CSV extract. `.data/` is gitignored; treat it as sensitive and delete it when you are done. Deleting it is safe because re-uploading and re-ingesting rebuilds it.
- **Uploading an extract replaces the tables it contains** and leaves other tables alone. Mixing two extracts is therefore possible; upload a complete one to keep the picture consistent.
- **Sessions are server-side.** The cookie is an opaque random ID; tokens live in SQLite, never in the browser. Refresh tokens are rotated on use.
- The original README also states: **"This is a localhost internal tool with no authorization layer of its own — anyone who can reach the port inherits the signed-in session. Don't expose it beyond localhost without adding auth."** This statement appears alongside the shared-deployment hub-membership gate described above. Verify which access-control description matches the current implementation before exposing the application beyond localhost.

---

## License

This sample is intended to use the **MIT License** in accordance with the Autodesk code-sample guidelines.

Include a `LICENSE` file containing the MIT License in the repository root.
