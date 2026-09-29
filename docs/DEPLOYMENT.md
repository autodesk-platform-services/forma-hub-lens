# Deployment

Running this on localhost for yourself and running it for a team are different propositions. The difference is **the local cache**.

Everything the app calls with the signed-in user's token — Admin reads, Data Connector, and Manage writes — is permission-checked by Autodesk. But the dashboards and activity views are served from this app's own SQLite cache, so nothing upstream is checking those cached reads.

For shared deployment, access is gated on **hub membership**. At sign-in, and every 30 minutes thereafter, the app asks Data Management which hubs the account can reach (`GET /project/v1/hubs`) and requires `FORMA_HUB_ID` to be among them. Anyone else gets a 403 explaining why.

The check fails closed: a network error or 5xx from Autodesk denies access rather than allowing it. Re-running the check on a timer means someone removed from the hub loses access without anyone having to remember to revoke it. See [`src/lib/aps/authorization.ts`](../src/lib/aps/authorization.ts).

If you need tighter controls — for example, limiting extract submission to a few people because the Data Connector quota of 24 jobs per hub per 24 hours is shared — add a named-user check on top.

## Before the first deployment

1. **Rotate the client secret** if it has ever been pasted into a chat, ticket, or document, and set the new one only in your platform's secret store.
2. **Register the deployment's callback URL** on the APS app — `https://your-host/api/aps/callback` — and set `APS_CALLBACK_URL` to match exactly. It must use HTTPS because the session cookie's `Secure` flag is derived from this value.
3. **Provision a persistent volume** at `/data`. Without one, the uploaded extract, activity cache, and all sessions vanish on restart.
4. **Re-consent.** Existing sessions may predate the `account:write` scope. Sign out and back in or Manage writes return 403.

## Docker and other hosts

```bash
docker compose up --build
```

`docker-compose.yml` reads secrets from the host environment rather than baking them into the file.

The image is a standalone Next.js server on Node 24 with no database server and no native modules. Adapt it to whatever platform you use; the only hard requirements are a writable volume at `/data` and the four environment variables.

`GET /api/health` is the probe. It returns 503 while configuration is incomplete or the volume is not writable, 200 otherwise, and exposes no hub data.

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

The volume holds real hub data, including project names, member emails, activity, and cost figures. Host it somewhere sanctioned for that data and put the deployment through whatever security and privacy review your team normally requires before sharing the URL.
