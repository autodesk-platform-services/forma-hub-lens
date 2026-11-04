# Architecture and APS endpoints

## Demo boundary

The organization's [`demo` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/demo) is an anonymous **demo-only** application. `LENS_MODE` defaults to `demo` and rejects any other value. The hub identifier is a fixed fictional ID; no real `FORMA_HUB_ID` is used. The optional Live hub link navigates to a separate deployment and cannot enable live access in this app.

The organization's [`main` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/main) retains the live implementation. It requires Autodesk sign-in, retains its Hub Admin / Executive Overview checks, and requires Hub Admin for administrative changes.

## Runtime

- Next.js App Router, React, TypeScript, and Node.js 24.x.
- Node's SQLite runtime is used for the bundled fictional reporting and portfolio data in memory.
- Each process initializes the same fictional snapshot, anchored at October 1, 2026, 12:00 UTC. A cold start does not need a persistent disk or shared SQLite file.
- The dataset is immutable to public visitors; server mutations and APS API calls are blocked.
- Client state handles administrative simulations; browser-local storage handles bookmarks, favorites, and review decisions.

The production Dockerfile uses Next.js standalone output and a non-root Node.js 24 process. No persistent database, Redis service, authentication cookie, session store, or mounted volume is required for the demo.

## Anonymous access

Visitors open portfolio pages and synthetic read endpoints directly. The application does not collect or verify an Autodesk identity, establish an OAuth session, exchange authorization codes, or store visitor access/refresh tokens.

Compatibility routes for old login and callback links return to the home page. They do not restart the previous sign-in flow. Public access to fictional data does not authorize live operations: retained write and live-APS boundaries remain disabled.

## APS endpoints used by the demo

**None.** The anonymous demo does not call OAuth, User Profile, account administration, project administration, Data Connector, Files, Assets, Issues, Reviews, Classifications, or other APS endpoints. It does not need an APS application or callback registration. Retained shared modules and fixtures illustrate the separate live implementation; their presence does not enable APS calls in this deployment.

## Data and presentation

`demoFixtures.ts` generates fictional Data Connector-style tables. The demo seed combines these with fictional portfolio, job, permission, integration, and closeout examples. Existing query and dashboard engines operate on those tables, allowing a realistic read experience without customer data.

The persistent banner is:

> Synthetic demo hub — all data and administrative actions are simulated. No Autodesk sign-in required.

Sample labels identify synthetic records. Fixture dates are relative to the fixed synthetic snapshot clock and are illustrative. No externally configured data contract, real extract, or customer document is imported.

## State and exports

Administrative previews and results exist only in the current React view. They are not server audit entries and do not update other pages' source dataset. Bookmarks, favorite tools, and review decisions are browser-local; they do not synchronize or trigger monitoring. People sharing a browser profile share its preferences; there is no account-based separation. Exports, where exposed, contain fictional records only. Autodesk file downloads and handover package generation are disabled.

## Deployment

[Dokku deployment](DOKKU.md) targets the organization's `demo` branch at [forma-hub-lens.autodesk.io](https://forma-hub-lens.autodesk.io/). No application credentials are needed. Optional `LENS_MODE=demo` makes the default explicit; optional `LENS_LIVE_URL` adds an external link. The hosting administrator must fetch and build the new demo source; changing a mode variable on live `main` or restarting an old checkout is insufficient. Keep the existing private webhook sync secret unchanged.

The separate live implementation on `main` retains its sign-in and role checks. The personal repository and Vercel deployment are unchanged; [Vercel](VERCEL.md) remains an optional separate hosting path.
