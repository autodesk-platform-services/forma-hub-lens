# Forma Hub Lens

![platforms](https://img.shields.io/badge/platform-local%20%7C%20container-lightgray.svg)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-blue.svg)](https://nodejs.org)
[![license](https://img.shields.io/:license-mit-green.svg)](LICENSE)
[![Autodesk Forma](https://img.shields.io/badge/Autodesk%20Forma-Admin%20%7C%20Data%20Connector-lightblue.svg)](https://aps.autodesk.com/)
![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)
![React](https://img.shields.io/badge/React-19-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)
![Level](https://img.shields.io/badge/Level-Intermediate-yellow.svg)

![Forma Hub Lens overview illustration](thumbnail.png)

## Objective

Forma Hub Lens brings portfolio reporting, access review, Data Connector workflows, and bulk administration into one web app for a configured Autodesk Forma hub. **Hub Admin** and **Executive Overview** users can read the portfolio; live administration writes, project sync, and shared dataset replacement require a fresh Hub Admin check. Autodesk may impose additional permissions on individual APIs.

## What it does

- **Overview and Projects:** review project inventory, activity trends, lifecycle candidates, and source coverage.
- **People and Access:** inspect uploaded membership and product records, compare people, and browse Docs folder permission assignments.
- **Insights:** explore activity, tool dashboards, governance prompts, saved views, and cross-project search.
- **Data:** request and ingest Data Connector jobs, inspect source health, and review integration and closeout evidence.
- **Admin:** preview bulk member and project changes, manage companies, use project recipes, prepare offboarding, and inspect the local operation audit.

There are two independent reporting paths. **Extracts** requests APS Data Connector jobs and ingests completed activity CSVs into the local activity cache; full reporting CSVs from completed APS jobs can also populate dashboards with verified job lineage. Separately, a Hub Admin can download a ZIP from Autodesk Construction Cloud **Insight › Data Connector** and upload it on **Tools**. Lens labels the origin of a user-uploaded ZIP as unverified. **Sync projects** updates the project list and does not populate either reporting path.

## Prerequisites

- Node.js 22 or later and npm.
- An APS **Traditional Web App** whose Client ID is provisioned for the target Forma account under **Hub Admin › Custom Integrations**. Follow [Autodesk's provisioning steps](https://get-started.aps.autodesk.com/#provision-access-in-other-products).
- The Forma hub ID and a sign-in account with Hub Admin or Executive Overview access.
- An APS OAuth callback registered exactly as `http://localhost:3000/api/aps/callback` for local use. This app runs on port **3000**.

## Quick start

```bash
npm install
cp .env.example .env.local
# Fill APS_CLIENT_ID, APS_CLIENT_SECRET, and FORMA_HUB_ID in .env.local.
npm run dev
```

Open <http://localhost:3000> and sign in. Keep `.env.local` private; it is ignored by Git. The app stores sessions and ingested hub data in a local SQLite directory, so use an approved persistent volume and access policy for shared deployment.

## Documentation

- [Usage and local setup](docs/USAGE.md)
- [Feature guide and source limits](docs/FEATURES.md)
- [Integration Health and Closeout workflows](docs/INTEGRATION-HEALTH-AND-CLOSEOUT.md)
- [Architecture and APS endpoints](docs/ARCHITECTURE.md)
- [Deployment considerations](docs/DEPLOYMENT.md)
- [Known limitations](docs/LIMITATIONS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

[MIT](LICENSE). Copyright © 2026 Autodesk Platform Services.

## Author

[Autodesk Platform Services](https://github.com/autodesk-platform-services).
