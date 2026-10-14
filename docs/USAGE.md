# Usage

## Overview

The **Overview** page shows hub-wide totals, events per day, busiest projects and people, and which projects have *no* activity in the ingested window.

Its **Saved portfolio** card shows this Autodesk identity's counts of saved views, watched projects, and watched people, with a link to **Saved**. These are local bookmarks; the counts do not indicate alerts or changes in Autodesk data.

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

Click a project to open its scorecard, then follow **Investigate activity** to filter Activity to that project.

Open a project's **scorecard** to compare observed activity, project metadata, extract coverage, workflow backlog from uploaded tables, lifecycle checks, and governance prompts. The sections identify which local source supplies each observation. A count of zero in an incomplete extract is not proof that the live project is clear.

## Activity

The **Activity** page is the event explorer. Filter by date, project, service, action, person, or free text. Free-text search also searches the untouched source row.

`Export CSV` downloads exactly what is on screen, including filters. Every row can be expanded to show the raw extract row.

## Extracts

The **Extracts** page lets you:

- submit a Data Connector data request,
- watch jobs,
- ingest completed extracts, and
- review the column-mapping report after ingestion.

A **Hub Admin** can create an **APS recurring request** with a relative activity window and refresh the cached request definitions, subject to Autodesk Data Connector permissions. Lens repeats a live Hub Admin check before requesting or scheduling an extract, refreshing jobs or schedules, or ingesting completed activity/reporting data. Executive Overview users can view the cached extract and dashboard information. For one-time or recurring requests, leave the optional project selector empty for a hub-wide extract, or select up to 50 projects. Autodesk's own Data Connector entitlement and project permissions also apply. APS runs the schedule; this app does not ingest those jobs automatically. Use **Refresh jobs**, then **Ingest** on each completed activity job. The schedules table does not provide a verified next-run time, and this app does not offer pause or delete controls. A schedule absent from the latest complete APS refresh is labeled unverified rather than active.

## Tools

