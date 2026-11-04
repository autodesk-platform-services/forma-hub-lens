import "server-only";

import { configProblems } from "../env";
import type { HubRole } from "./authorization";

export type SessionMode = "live" | "demo";
export const DEMO_VISITOR_ID = "synthetic-demo-visitor";

/** Compatibility shape for synthetic workflows. It never represents Autodesk identity. */
export type Session = {
  id: string; mode: SessionMode; accessToken: string; refreshToken: string | null;
  expiresAt: number; scope: string | null; userId: string | null; userName: string | null;
  userEmail: string | null; hubVerifiedAt: number | null; hubRole: HubRole | null;
};

/** Public sample pages use one fictional visitor; browser preferences remain local. */
const visitor: Session = Object.freeze({
  id: DEMO_VISITOR_ID, mode: "demo", accessToken: "", refreshToken: null,
  expiresAt: Number.MAX_SAFE_INTEGER, scope: null, userId: DEMO_VISITOR_ID,
  userName: "Demo visitor", userEmail: null, hubVerifiedAt: null, hubRole: null,
});

/** No cookies, credentials, identity exchange or network requests are needed. */
export async function getSession(): Promise<Session | null> {
  return configProblems().length === 0 ? { ...visitor } : null;
}

/** Kept for shared workflow compatibility; arbitrary identities never gain live access. */
export async function refreshIfNeeded(session: Session): Promise<Session | null> {
  if (session.mode !== "demo" || session.accessToken || session.refreshToken || session.hubRole) return null;
  return getSession();
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}
export const requirePortfolioAccess = requireSession;

export class UnauthorizedError extends Error {
  constructor() { super("The synthetic demo configuration is invalid."); this.name = "UnauthorizedError"; }
}
export class HubAdminRequiredError extends Error {
  constructor() { super("Live Autodesk administrative actions are disabled in this demo."); this.name = "HubAdminRequiredError"; }
}

/** A public demo visitor can never acquire live Autodesk administrative permissions. */
export async function requireHubAdminSession(): Promise<Session> {
  await requireSession();
  throw new HubAdminRequiredError();
}
