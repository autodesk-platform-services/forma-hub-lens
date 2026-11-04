# Deployment

The preferred public demo target is [forma-hub-lens.autodesk.io](https://forma-hub-lens.autodesk.io/), for Dokku deployment from [`autodesk-platform-services/forma-hub-lens` → `demo`](https://github.com/autodesk-platform-services/forma-hub-lens/tree/demo). Visitors open a synthetic portfolio directly without Autodesk sign-in.

**No Dokku deployment is performed by this source change.** A hosting administrator must configure the `demo` branch, pull that source, and build and deploy it. Changing `LENS_MODE` on the existing live `main` build is insufficient. A restart, or `ps:rebuild` against the old checkout, can continue using live `main` source.

## Dokku: primary deployment

Follow [Dokku setup and branch switch](DOKKU.md) for the exact hosting UI values, staged CLI alternative, Dockerfile builder, and verification steps.

- Source repository: `https://github.com/autodesk-platform-services/forma-hub-lens.git`
- Source branch: `demo`
- App: `forma-hub-lens`
- Runtime: non-root Node.js 24, Next.js standalone Docker image, immutable fixtures in memory.
- Required application credentials: none. No APS client, callback, session secret, or real hub ID is needed.
- Existing webhook `DOKKU_SYNC_SECRET`: keep private and unchanged.
- Persistent volume, external database, scheduler, and live APS access: none.

The organization's [`main` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/main) retains the authenticated live implementation, including Hub Admin / Executive Overview access checks and Hub Admin write checks. Publishing or deploying `demo` does not disable those checks on `main`.

## Vercel: optional separate deployment

The personal [rachermatt/forma-hub-lens-demo repository](https://github.com/rachermatt/forma-hub-lens-demo) and [forma-hub-lens.vercel.app](https://forma-hub-lens.vercel.app/) deployment remain separate and unchanged by the organization's demo branch. Use the [optional Vercel guide](VERCEL.md) only when administering that deployment. There is no need to reconnect or migrate the existing Vercel project for the Dokku change.

## Public demo verification

After the administrator deploys the new source:

- Open the target in a private browser window. The portfolio must open without an Autodesk redirect or role prompt.
- Confirm the banner reads **“Synthetic demo hub — all data and administrative actions are simulated. No Autodesk sign-in required.”**
- Confirm the sample portfolio and all 21 dashboards load.
- Run and reset a bulk simulation; its results must remain explicitly simulated.
- Confirm uploads, live refreshes, Data Connector requests, project scans, Autodesk downloads, package generation, and scheduling remain unavailable.
- Confirm saved views, watchlists, favorites, and review decisions are browser-local and do not create monitoring.
- If configured, confirm **Live hub** opens a separately hosted live application with its own sign-in and role checks.

Source checks are `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:smoke`. They use fixtures and need no APS credentials. Passing local checks does not verify that the hosting administrator deployed the expected branch and commit.
