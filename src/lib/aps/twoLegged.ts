import "server-only";

import { env } from "../env";
import { TOKEN_URL } from "./endpoints";

/**
 * Two-legged (client credentials) token.
 *
 * Everything else in this app acts with the signed-in user's own token, so
 * Autodesk enforces that person's permissions on every call. This does not: a
 * two-legged token acts as the *application*, with whatever the integration is
 * entitled to, regardless of who is clicking.
 *
 * It is used to verify the signed-in person's hub-level role against the
 * account directory and for project status changes through the app-only BIM
 * 360 Account Admin endpoint. Every status write must first pass the explicit
 * account-admin gate in hubAdmin.ts.
 *
 * Do not reach for this anywhere a three-legged token would work.
 */

type Cached = { token: string; expiresAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __formaTwoLegged: Cached | undefined;
}

const SCOPES = ["account:read", "account:write"];

export async function getTwoLeggedToken(): Promise<string> {
  const cached = globalThis.__formaTwoLegged;
  // Refresh a minute early so a token can't expire mid-request.
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: SCOPES.join(" "),
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Could not obtain an app token (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = JSON.parse(text) as { access_token: string; expires_in: number };
  globalThis.__formaTwoLegged = {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return body.access_token;
}
