# Public synthetic demo boundaries

## Purpose

Allow anyone to explore Forma Hub Lens directly in a browser without an Autodesk account, hub membership, or administrative rights. All portfolio records and administrative results are fictional.

The persistent banner is:

> Synthetic demo hub — all data and administrative actions are simulated. No Autodesk sign-in required.

## Isolation

- A dedicated [`demo` branch in the organization repository](https://github.com/autodesk-platform-services/forma-hub-lens/tree/demo).
- An anonymous demo-only runtime that rejects live mode and uses a fixed fictional hub identifier.
- In-memory, seeded, immutable synthetic portfolio data.
- No APS API calls, customer imports, visitor identity verification, or APS token storage.
- Browser-only simulations and browser-local preferences.

The organization's [`main` branch](https://github.com/autodesk-platform-services/forma-hub-lens/tree/main) retains the live implementation, Autodesk sign-in, Hub Admin / Executive Overview checks, and Hub Admin write checks. The anonymous demo branch does not disable those checks on `main` and cannot become the live application through an environment toggle. Optional deployment links navigate between separate websites.

## Autodesk traffic and privacy

The demo does not redirect visitors to Autodesk, exchange tokens, call User Profile, or access a real Forma hub. It requires no APS application, credentials, callback registration, or session secret. Old demo login and callback links return to the home page.

No server-side directory of visitors is stored. Browser-local preferences have no account separation and may be visible to other people using the same browser profile. Deployment-provider request logs may still exist according to that provider's settings. Do not upload customer records or include credentials in logs and issue reports.

## Simulated actions

Bulk add/remove membership, project creation, and archiving occur only in the current client view. Product choices illustrate requested access; no subscription is assigned. No invitation is sent. Results are verified against the view's simulated workspace and reset when the view is reset or left.

Sample recipes, integration manifests, extraction schedules, and closeout profiles/evidence are immutable examples. They do not create background work, public-feed polling, live project scans, or an administrative audit.

## Browser-local state

Saved views, watchlist bookmarks, tool favorites, and review decisions are conveniences stored in the browser. They do not create automated monitoring or notifications and do not synchronize between devices. Clearing site storage removes them. They are not acceptance records or evidence of a real administrative action.

## Hosting

Use the [deployment guide](DEPLOYMENT.md) and [Dokku instructions](DOKKU.md). The preferred demo target is [forma-hub-lens.autodesk.io](https://forma-hub-lens.autodesk.io/). This code change performs no Dokku deployment; a hosting administrator must switch to `demo`, fetch the new source, and build and deploy it. Setting `LENS_MODE` on live `main` or restarting its old checkout does not install the demo.

The personal [demo repository](https://github.com/rachermatt/forma-hub-lens-demo) and [Vercel deployment](https://forma-hub-lens.vercel.app/) remain unchanged and separate. See the [optional Vercel guide](VERCEL.md). Preview URLs need no OAuth callback registration.
