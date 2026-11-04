# Troubleshooting

This guide is for the anonymous **demo-only** build. The current demo opens directly, makes no APS API calls, and requires no Autodesk account, credentials, callback registration, or session secret.

## The Dokku site still asks for Autodesk sign-in or shows a state-mismatch error

Check the hosting configuration and deployed commit. The preferred source is [`autodesk-platform-services/forma-hub-lens` → `demo`](https://github.com/autodesk-platform-services/forma-hub-lens/tree/demo). The organization's `main` branch is the live implementation and retains its sign-in and role checks.

Setting only `LENS_MODE=demo` on the current live `main` build does not install the demo. A plain restart or `ps:rebuild` may reuse an old checkout. The hosting administrator must set `DOKKU_SYNC_REPO=https://github.com/autodesk-platform-services/forma-hub-lens.git` and `DOKKU_SYNC_BRANCH=demo`, then manually fetch and build the new branch. Follow [Dokku deployment](DOKKU.md); keep the existing private `DOKKU_SYNC_SECRET` unchanged.

The current demo opens directly. Old `/api/aps/login` and `/api/aps/callback` links return home and do not run OAuth. Do not add APS credentials to repair the synthetic demo.

## Setup screen or invalid mode

On the new demo build, keep `LENS_MODE=demo` or leave it unset to use the demo default. This build rejects live mode. Remove a real `FORMA_HUB_ID`; the demo uses a fixed fictional identifier and cannot become the live application with an environment toggle.

No environment file is required. For hosting, stage optional settings without restarting the old app, then fetch and build the new `demo` source. Keep credentials for any separate live application in that application's configuration.

## Build fails or Node SQLite is unavailable

Use Node.js **24.x**. The Dokku path uses the root Dockerfile, Next.js standalone output, and a non-root runtime. If an old builder selection overrides it, the hosting administrator can select `dockerfile` using the command in [Dokku deployment](DOKKU.md). No persistent volume or external SQLite service is needed.

For local source validation, run `npm ci` from the repository root, then `npm run typecheck` and `npm run build`. Retain the committed package lock. Check deployment logs for the source commit and actual build failure without exposing credentials or customer records.

## The separate Vercel site still shows the old site

The personal [rachermatt/forma-hub-lens-demo repository](https://github.com/rachermatt/forma-hub-lens-demo) and its Vercel deployment are unchanged by the organization's `demo` branch. Check that separate project's Git connection, branch, expected commit, and domain assignment if deliberately administering it. Redeploying an old source commit does not import new source automatically. See [optional Vercel deployment](VERCEL.md).

A repository push or hosting configuration save does not prove that any deployment completed. Verify the target URL independently after a successful source fetch and build.

## Simulated changes disappear or other pages do not change

This is expected. Bulk administrative changes stay in the current simulator view and reset when you leave or press Reset simulation. Other portfolio pages use the immutable fixture dataset. No real hub record was modified.

## Saved items or review decisions disappear

These use browser-local storage. They do not synchronize across devices and can be removed by clearing site data, private browsing, or browser policy. Preview domains have separate site storage. There is no account separation within a browser profile; people using that profile share its demo preferences. Preferences are not a server audit or automated watchlist.

## Refresh, upload, monitor, or package action is unavailable

This is expected. The demo blocks APS API calls and server-side dataset changes. Integration Health and Closeout show read-only seeded examples; they do not scan live data, schedule checks, retrieve files, or build deliverables.

## Sample dates or freshness badges do not advance

The fixture snapshot is fixed at October 1, 2026, 12:00 UTC. Its dates illustrate the demonstration; they are not a live Autodesk refresh. Check the persistent synthetic-data banner and source badges.

## Opening the optional Live hub link

That link opens a separate deployment requiring Autodesk sign-in and its own authorization. Opening the demo grants no live-hub access. Configure `LENS_LIVE_URL` only when that separate destination is available and appropriate.
