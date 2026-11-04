# Known limitations

## Synthetic portfolio only

All projects, members, companies, activity, permissions, jobs, tables, integration contracts, schema notices, and closeout evidence are fictional. Fixture dates and freshness indicators do not establish that Autodesk was queried. No displayed exception establishes real noncompliance, inactivity, access risk, integration breakage, or project completion.

## Anonymous access

Anyone can explore the demo without an Autodesk account, authentication session, or Forma hub role. The demo makes no APS API calls and stores no verified visitor identity or Autodesk tokens. It does not provide real-hub portfolio data or administrative capabilities. The separate live application still requires Autodesk sign-in, Hub Admin / Executive Overview access for portfolio data, and Hub Admin for administrative changes.

Browser-local preferences have no account separation. People sharing a browser profile share its demo preferences. Deployment-provider request logs are governed by the provider's settings.

## No live operations

Unavailable operations include customer-data uploads, project/access refreshes, extraction requests or ingestion, organization edits, permission changes, public-schema capture, background monitoring, project scans, document downloads, package generation, transmittal creation, and owner acceptance.

Retained shared modules demonstrate portions of the live architecture, but cannot make APS hub calls in this deployment. API metadata and fixture notices do not guarantee current Autodesk API availability or migration dates.

## State and reset behavior

The read dataset is seeded independently in each process from the same fictional October 1, 2026, 12:00 UTC snapshot and is immutable to visitors. It is not a mutable shared hub. Cold starts and redeployments reinitialize the same sample; browser-local preferences remain subject to the browser's storage behavior.

Administrative simulations exist only in the current React view. Leaving or resetting that view restores its sample workspace and clears its simulated history. Other portfolio pages continue showing the immutable initial dataset.

Saved views, watchlist entries, favorites, and review decisions are browser-local. They can disappear when browser storage is cleared or unavailable, do not synchronize across devices, and are not durable audit or acceptance records. Watchlists do not monitor changes or send notifications. Personal review decisions appear on individual rows and do not change the fixed sample portfolio counts. Resetting demo preferences clears saved views, watchlist entries, and review decisions; tool favorites remain separate.

## Reporting limits

Dashboard joins and counts depend on fixture tables and identity mappings. Missing or unresolved values remain visible rather than becoming facts about real users. Some source records are intentionally incomplete. Exported rows are fictional and are not a validated Autodesk reporting extract.

Project members and active people are different metrics: assigned membership versus activity identities observed in a sample window. Product access records are not commercial subscription balances.

## Integration Health limits

Consumers declare their own dependencies in the live architecture; the public demo uses canned examples. It does not inspect downstream source code, Power BI refreshes, ETL systems, API traffic, or customer subscriptions. A readiness result demonstrates local evidence checks only; it is not production compatibility certification.

There is no server scheduler, CDC monitor, or live deprecation feed in this deployment. Running the demo in a long-lived Dokku container does not enable monitoring or scheduled checks.

## Closeout limits

Sample turnover evidence does not establish document approval, asset completeness, regulatory compliance, or owner acceptance. Document examples are metadata, not downloaded file binaries. No actual package, signed acceptance, or immutable closeout history is produced by the demo.

## Deployment limits

No APS application, credentials, callback registration, session secret, real hub ID, or application environment variables are required. No persistent volume is needed. Preview URLs work without callback registration. Browser-local preferences are not a shared server store.

The preferred [Dokku deployment](DOKKU.md) uses the organization's `demo` branch. This source change performs no deployment. The hosting administrator must switch the branch and fetch and build the new source; changing `LENS_MODE` on live `main`, restarting the app, or rebuilding an old checkout is insufficient. The private webhook sync secret remains unchanged. The `main` branch retains live authentication and authorization, and the personal repository and Vercel deployment remain unchanged.
