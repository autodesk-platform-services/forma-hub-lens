import "server-only";

import { env } from "../env";

/**
 * Authorization gate.
 *
 * Signing in with an Autodesk account only proves *who* someone is — any
 * Autodesk ID can complete the OAuth flow against this client. It says nothing
 * about whether they may see this hub's data.
 *
 * Autodesk enforces permissions on everything we call with the user's own token
 * (Admin reads, Data Connector, the Manage writes). But the dashboards and the
 * activity views are served from this app's local cache, so nothing upstream is
 * checking them. This is where that check happens.
 *
 * The test: ask Data Management which hubs the user can reach and require ours
 * to be among them. It mirrors the permission Autodesk already applies
 * elsewhere and needs no list to maintain.
 */

const HUBS_URL = "https://developer.api.autodesk.com/project/v1/hubs";

export type HubAccess =
  | { ok: true; hubName: string | null }
  | { ok: false; reason: string };

type HubsResponse = {
  data?: Array<{ id?: string; attributes?: { name?: string } }>;
};

/** Data Management prefixes ACC/BIM 360 hub ids with "b."; Admin APIs don't. */
function matchesHub(id: string | undefined, hubId: string): boolean {
  if (!id) return false;
  return id.replace(/^b\./i, "").toLowerCase() === hubId.toLowerCase();
}

export async function verifyHubAccess(accessToken: string): Promise<HubAccess> {
  let res: Response;
  try {
    res = await fetch(HUBS_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    // Treat a network failure as "cannot confirm", never as "allowed".
    return {
      ok: false,
      reason: `Could not reach Autodesk to confirm hub access: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (res.status === 401) {
    return { ok: false, reason: "Autodesk rejected the access token." };
  }
  if (!res.ok) {
    return { ok: false, reason: `Autodesk returned ${res.status} when listing your hubs.` };
  }

  let body: HubsResponse;
  try {
    body = (await res.json()) as HubsResponse;
  } catch {
    return { ok: false, reason: "Autodesk returned an unreadable hub list." };
  }

  const hubs = body.data ?? [];
  const match = hubs.find((hub) => matchesHub(hub.id, env.hubId));
  if (!match) {
    return {
      ok: false,
      reason:
        "Your Autodesk account is not a member of this hub, so it cannot view this hub's data.",
    };
  }

  return { ok: true, hubName: match.attributes?.name ?? null };
}

/** How long a membership check is trusted before it is repeated. */
export const HUB_CHECK_TTL_MS = 30 * 60 * 1000;
