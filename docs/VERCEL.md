# Optional Vercel deployment

The personal [rachermatt/forma-hub-lens-demo repository](https://github.com/rachermatt/forma-hub-lens-demo) and [forma-hub-lens.vercel.app](https://forma-hub-lens.vercel.app/) deployment remain separate from the organization's `demo` branch and Dokku target. This change does not reconnect, publish, or redeploy that Vercel project. For the preferred deployment, use [Dokku](DOKKU.md).

## Existing personal demo project

When administering the separate Vercel deployment, retain its personal repository connection and domain assignment. Confirm its source repository, branch, and expected commit before deploying; redeploying an old source commit preserves that commit's behavior. See [Vercel Git deployments](https://vercel.com/docs/git).

| Setting | Value |
| --- | --- |
| Repository | `rachermatt/forma-hub-lens-demo` |
| Production branch | `main` in that personal demo repository |
| Framework preset | Next.js |
| Root directory | Repository root |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | Next.js default |
| Node.js version | 24.x |

Use Node.js 24 for Node's SQLite runtime. See [Vercel's supported Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). Vercel's Production environment selects the public deployment; it does not enable live-hub features.

## Application configuration

The anonymous demo requires no APS credentials, OAuth callback, session secret, or environment file. Optional `LENS_MODE=demo` makes the default explicit; optional `LENS_LIVE_URL` adds an external link to a separately hosted live application. Do not configure a real hub ID or import customer data.

If upgrading an older personal demo, remove obsolete `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, `APS_CALLBACK_URL`, `DEMO_SESSION_SECRET`, and `FORMA_HUB_ID` from that demo project's affected environments, then deploy the latest anonymous-demo source. Leave any separate live deployment's credentials intact. Environment changes apply to new deployments. See [Vercel environment variables](https://vercel.com/docs/environment-variables).

No persistent volume, database service, scheduler, or authentication session is needed. Preview URLs require no OAuth callback registration. Browser-local preferences belong to each origin and do not move automatically between domains.

After a deliberate Vercel deployment, perform the [public demo verification](DEPLOYMENT.md#public-demo-verification) against its own URL. Publishing the organization's `demo` branch does not verify or update this separate deployment.
