# Dokku deployment

Deploy the anonymous synthetic [`demo` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/demo) to the existing `forma-hub-lens` Dokku app. The preferred target is [forma-hub-lens.autodesk.io](https://forma-hub-lens.autodesk.io/). The organization's [`main` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/main) retains the live application and its Autodesk sign-in, Hub Admin / Executive Overview checks, and Hub Admin write checks.

This code change does not access AWS, SSH, or Dokku and performs no deployment. The hosting administrator uses their existing access to make the following changes. No root, AWS, or SSH credentials need to be shared with the application or included in this repository.

## 1. Set the source in the existing hosting UI

For the `forma-hub-lens` app, update the existing repository-sync configuration:

| Setting | Value |
| --- | --- |
| `DOKKU_SYNC_REPO` | `https://github.com/autodesk-platform-services/forma-hub-lens.git` |
| `DOKKU_SYNC_BRANCH` | `demo` |
| `DOKKU_SYNC_SECRET` | Keep the existing private webhook value unchanged |
| `LENS_MODE` | Optional: `demo`; this branch defaults to demo mode |

The `DOKKU_SYNC_*` values belong to the existing hosting/webhook integration. They select the source to sync; they are not an application mode switch. Do not print, copy into documentation, rotate, or remove the existing sync secret as part of this change.

No APS application, client ID, client secret, OAuth callback, session secret, or real `FORMA_HUB_ID` is needed. On the app being converted to the demo, remove obsolete `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, `APS_CALLBACK_URL`, `DEMO_SESSION_SECRET`, and `FORMA_HUB_ID` settings. Keep credentials for any separately hosted live application in that application's own configuration.

Stage settings without restarting the current app, then proceed immediately to the source sync/build. **Setting only `LENS_MODE=demo` on the current live `main` build fails to install the demo.** The new demo code must be fetched and built first.

## 2. Pull and build the new branch

After the new source is available on the organization's `demo` branch, use the hosting UI's manual deploy action that **fetches the configured repository and branch and builds it**. Verify its deployment details identify the new `demo` commit. A plain app restart or `ps:rebuild` can reuse an old `main` checkout and is insufficient for the initial switch.

The root `Dockerfile` builds a Node.js 24 Next.js standalone image and runs it as a non-root user. Use the Dockerfile builder for this app. The container listens on port `3000` on `0.0.0.0`; retain the app's existing domain, HTTPS, and proxy configuration for the target.

If the UI does not expose branch sync or builder selection, the hosting administrator can run these commands on the Dokku host instead. They target only `forma-hub-lens`:

```bash
dokku config:set --no-restart forma-hub-lens DOKKU_SYNC_REPO=https://github.com/autodesk-platform-services/forma-hub-lens.git DOKKU_SYNC_BRANCH=demo LENS_MODE=demo
dokku config:unset --no-restart forma-hub-lens APS_CLIENT_ID APS_CLIENT_SECRET APS_CALLBACK_URL DEMO_SESSION_SECRET FORMA_HUB_ID
dokku builder:set forma-hub-lens selected dockerfile
dokku git:sync --build forma-hub-lens https://github.com/autodesk-platform-services/forma-hub-lens.git demo
```

`--no-restart` stages configuration without restarting the running app. The Dockerfile builder can be selected explicitly when detection or a previous builder selection would choose another builder. `git:sync --build` fetches the named branch and builds it; passing the branch also sets Dokku's deploy branch. These commands follow the official [environment variable](https://dokku.com/docs/configuration/environment-variables/), [builder selection](https://dokku.com/docs/deployment/builders/builder-management/), and [Git sync](https://dokku.com/docs/deployment/methods/git/#initializing-an-app-repository-from-a-remote-repository) documentation.

If the fetch or build fails, inspect the administrator's deployment logs and resolve it before restarting an old checkout with the staged configuration. Confirm the successful build identifies the expected demo commit; a successful settings save alone is not a deployment.

## 3. Runtime storage and configuration

The demo initializes the same immutable synthetic portfolio in memory in each process. It requires no mounted volume, persistent SQLite file, Redis instance, session store, background worker, or scheduler. Do not mount a live database or copy customer extracts into the image.

Saved views, watchlists, favorites, and review decisions live in the browser, not in Dokku storage. Administrative simulations remain in the current browser view. They create no live changes, APS requests, scheduled checks, or monitoring.

`LENS_LIVE_URL` may optionally link to a separately hosted live application. It never changes this build's dataset or authorization. Leave it unset when no appropriate separate destination is available. The demo branch rejects live mode.

## 4. Verify the deployed source

Open [forma-hub-lens.autodesk.io](https://forma-hub-lens.autodesk.io/) in a private window and complete the [public demo verification](DEPLOYMENT.md#public-demo-verification). The exact persistent banner must be:

> Synthetic demo hub — all data and administrative actions are simulated. No Autodesk sign-in required.

If Autodesk sign-in, a setup screen, or a state-mismatch error remains, check the configured repository, `demo` branch, and deployed commit first. Do not try to repair the synthetic demo by adding APS credentials or changing only `LENS_MODE`. See [troubleshooting](TROUBLESHOOTING.md).

The personal [demo repository](https://github.com/rachermatt/forma-hub-lens-demo) and its [Vercel deployment](https://forma-hub-lens.vercel.app/) are unchanged by this Dokku procedure.
