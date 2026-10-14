# Deployment

Running this on localhost for yourself and running it for a team are different propositions. The difference is **the local cache**.

Autodesk permission-checks calls made with the signed-in user's token, including Data Connector and Docs reads. Lens also uses an app-only token for exact hub-role verification, live offboarding directory lookup, and project archiving. Dashboards and activity views are served from this app's SQLite cache, so Autodesk does not check those cached reads.

For shared deployment, access is gated on **Hub Admin or Executive Overview** for the configured hub. At sign-in and at least every 30 minutes while the session is used, the app verifies the Autodesk userinfo identity and finds one exact email match in that hub's account directory. Only `account_admin` or `executive` directory access levels are accepted. Hub administration, project sync, extract requests/scheduling/refresh/ingestion, shared dataset replacement, schema acknowledgement, closeout package downloads, and administrative audit pages/exports repeat a live Hub Admin check. Autodesk applies its own endpoint entitlements to Data Connector and Docs operations.

The Autodesk OAuth callback also requires a one-use state value stored in an HttpOnly browser cookie for the sign-in that initiated it.

The check fails closed: an ambiguous match, unknown role, network error, or 5xx from Autodesk denies access. A removed or downgraded account loses access after its next periodic check; administrative writes recheck immediately. See [`src/lib/aps/authorization.ts`](../src/lib/aps/authorization.ts).

If you need tighter controls — for example, limiting extract submission to a few people because the Data Connector quota of 24 jobs per hub per 24 hours is shared — add a named-user check on top.

## Before the first deployment

1. **Rotate the client secret** if it has ever been pasted into a chat, ticket, or document, and set the new one only in your platform's secret store.
2. **Register the deployment's callback URL** on the APS app — `https://your-host/api/aps/callback` — and set `APS_CALLBACK_URL` to match exactly. It must use HTTPS because the session cookie's `Secure` flag is derived from this value.
3. **Provision a persistent volume** at `/data`. Without one, uploaded extracts, activity, saved views, recipes, the local administrative audit, and sessions vanish on restart.
4. **Re-consent.** Existing sessions may predate the `account:write` scope. Sign out and back in or Manage writes return 403.

## Docker and other hosts

```bash
docker compose up --build
```

`docker-compose.yml` reads secrets from the host environment rather than baking them into the file.

The image is a standalone Next.js server on Node 24 with no database server and no native modules. Adapt it to whatever platform you use; the only hard requirements are a writable volume at `/data` and the four environment variables.

Run one app instance against that SQLite file. Multiple replicas sharing a volume need a separate concurrency and session-store design; the current deployment does not provide one.

The SQLite filename is scoped to `FORMA_HUB_ID`, so changing hubs while reusing a volume starts with an empty cache and separate sessions. Earlier releases used the unscoped `forma-console.sqlite`; that file is left untouched and is not migrated automatically. Resync projects and ingest or upload extracts for the configured hub after upgrading.

APS can run recurring extract jobs while this app is offline, but Lens currently needs a person to refresh jobs and ingest each completed activity extract. Running on a persistent host alone does not enable automatic ingestion. That needs a separately designed background worker, scheduler, and recovery path.

`GET /api/health` is the probe. It returns 503 while configuration is incomplete or the volume is not writable, 200 otherwise. Its uncached public response contains only a status, timestamp, and generic configuration/database check statuses; no environment names or values, table counts, filesystem paths, or hub data are returned.

## Browser security headers

Every route receives a baseline Content Security Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. The CSP prevents framing and restricts browser resources to the app's origin, with local image data/blob URLs permitted. Next.js 15 hydration and chart styles still require inline scripts/styles; this baseline does not implement script nonces. Development additionally permits Next's debugging and HMR connections.

In production, the HTTPS reverse proxy must set `x-forwarded-proto=https` so responses also receive HSTS (`max-age=31536000`) and CSP `upgrade-insecure-requests`. This policy covers the current hostname without committing subdomains to HSTS or requesting preload. Plain HTTP localhost retains working local assets and is not upgraded.

## Choosing a host

**Container or VM with a volume** — Railway, Fly.io, ECS/Fargate with EFS, an internal PaaS, or a plain VM all fit the architecture as built.

**Serverless platforms such as Vercel will not work unchanged.** The implementation notes report that this was tried and confirmed. The filesystem is read-only apart from an ephemeral `/tmp`, and this app writes one SQLite file that holds sessions, OAuth state, the extract, and the activity cache.

Specific failure modes documented in the implementation:

- Sign-in 500s on the first click because `buildAuthorizeUrl()` hits the database before any cookie exists, so it tries to create a directory on a read-only volume.
- `DATA_DIR=/tmp` does not rescue it because `/tmp` is per-instance. The OAuth `state` written by `/api/aps/login` often is not visible to `/api/aps/callback`, so sign-in fails on the mismatch.
- The implementation notes state that Vercel caps request bodies around 4.5 MB while a full hub extract is approximately 11 MB, so the upload is rejected outright.

Going the serverless route means moving the dataset, activity cache, and session store to a hosted database and switching the upload to direct-to-blob. That is the largest change on this list.

**Sharing only the code is also a legitimate deployment model.** Each person runs it locally with their own APS credentials and their own cache; nothing is centrally hosted and there is no shared data to protect.

## Data storage and security

The volume holds real hub data, including project names, member emails, activity, cost figures, saved user filters, recipes, and Lens administration records. Host it somewhere sanctioned for that data and put the deployment through whatever security and privacy review your team normally requires before sharing the URL.
