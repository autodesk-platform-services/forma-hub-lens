import "server-only";

// Compatibility types for the shared presentation layer; the demo grants neither role.
export type HubRole = "hub_admin" | "executive";
export type HubAccess = { ok: true; role: HubRole } | { ok: false; reason: string };
export const HUB_CHECK_TTL_MS = 30 * 60 * 1000;

export async function verifyHubAccess(_accessToken: string, _signedInEmail: string | null): Promise<HubAccess> {
  return { ok: false, reason: "The public demo has no live hub entitlement." };
}
