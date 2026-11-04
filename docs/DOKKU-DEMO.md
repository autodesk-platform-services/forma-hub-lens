# Dokku demo branch handoff

The organization's [`main` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/main) retains the live application, Autodesk sign-in, Hub Admin / Executive Overview access checks, and Hub Admin write checks. Its [live deployment requirements](DEPLOYMENT.md) still apply when deploying `main`.

The dedicated [`demo` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/demo) contains the anonymous synthetic application. The preferred target is [forma-hub-lens.autodesk.io](https://forma-hub-lens.autodesk.io/), using the existing `forma-hub-lens` Dokku app. The no-sign-in behavior belongs to the demo branch and does not disable authorization on `main`.

Publishing the demo branch does not redeploy the existing Dokku app. A hosting administrator must switch the configured branch, fetch that source, and build and deploy it using their existing hosting access. No root, AWS, or SSH credentials need to be shared with the application or included in the repository.

## Hosting UI settings

Update the existing repository-sync configuration for the app deliberately being converted to the demo:

| Setting | Value |
| --- | --- |
| `DOKKU_SYNC_REPO` | `https://github.com/autodesk-platform-services/forma-hub-lens.git` |
| `DOKKU_SYNC_BRANCH` | `demo` |
| `DOKKU_SYNC_SECRET` | Preserve the existing private webhook value unchanged |
| `LENS_MODE` | Optional: `demo`; the demo branch uses this default |

The sync settings belong to the existing hosting/webhook integration. They select source to fetch; they do not convert the running live app into the demo. Keep the existing sync secret private. Do not print it, commit it, rotate it, or remove it for this change.

The demo needs no APS application, client ID, client secret, OAuth callback, session secret, environment file, or real hub ID. Remove obsolete `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, `APS_CALLBACK_URL`, `DEMO_SESSION_SECRET`, and `FORMA_HUB_ID` only from the app being converted to the demo. Preserve credentials and data configuration for any separately hosted live application.

Stage the changes without restarting the old app. Then use the hosting UI's manual deploy action that **fetches the configured repository and `demo` branch and builds the new source**. Confirm the deployment details identify the expected demo commit. Setting only `LENS_MODE=demo` on the current live `main` build fails to install the demo. A plain restart or `ps:rebuild` may reuse the old `main` checkout.

## CLI alternative for the hosting administrator

Run on the Dokku host using existing administrator access. These commands target only `forma-hub-lens` and stage configuration without restarting it before the new source is fetched and built:

```bash
dokku config:set --no-restart forma-hub-lens DOKKU_SYNC_REPO=https://github.com/autodesk-platform-services/forma-hub-lens.git DOKKU_SYNC_BRANCH=demo LENS_MODE=demo
dokku config:unset --no-restart forma-hub-lens APS_CLIENT_ID APS_CLIENT_SECRET APS_CALLBACK_URL DEMO_SESSION_SECRET FORMA_HUB_ID
dokku builder:set forma-hub-lens selected dockerfile
dokku git:sync --build forma-hub-lens https://github.com/autodesk-platform-services/forma-hub-lens.git demo
```

The explicit Dockerfile selection handles an old builder setting or different automatic selection. `git:sync --build` fetches and builds the named branch; the branch argument also sets Dokku's deploy branch. See Dokku's official [configuration](https://dokku.com/docs/configuration/environment-variables/), [builder selection](https://dokku.com/docs/deployment/builders/builder-management/), and [Git sync](https://dokku.com/docs/deployment/methods/git/#initializing-an-app-repository-from-a-remote-repository) references.

If the fetch or build fails, resolve it using deployment logs before restarting an old checkout with the staged settings. A successful settings save is not proof of a successful deployment.

## Demo runtime and verification

Use the [Dockerfile from the demo branch](https://github.com/autodesk-platform-services/forma-hub-lens/blob/demo/Dockerfile), which builds Next.js standalone output on Node.js 24 and runs as a non-root user on port `3000`, host `0.0.0.0`. Retain the existing target domain, HTTPS, and proxy settings. The demo seeds immutable fixtures in memory and needs no persistent volume, external database, session store, background worker, or scheduler. Do not mount a live database or import customer extracts.

After deployment, open the target in a private browser window and verify:

- The portfolio opens directly without an Autodesk redirect, sign-in prompt, or role request.
- The persistent banner reads **“Synthetic demo hub — all data and administrative actions are simulated. No Autodesk sign-in required.”**
- The synthetic portfolio and all 21 dashboards load; bulk management runs an explicitly simulated operation and resets correctly.
- APS calls, live refreshes, customer uploads, Data Connector requests, live scans, Autodesk downloads, package generation, and scheduling remain unavailable.
- Saved views, watchlists, favorites, and review decisions stay browser-local and create no monitoring or notifications.

An optional `LENS_LIVE_URL` can link to a separately hosted live application with its own sign-in and authorization; it cannot enable live mode in the demo.

The personal [rachermatt/forma-hub-lens-demo repository](https://github.com/rachermatt/forma-hub-lens-demo) and [forma-hub-lens.vercel.app](https://forma-hub-lens.vercel.app/) deployment remain separate and untouched. The organization's Dokku deployment continues to use the organization repository; no personal Vercel reconnection or migration is required.
