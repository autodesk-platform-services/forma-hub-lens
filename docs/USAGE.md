# Usage

## Overview

The **Overview** page shows hub-wide totals, events per day, busiest projects and people, and which projects have *no* activity in the ingested window.

- `Sync projects` pulls the hub project list from the Admin API.
- `Refresh jobs` pulls Data Connector job state.
- The page also shows the running Data Connector extraction count, which matters because Autodesk caps extraction at 24 jobs per hub per 24 hours and 24 per user.

## Projects

The **Projects** page shows every project from the Admin API joined against ingested activity, including:

- events,
- distinct people,
- last event,
- services touched,
- member counts, and
- sheet counts.

Click a project to filter **Activity** to that project.

## Activity

The **Activity** page is the event explorer. Filter by date, project, service, action, person, or free text. Free-text search also searches the untouched source row.

`Export CSV` downloads exactly what is on screen, including filters. Every row can be expanded to show the raw extract row.

## Extracts

The **Extracts** page lets you:

- submit a Data Connector data request,
- watch jobs,
- ingest completed extracts, and
- review the column-mapping report after ingestion.

## Tools

The **Tools** page contains 21 Forma tool dashboards. This path is separate from this app's **Extracts** page. In Autodesk Construction Cloud, open a project in the target hub and choose **Insight** in the product picker, then **Data Connector** in Insight's left sidebar. [Autodesk's Data Connector guide](https://help.autodesk.com/cloudhelp/ENU/Docs-Insight/files/Data_Connector.html) describes the permissions and extraction steps. If the product picker does not expose Insight from the hub view, open a project first; a project dashboard may use `https://acc.autodesk.com/insight/accounts/<hubId>/projects/<projectId>/my-dashboard`, with IDs for a project you can access.

Run an extraction in Insight and wait for the completion email sent to the requesting account. Return to Insight's Data Connector area and download the ZIP. In this app, go to **Tools → Choose File → Upload extract**. Dashboards enable only when their required CSVs are present. The table and row totals reflect the uploaded ZIP; a warning appears if a CSV reaches the 400,000-row import cap.

`Sync projects` on **Overview** only updates the Admin API project list. It does not download the Insight ZIP or enable Tools dashboards. Insight extractions also do not appear in this app's **Extracts** job list.

Each file is loaded under its own name. For example, `admin_projects.csv` becomes the `admin_projects` table. That is how the Power BI templates bind their data (`Csv.Document(File.Contents(SourceFolder & "\\admin_projects.csv"))`), so the same extract that drives the `.pbit` files drives these dashboards.

Selecting a tool opens a near-full-screen dashboard. Use **Esc**, **Close**, **Back to tools**, or click outside the dashboard to return to the menu. A tool is greyed out when its primary CSV is not in the extract.

## Manage

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

## Typical workflow

1. Go to **Extracts** → pick a window → check `activities` → **Submit data request**.
2. Wait for the Data Connector job to complete, then use **Refresh jobs** until the job reads `complete`.
3. Select **Ingest**. The rows land in the cache and every other page fills in.

Ingesting overlapping windows is safe. Rows are de-duplicated by fingerprint, so you can re-ingest without creating duplicates.

To enable the **Tools** dashboards independently:

1. In Autodesk Construction Cloud, open **Insight › Data Connector** for an accessible project in the hub, request the needed tool data, and download the CSV ZIP after the completion email arrives.
2. In this app, open **Tools**, choose the ZIP, then select **Upload extract**.
3. The counter and dashboard cards update for the CSVs present. Tools whose source CSVs are absent remain unavailable.

---

## Development

### Prerequisites

Before running the sample locally, you need:

- Node.js 22 or later,
- npm,
- an Autodesk Platform Services application configured as a **Traditional Web App**,
- access to an Autodesk Forma hub,
- a Forma account with **Hub Admin** or **Executive Overview** rights, and
- APS application credentials, and
- the APS Client ID provisioned for the target Forma/ACC account under **Hub Admin › Custom Integrations**; follow [Autodesk's provisioning steps](https://get-started.aps.autodesk.com/#provision-access-in-other-products).

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
| `APS_CALLBACK_URL` | Must exactly match a callback registered on the APS app. Use `http://localhost:3000/api/aps/callback` locally. Autodesk tutorial examples use port 8080; this app uses port 3000 and a different callback path. |
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
npm test                 # CSV, data import, dashboards, OAuth, hub gate, and archive guards
npm run typecheck
npm run build
npm run sample-extract   # writes sample-extract.zip — a synthetic extract for trying the Tools tab
```

`npm run test:dashboards` builds a synthetic extract with the real CSV and column names, ingests it, then asserts that every KPI and every chart on all 21 dashboards resolves and returns rows.
