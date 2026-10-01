import "server-only";

import { env } from "../env";
import { getTwoLeggedToken } from "./twoLegged";
import { USERINFO_URL } from "./endpoints";

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
 * Project-oriented Data Management hub membership is not a reliable test for
 * Executive Overview. Verify the 3LO token's identity, then look up that exact
 * identity in the configured hub's account directory. Only the two hub-level
 * access levels approved for Lens can enter.
 */

export type HubAccess =
  | { ok: true; role: HubRole }
  | { ok: false; reason: string };

export type HubRole = "hub_admin" | "executive";

type AccountUser = {
  email?: unknown;
  access_level?: unknown;
  role?: unknown;
};

export async function verifyHubAccess(
  accessToken: string,
  signedInEmail: string | null,
): Promise<HubAccess> {
  const email = signedInEmail?.trim().toLowerCase();
  if (!email) {
    return { ok: false, reason: "Autodesk did not provide an email address for role verification." };
  }

  try {
    const identity = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!identity.ok) return { ok: false, reason: "Autodesk could not verify the signed-in identity." };
    const profile = (await identity.json()) as { email?: unknown };
    if (typeof profile.email !== "string" || profile.email.trim().toLowerCase() !== email) {
      return { ok: false, reason: "The Autodesk identity no longer matches this session. Sign in again." };
    }

    const appToken = await getTwoLeggedToken();
    const url = new URL(
      `https://developer.api.autodesk.com/hq/v1/accounts/${env.hubId}/users/search`,
    );
    url.searchParams.set("email", email);
    url.searchParams.set("partial", "false");
    url.searchParams.set("limit", "10");
    const directory = await fetch(url, {
      headers: { Authorization: `Bearer ${appToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!directory.ok) {
      return { ok: false, reason: `Autodesk returned ${directory.status} during hub role verification.` };
    }
    const body = (await directory.json()) as AccountUser[] | { results?: AccountUser[] };
    const users = Array.isArray(body) ? body : body.results;
    if (!Array.isArray(users)) {
      return { ok: false, reason: "Autodesk returned an unreadable hub member list." };
    }
    // The HQ search can return fuzzy matches. Never trust the first result.
    const matching = users.filter((user) =>
      typeof user.email === "string" && user.email.trim().toLowerCase() === email
    );
    if (matching.length !== 1) {
      return { ok: false, reason: "Autodesk could not resolve one matching member in this hub." };
    }
    // These are the explicit legacy HQ API values. Unknown or newly added
    // access levels deny by default until they are verified against Autodesk.
    const directoryRole = matching[0].access_level ?? matching[0].role;
    const role: HubRole | null = directoryRole === "account_admin"
      ? "hub_admin"
      : directoryRole === "executive"
        ? "executive"
        : null;
    if (!role) {
      return {
        ok: false,
        reason: "This Autodesk account needs Hub Admin or Executive Overview access to this hub.",
      };
    }
    return { ok: true, role };
  } catch {
    return { ok: false, reason: "Could not confirm hub role with Autodesk." };
  }
}

/** How long a hub role check is trusted before it is repeated. */
export const HUB_CHECK_TTL_MS = 30 * 60 * 1000;
