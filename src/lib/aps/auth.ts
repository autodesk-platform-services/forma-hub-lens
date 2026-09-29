import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { env } from "../env";
import { HUB_CHECK_TTL_MS, verifyHubAccess } from "./authorization";
import { AUTHORIZE_URL, TOKEN_URL, USERINFO_URL } from "./endpoints";

export { AUTHORIZE_URL, TOKEN_URL, USERINFO_URL } from "./endpoints";

export const SESSION_COOKIE = "forma_session";

/**
 * account:read       — Forma Admin API reads (projects, users, companies)
 * account:write      — Hub management writes (bulk member import/removal, create projects)
 * data:read          — Data Connector reads (requests, jobs, extract downloads)
 * data:create        — Data Connector POST requests (spawns extract jobs)
 * user-profile:read  — /userinfo, so the console can show who is signed in
 *
 * Changing this list invalidates existing consent: sign out and back in so the
 * new scopes are actually granted.
 */
export const SCOPES = [
  "data:read",
  "data:create",
  "account:read",
  "account:write",
  "user-profile:read",
  "openid",
];

export type Session = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  /** When this account was last confirmed to be a member of the hub. */
  hubVerifiedAt: number | null;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

class TokenRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(`APS token request failed (${status}${code ? `, ${code}` : ""})`);
    this.name = "TokenRequestError";
    this.status = status;
    this.code = code;
  }
}

function basicAuthHeader(): string {
  return "Basic " + Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64");
}

export function buildAuthorizeUrl(): { url: string; state: string } {
  const state = randomBytes(24).toString("base64url");
  const db = getDb();
  db.prepare("INSERT INTO oauth_states (state, created_at) VALUES (?, ?)").run(state, Date.now());
  // Best-effort cleanup of states older than 15 minutes.
  db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(Date.now() - 15 * 60_000);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: env.callbackUrl,
    scope: SCOPES.join(" "),
    state,
  });
  return { url: `${AUTHORIZE_URL}?${params.toString()}`, state };
}

export function consumeState(state: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT state FROM oauth_states WHERE state = ?").get(state);
  if (!row) return false;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  return true;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let code: string | null = null;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string" && /^[a-z_]{1,64}$/i.test(body.error)) {
        code = body.error;
      }
    } catch {
      // Keep the status even if Autodesk returned an unreadable error body.
    }
    throw new TokenRequestError(res.status, code);
  }
  return JSON.parse(text) as TokenResponse;
}

/** Raised when a valid Autodesk account has no access to this hub. */
export class HubAccessError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "HubAccessError";
  }
}

export async function exchangeCode(code: string): Promise<Session> {
  const token = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.callbackUrl,
    }),
  );

  // Authenticate, then authorise. A session is only created for an account that
  // Autodesk confirms can reach this hub.
  const access = await verifyHubAccess(token.access_token);
  if (!access.ok) throw new HubAccessError(access.reason);

  const session = await persistSession(randomUUID(), token);
  markHubVerified(session.id, Date.now());
  return { ...session, hubVerifiedAt: Date.now() };
}

async function refresh(session: Session): Promise<Session> {
  if (!session.refreshToken) {
    throw new Error("Session expired and no refresh token is available. Sign in again.");
  }
  const token = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      scope: SCOPES.join(" "),
    }),
  );
  return persistSession(session.id, token, session);
}

async function persistSession(
  id: string,
  token: TokenResponse,
  previous?: Session,
): Promise<Session> {
  const session: Session = {
    id,
    accessToken: token.access_token,
    // APS rotates refresh tokens; fall back to the previous one if none returned.
    refreshToken: token.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope ?? previous?.scope ?? SCOPES.join(" "),
    userId: previous?.userId ?? null,
    userName: previous?.userName ?? null,
    userEmail: previous?.userEmail ?? null,
    hubVerifiedAt: previous?.hubVerifiedAt ?? null,
  };

  if (!session.userId) {
    const profile = await fetchUserInfo(session.accessToken);
    session.userId = profile?.userId ?? null;
    session.userName = profile?.name ?? null;
    session.userEmail = profile?.email ?? null;
  }

  getDb()
    .prepare(
      `INSERT INTO sessions (id, access_token, refresh_token, expires_at, scope, user_id, user_name, user_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         user_id = excluded.user_id,
         user_name = excluded.user_name,
         user_email = excluded.user_email`,
    )
    .run(
      session.id,
      session.accessToken,
      session.refreshToken,
      session.expiresAt,
      session.scope,
      session.userId,
      session.userName,
      session.userEmail,
      Date.now(),
    );

  return session;
}

async function fetchUserInfo(
  accessToken: string,
): Promise<{ userId: string; name: string; email: string } | null> {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      sub?: string;
      userId?: string;
      name?: string;
      email?: string;
    };
    return {
      userId: body.userId ?? body.sub ?? "",
      name: body.name ?? "",
      email: body.email ?? "",
    };
  } catch {
    // /userinfo is a nicety, not a requirement — never block sign-in on it.
    return null;
  }
}

function readSession(id: string): Session | null {
  const row = getDb()
    .prepare(
      `SELECT id, access_token, refresh_token, expires_at, scope, user_id, user_name, user_email,
              hub_verified_at
       FROM sessions WHERE id = ?`,
    )
    .get(id) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    accessToken: row.access_token as string,
    refreshToken: (row.refresh_token as string) ?? null,
    expiresAt: Number(row.expires_at),
    scope: (row.scope as string) ?? null,
    userId: (row.user_id as string) ?? null,
    userName: (row.user_name as string) ?? null,
    userEmail: (row.user_email as string) ?? null,
    hubVerifiedAt: row.hub_verified_at === null ? null : Number(row.hub_verified_at),
  };
}

function markHubVerified(id: string, at: number): void {
  getDb().prepare("UPDATE sessions SET hub_verified_at = ? WHERE id = ?").run(at, id);
}

/**
 * Current session with a valid access token, refreshing if it is close to
 * expiry and re-confirming hub membership once the last check goes stale.
 *
 * Re-checking matters: someone removed from the hub keeps a valid Autodesk
 * account, so without this their session would outlive their access.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  let session = readSession(id);
  if (!session) return null;

  session = await refreshIfNeeded(session);
  if (!session) return null;

  const checkedAt = session.hubVerifiedAt ?? 0;
  if (Date.now() - checkedAt > HUB_CHECK_TTL_MS) {
    const access = await verifyHubAccess(session.accessToken);
    if (!access.ok) {
      destroySession(session.id);
      return null;
    }
    const now = Date.now();
    markHubVerified(session.id, now);
    session = { ...session, hubVerifiedAt: now };
  }

  return session;
}

/** Return no access on refresh failure, retaining recoverable sessions for retry. */
export async function refreshIfNeeded(session: Session): Promise<Session | null> {
  if (session.expiresAt - Date.now() > 60_000) return session;
  try {
    return await refresh(session);
  } catch (error) {
    const revoked = !session.refreshToken ||
      (error instanceof TokenRequestError && error.code === "invalid_grant");
    console.warn(
      `APS token refresh failed for session ${session.id}: ${
        error instanceof Error ? error.message : String(error)
      }${revoked ? "; session removed" : "; session retained for retry"}`,
    );
    if (revoked) destroySession(session.id);
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in to Autodesk Platform Services.");
    this.name = "UnauthorizedError";
  }
}

export function destroySession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export async function setSessionCookie(id: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.callbackUrl.startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
