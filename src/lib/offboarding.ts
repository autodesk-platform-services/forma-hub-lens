import "server-only";

import { getDb } from "./db";
import { env } from "./env";
import { apsPaginate, ApsError } from "./aps/client";
import type { Session } from "./aps/auth";
import { getTwoLeggedToken } from "./aps/twoLegged";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ADMIN_V1 = "/construction/admin/v1";

type DirectoryUser = {
  id?: string;
  uid?: string;
  autodeskId?: string;
  email?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  company_id?: string;
  status?: string;
};

export type OffboardingProject = {
  id: string;
  name?: string;
  status?: string;
  accessLevels?: { projectAdmin?: boolean; projectMember?: boolean };
};

export type OffboardingAssociation = {
  id?: string;
  key?: string;
  name?: string;
  projectIds?: string[];
};

export type OffboardingSummary = {
  email: string;
  name: string | null;
  company: string | null;
  status: string | null;
  userId: string;
  projects: OffboardingProject[];
  products: OffboardingAssociation[];
  roles: OffboardingAssociation[];
  lastObservedActivityAt: number | null;
  activityDataThrough: number | null;
  checkedAt: number;
};

export function normaliseTargetEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length > 255 || !EMAIL.test(email)) throw new Error("Enter one valid email address.");
  return email;
}

export function projectRemovalIds(projects: OffboardingProject[]): string[] {
  return [...new Set(projects.map((project) => project.id).filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ))];
}

async function accountUser(email: string): Promise<DirectoryUser | null> {
  const token = await getTwoLeggedToken();
  const url = new URL(`https://developer.api.autodesk.com/hq/v1/accounts/${env.hubId}/users/search`);
  url.searchParams.set("email", email);
  url.searchParams.set("partial", "false");
  url.searchParams.set("limit", "10");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Autodesk could not search the hub directory (${response.status}).`);
  const body = (await response.json()) as DirectoryUser[] | { results?: DirectoryUser[] };
  const users = Array.isArray(body) ? body : body.results;
  if (!Array.isArray(users)) throw new Error("Autodesk returned an unreadable hub directory response.");
  const exact = users.filter((user) => user.email?.trim().toLowerCase() === email);
  if (exact.length > 1) throw new Error("Multiple hub records match that email. Resolve the duplicate in Autodesk before offboarding.");
  return exact[0] ?? null;
}

async function userProjects(session: Session, userIds: string[]): Promise<{ userId: string; projects: OffboardingProject[] }> {
  for (const userId of userIds) {
    try {
      const projects = await apsPaginate<OffboardingProject>(
        session,
        `${ADMIN_V1}/accounts/${env.hubId}/users/${encodeURIComponent(userId)}/projects`,
        { regional: true, limit: 200 },
      );
      return { userId, projects };
    } catch (error) {
      // HQ and Forma may expose different identifiers. Try the next verified
      // identifier only when this one is absent; never mask a 403 or API error.
      if (!(error instanceof ApsError && error.status === 404)) throw error;
    }
  }
  throw new Error("Autodesk could not resolve this hub member in the Forma Admin API.");
}

function activityObservation(email: string, user: DirectoryUser): {
  lastObservedActivityAt: number | null;
  activityDataThrough: number | null;
} {
  const ids = [user.autodeskId, user.uid, user.id].filter((id): id is string => Boolean(id));
  const terms = ["LOWER(actor_email) = ?", ...ids.map(() => "actor_id = ?")];
  const row = getDb().prepare(
    `SELECT MAX(occurred_ms) AS latest FROM activities WHERE ${terms.join(" OR ")}`,
  ).get(email, ...ids) as { latest: number | null };
  const coverage = getDb().prepare(
    "SELECT MAX(occurred_ms) AS latest FROM activities",
  ).get() as { latest: number | null };
  return {
    lastObservedActivityAt: row.latest == null ? null : Number(row.latest),
    activityDataThrough: coverage.latest == null ? null : Number(coverage.latest),
  };
}

/** Fetches current access from Autodesk. The activity timestamp is a separate local extract observation. */
export async function inspectOffboarding(session: Session, input: string): Promise<OffboardingSummary | null> {
  const email = normaliseTargetEmail(input);
  const user = await accountUser(email);
  if (!user) return null;
  const identifiers = [...new Set([user.id, user.autodeskId, user.uid].filter((id): id is string => Boolean(id)))];
  if (!identifiers.length) throw new Error("Autodesk returned this user without an ID that can be checked.");
  const { userId, projects } = await userProjects(session, identifiers);
  const userPath = `${ADMIN_V1}/accounts/${env.hubId}/users/${encodeURIComponent(userId)}`;
  const [products, roles] = await Promise.all([
    apsPaginate<OffboardingAssociation>(session, `${userPath}/products`, { regional: true, limit: 200 }),
    apsPaginate<OffboardingAssociation>(session, `${userPath}/roles`, { regional: true, limit: 200 }),
  ]);
  return {
    email,
    name: user.name ?? ([user.first_name, user.last_name].filter(Boolean).join(" ") || null),
    company: user.company ?? user.company_id ?? null,
    status: user.status ?? null,
    userId,
    projects,
    products,
    roles,
    ...activityObservation(email, user),
    checkedAt: Date.now(),
  };
}