The **Tools** page contains 21 Forma tool dashboards. This path is separate from this app's **Extracts** page. In Autodesk Construction Cloud, open a project in the target hub and choose **Insight** in the product picker, then **Data Connector** in Insight's left sidebar. [Autodesk's Data Connector guide](https://help.autodesk.com/cloudhelp/ENU/Docs-Insight/files/Data_Connector.html) describes the permissions and extraction steps. If the product picker does not expose Insight from the hub view, open a project first; a project dashboard may use `https://acc.autodesk.com/insight/accounts/<hubId>/projects/<projectId>/my-dashboard`, with IDs for a project you can access.

Run an extraction in Insight and wait for Autodesk's completion email (sent to the Hub Admin in the reviewed setup). Use its **View in Data Connector** link, or return to Insight's Data Connector area, and download the ZIP. A **Hub Admin** can then go to **Tools → Choose File → Upload extract** to replace shared reporting tables. Dashboards enable only when their required CSVs are present. The table and row totals reflect the uploaded ZIP; a warning appears if a CSV reaches the 400,000-row import cap. ZIP uploads are limited to 256 MB compressed, 128 MB per inflated entry, 512 MB inflated total, and 500 entries.

Lens does not authenticate a user-supplied ZIP or verify which Autodesk hub produced it. The Tools upload list labels its source hub **unverified**; interpret reports from that dataset accordingly. Executive Overview users may view the resulting dashboards, but cannot replace the shared ZIP dataset.

`Sync projects` on **Overview** only updates the Admin API project list. It does not download the Insight ZIP or enable Tools dashboards. Insight extractions also do not appear in this app's **Extracts** job list.

Each file is loaded under its own name. For example, `admin_projects.csv` becomes the `admin_projects` table. That is how the Power BI templates bind their data (`Csv.Document(File.Contents(SourceFolder & "\\admin_projects.csv"))`), so the same extract that drives the `.pbit` files drives these dashboards.

Selecting a tool opens a near-full-screen dashboard. Use **Esc**, **Close**, **Back to tools**, or click outside the dashboard to return to the menu. A tool is greyed out when its primary CSV is not in the extract.

## People and access matrix

Upload an Insight ZIP with `admin_users.csv` and `admin_project_users.csv`, then open **People**. Search the user directory, select a person to inspect their uploaded record and project memberships, or switch to **Access matrix** to filter memberships by person, project, or status. Product access needs `admin_project_user_products.csv`; project names need `admin_projects.csv`. Each view shows import timestamps, missing inputs, and truncation warnings. It joins records by source IDs and does not guess that a role definition in `admin_project_roles.csv` belongs to a person.

## Portfolio review

- **Search** finds projects from the last **Sync projects** and people/companies from uploaded `admin_users.csv` and `admin_companies.csv`. Results are paginated and show their source age.
- **Governance** shows quiet-project, past-end-date, missing-job-number, large-membership, and no-project-members review prompts. You can adjust the quiet-day and membership thresholds. Review the source window before interpreting a quiet project.
- **Lifecycle** lists possible archive candidates and the archived projects in the synced inventory. Open a project scorecard and verify open work and contractual requirements in Forma before using Manage to archive.
- **Permissions** browses Docs folders for a synced project and displays Autodesk's assignment records for the selected folder. Folder visibility follows the signed-in user's Autodesk access. The page does not calculate effective permissions for an individual user.
- **Data health** shows locally known failed jobs, activity jobs needing ingest, import age and truncation, tool source gaps, mixed ZIP lineage, and CSV-header changes since a local baseline. Its 72-hour age rule is a review aid, not an Autodesk freshness guarantee.
- **Saved** stores Activity, People, Governance, and Search filter links and bookmarks projects or people under your Autodesk identity. Overview shows the bookmark counts. Saved does not monitor source changes or send alerts.

See the [feature guide](FEATURES.md) for source and scope details for all 13 feature areas.

## Manage and administrator workflows

The **Manage** page performs hub-management writes. These operations require Hub Admin access and `account:write`. Each operation has a preview, a single-use execution step, and a local per-item audit record. Preview plans expire after ten minutes; review the result and audit log after execution. Accepted bulk member imports may still be processing in Autodesk.

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

**Offboarding** lets a Hub Admin look up one exact email in Autodesk's live hub directory, inspect project/product/role associations, and prepare project-membership removal batches through the same Manage preview and audit. It does not remove the person from organization-wide Autodesk User Management. Its last observed activity is from the local extract and may be incomplete.

**Recipes** saves project creation defaults per signed-in Autodesk user and hub. Refresh native template projects, save a recipe, enter project names, inspect the generated names/job numbers in the preview, then execute. Project creation and template application are asynchronous. After Autodesk has activated the new projects, run **Sync projects**, follow the recipe's **Use saved member presets** link into Manage, select the active projects, and review the prefilled member emails, products, access level, and invitation-email setting. The existing **Add Members** preview and confirmation sends that separate import; recipe creation itself does not assign members. The link loads the *current saved recipe*, so review its values if you edited the recipe after project creation.

The **Administrative audit** under Manage records only actions initiated by this app. Its list, operation details, and exports require a fresh Hub Admin check. Open an operation for per-item status or export its record. “Submitted” means Autodesk accepted an asynchronous request; it does not confirm that membership has finished applying.

## Typical workflow

1. Go to **Extracts** → pick a window → check `activities` → **Submit data request**.
2. Wait for the Data Connector job to complete, then use **Refresh jobs** until the job reads `complete`.
3. Select **Ingest**. The rows land in the activity cache and the activity-based views update. Tools, People, company search, and workflow tables still need the separate Insight ZIP.

Ingesting overlapping windows is safe. Rows are de-duplicated by fingerprint, so you can re-ingest without creating duplicates.

To enable the **Tools** dashboards independently:

1. In Autodesk Construction Cloud, open **Insight › Data Connector** for an accessible project in the hub, request the needed tool data, and download the CSV ZIP after the completion email arrives.
2. As a Hub Admin, open **Tools**, choose the ZIP, then select **Upload extract**.
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

Sign in with an account that holds **Hub Admin** or **Executive Overview** on the configured hub. At sign-in and periodically afterward, the app verifies the signed-in identity against that hub's account directory and denies other roles. Either admitted role can view portfolio reports, cached Extracts information, and Tools dashboards. A fresh Hub Admin check is required for extract requests, scheduling, job/schedule refreshes, activity/reporting ingestion, shared ZIP dataset replacement, project sync, recipe writes, offboarding, live Manage operations, schema acknowledgement, closeout package downloads, and administrative audit access. Autodesk may further limit API operations and live Docs reads to resources your account can access.

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
npm test                 # Regression tests for data, dashboards, authentication, and features
npm run typecheck
npm run build
npm run sample-extract   # writes sample-extract.zip — a synthetic extract for trying the Tools tab
```

`npm run test:dashboards` builds a synthetic extract with the real CSV and column names, ingests it, then asserts that every KPI and every chart on all 21 dashboards resolves and returns rows.
