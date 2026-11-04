# Usage and local setup

## What this build does

Forma Hub Lens (Demo) lets anyone explore a fictional portfolio directly in the browser. No Autodesk account or sign-in is required. Every hub record and administrative result is simulated, and the app makes no APS API calls.

The banner remains visible throughout the application:

> Synthetic demo hub — all data and administrative actions are simulated. No Autodesk sign-in required.

No Hub Admin or Executive Overview role is required in the demo. The live application on the organization's [`main` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/main) requires Autodesk sign-in and still enforces those roles. This anonymous build lives on its dedicated [`demo` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/demo).

## Local setup

1. Install Node.js 24.x and npm.
2. Run `npm ci` from the repository root.
3. Run `npm run dev` and open [localhost:3000](http://localhost:3000).

No environment file, APS application, credentials, callback registration, or session secret is required. Optional settings are `LENS_MODE=demo` (the default) and `LENS_LIVE_URL` for an external live-deployment link. Do not configure a real hub ID or copy live credentials into this demo. Local environment files are excluded from Git.

## Suggested walkthrough

### Observe

Start at **Overview** for sample KPIs, the attention queue, favorite tools, and activity summaries. The fictional snapshot is fixed at October 1, 2026, 12:00 UTC and is reproduced across cold starts. Dates and freshness badges belong to that snapshot; they do not report a live Autodesk refresh.

Open **Projects → Project inventory**. **Project members** counts assigned fictional memberships. **Active people (observed)** counts distinct identities seen in the sample activity window. These are different metrics. Use sorting to compare members, observed activity, services, or sheets, then open a project profile.

### Investigate

Use **People & Access** for the directory, access matrix, permission explorer, and offboarding plan examples. Person and company profiles connect the sample relationships. Every displayed portfolio identity is fictional.

Under **Insights**, open any of the 21 tool dashboards, filter **Activity**, or inspect grouped **Governance** findings. Multi-selection uses checkboxes and Select all shown. No observed activity is a sample-window observation, not a finding that a real project is inactive. Personal governance and lifecycle review decisions appear on individual rows; they do not remove findings from, or change counts in, the fixed sample portfolio summaries.

### Review data and closeout

Under **Data**, inspect sample extracts, Data Health, and Integration Health. Read a sample integration manifest and its migration or contract findings. No production pipeline is contacted and no scheduler is started.

Under **Projects → Closeout**, inspect a project, its turnover profile, source evidence, and exception list. The document metadata and asset relationships are fictional. This demo does not download project files or produce an accepted handover package.

### Practice administration

Open **Admin → Bulk management**. Choose sample projects and fictional email addresses, preview an operation, check the confirmation box, and run the simulation. The simulator verifies against its own in-memory workspace and displays simulated results. **Reset simulation** restores the initial view; leaving the view also resets it.

Try adding members, removing members, creating projects, and archiving projects. Product choices are demonstration inputs, not subscriptions or entitlements. The provisioning recipe is an immutable example.

## Personal browser state

Saved views, watchlist entries, governance/lifecycle review decisions, and favorite tools are stored locally in the browser. They are not server audit records, cross-device preferences, notifications, or scheduled checks. Clearing browser storage removes them. **Reset my demo preferences** clears saved views, watchlist entries, and governance/lifecycle decisions in this browser. Tool favorites are separate and can be changed in the tool library. Preferences are shared by people using the same browser profile; there is no visitor-account separation.

## Legacy sign-in links

Old demo login and callback links return to the home page. The current demo does not establish an Autodesk session or ask visitors to sign out. To access a real hub, open the optional **Live hub** link to the separate application and complete its own sign-in and authorization checks.

For public hosting, follow the [deployment overview](DEPLOYMENT.md) and [Dokku branch-switch guide](DOKKU.md). The preferred target is [forma-hub-lens.autodesk.io](https://forma-hub-lens.autodesk.io/). The hosting administrator must deploy the new `demo` source; this code change does not perform that deployment. The separate personal Vercel deployment remains unchanged, with [optional instructions](VERCEL.md).
