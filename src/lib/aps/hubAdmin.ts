import "server-only";

import { env } from "../env";
import type { Session } from "./auth";
import { apsFetch, apsPaginate, requireLiveApsSession } from "./client";
import { getTwoLeggedToken } from "./twoLegged";
import { USERINFO_URL } from "./endpoints";

/**
 * Hub management operations on the Forma Admin API.
 *
 * Reads need `account:read`; every write here needs `account:write` and hub
 * admin rights on the signed-in account.
 */

const ADMIN_V1 = "/construction/admin/v1";
const ADMIN_V2 = "/construction/admin/v2";

export type Company = {
  id: string;
  name?: string;
  trade?: string;
  city?: string;
  country?: string;
  phone?: string;
  websiteUrl?: string;
  erpId?: string;
  taxId?: string;
  status?: string;
  projectSize?: number;
  userSize?: number;
};

export async function fetchCompanies(session: Session): Promise<Company[]> {
  return apsPaginate<Company>(session, `${ADMIN_V1}/accounts/${env.hubId}/companies`, {
    regional: true,
    limit: 100,
  });
}

export type ProjectUser = {
  id: string;
  autodeskId?: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  companyId?: string;
  companyName?: string;
  accessLevels?: Record<string, boolean>;
  roleIds?: string[];
  roles?: Array<{ id: string; name?: string }>;
  products?: Array<{ key: string; access: string }>;
};

export async function fetchProjectUsers(
  session: Session,
  projectId: string,
): Promise<ProjectUser[]> {
  return apsPaginate<ProjectUser>(session, `${ADMIN_V1}/projects/${projectId}/users`, {
    regional: true,
    limit: 100,
  });
}

/**
 * Product access options as presented in the UI.
 *
 * The labels are commercial bundle names; the Admin API takes product *keys*.
 * The mapping below is the console's interpretation of each bundle — verify it
 * against your hub's entitlements before running a large import, and edit here
 * if your account provisions a bundle differently.
 */
export const PRODUCT_ACCESS_OPTIONS: Array<{
  label: string;
  keys: string[];
  note?: string;
}> = [
  {
    label: "BIM Collaborate",
    keys: ["designCollaboration", "modelCoordination"],
    note: "Design Collaboration + Model Coordination",
  },
  { label: "Forma Takeoff", keys: ["takeoff"] },
  {
    label: "Forma for Preconstruction",
    keys: ["takeoff", "cost"],
    note: "Takeoff + Cost",
  },
  { label: "AutoSpecs", keys: ["autoSpecs"] },
  { label: "Forma Build", keys: ["build"] },
  { label: "Forma Design Collaboration", keys: ["designCollaboration"] },
];

export function productKeysFor(labels: string[]): string[] {
  const keys = new Set<string>();
  for (const label of labels) {
    const option = PRODUCT_ACCESS_OPTIONS.find((o) => o.label === label);
    for (const key of option?.keys ?? []) keys.add(key);
  }
  return [...keys];
}

export type ImportUser = {
  email: string;
  firstName?: string;
  lastName?: string;
  companyId?: string;
  roleIds?: string[];
  products?: Array<{ key: string; access: "member" | "administrator" }>;
};

/** POST projects/:projectId/users:import — up to 200 users per call. */
export async function importProjectUsers(
  session: Session,
  projectId: string,
  users: ImportUser[],
  suppressEmails: boolean,
): Promise<{ jobId?: string }> {
  if (users.length === 0) throw new Error("No users to import.");
  if (users.length > 200) throw new Error("Data Connector accepts at most 200 users per request.");
  return apsFetch<{ jobId?: string }>(
    session,
    `${ADMIN_V2}/projects/${projectId}/users:import`,
    {
      method: "POST",
      regional: true,
      body: { users, suppressAdministrativeEmails: suppressEmails },
    },
  );
}

export async function removeProjectUser(
  session: Session,
  projectId: string,
  userId: string,
): Promise<void> {
  await apsFetch<void>(session, `${ADMIN_V1}/projects/${projectId}/users/${userId}`, {
    method: "DELETE",
    regional: true,
  });
}

export type NewProject = {
  name: string;
  type: string;
  classification?: string;
  jobNumber?: string;
  city?: string;
  country?: string;
  startDate?: string;
  endDate?: string;
  value?: number;
  currency?: string;
  /** APS clones a Forma template with body.template.projectId. */
  templateProjectId?: string;
};

export async function createProject(
  session: Session,
  project: NewProject,
): Promise<{ jobId?: string; id?: string; name?: string }> {
  const body: Record<string, unknown> = {
    name: project.name,
    type: project.type,
    classification: project.classification ?? "production",
  };
  if (project.jobNumber) body.jobNumber = project.jobNumber;
  if (project.city) body.city = project.city;
  if (project.country) body.country = project.country;
  if (project.startDate) body.startDate = project.startDate;
  if (project.endDate) body.endDate = project.endDate;
  if (project.value !== undefined) body.value = project.value;
  if (project.currency) body.currency = project.currency;
  if (project.templateProjectId) body.template = { projectId: project.templateProjectId };

  return apsFetch<{ jobId?: string; id?: string; name?: string }>(
    session,
    `${ADMIN_V1}/accounts/${env.hubId}/projects`,
    { method: "POST", regional: true, body },
  );
}

export type TemplateProject = { id: string; name?: string; classification?: string; status?: string };

/** The Admin API distinguishes native Forma project templates by classification. */
export async function fetchTemplateProjects(session: Session): Promise<TemplateProject[]> {
  return apsPaginate<TemplateProject>(
    session,
    `${ADMIN_V1}/accounts/${env.hubId}/projects`,
    {
      regional: true,
      limit: 100,
      searchParams: {
        "filter[classification]": "template",
        "filter[status]": "active",
        fields: "id,name,classification,status",
      },
    },
  );
}

/** Project types accepted by the Admin API, per the Hub Admin reference. */
export const PROJECT_TYPES = [
  "Airport", "Assisted Living / Nursing Home", "Bridge", "Canal / Waterway",
  "Convention Center", "Court House", "Data Center", "Dams / Flood Control / Reservoirs",
  "Demonstration Project", "Dormitory", "Education Facility", "Government Building",
  "Harbor / River Development", "Hospital", "Hotel / Motel", "Library",
  "Manufacturing / Factory", "Medical Laboratory", "Medical Office", "Military Facility",
  "Mining Facility", "Multi-Family Housing", "Museum", "Oil & Gas", "Office",
  "OutPatient Surgery Center", "Parking Structure / Garage", "Performing Arts",
  "Power Plant", "Prison / Correctional Facility", "Rail", "Recreation Building",
  "Religious Building", "Research Facility / Laboratory", "Restaurant", "Retail",
  "Seaport", "Single-Family Housing", "Solar Farm", "Stadium/Arena",
  "Streets / Roads / Highways", "Template Project", "Theme Park", "Training Project",
  "Transportation Building", "Tunnel", "Utilities", "Warehouse (non-manufacturing)",
  "Waste Water / Sewers", "Water Supply", "Wind Farm",
];

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

/**
 * Archiving a project is a status change (active -> archived), never a delete.
 * The project and its data stay put; Forma just moves it to the archived list.
 *
 * There is no Forma Hub Admin endpoint for this — the only project PATCH there
 * is /image — so it goes through the BIM 360 Account Admin API. Autodesk's
 * compatibility table marks that endpoint "not compatible with Forma projects",
 * but that is out of date: verified against a live Forma-platform (`acc`)
 * project, archive and restore both return 200 and the Forma Admin API reflects
 * the new status. Re-check this if Autodesk ships a native Hub Admin
 * equivalent, and prefer that when they do.
 *
 * The endpoint is app-only, so it needs a two-legged token — which means it
 * ignores the signed-in user's permissions. requireAccountAdmin() below is what
 * puts that enforcement back.
 */
const HQ_V1 = "https://developer.api.autodesk.com/hq/v1";

export type ProjectStatus = "active" | "archived" | "inactive";

export class NotAccountAdminError extends Error {
  constructor() {
    super("This operation requires Autodesk account administrator rights on the hub.");
    this.name = "NotAccountAdminError";
  }
}

type HqUser = { uid?: string; id?: string; email?: string; access_level?: string; role?: string };

/**
 * Confirms the signed-in person is an account admin on the hub.
 *
 * Membership alone is not enough here: the archive call runs with app
 * credentials, so without this any hub member could archive projects.
 */
export async function requireAccountAdmin(session: Session): Promise<void> {
  requireLiveApsSession(session);
  let email = session.userEmail?.trim().toLowerCase();
  if (!email) {
    // /userinfo is best-effort during sign-in. Re-read it here if that first
    // request failed, while still denying the action when identity is unknown.
    try {
      const profile = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (profile.ok) {
        const body = (await profile.json()) as { email?: unknown };
        if (typeof body.email === "string") email = body.email.trim().toLowerCase();
      }
    } catch {
      // Fail closed below; no app-credential write should proceed.
    }
  }
  if (!email) throw new NotAccountAdminError();

  const token = await getTwoLeggedToken();
  const url = new URL(`${HQ_V1}/accounts/${env.hubId}/users/search`);
  url.searchParams.set("email", email);
  url.searchParams.set("partial", "false");
  url.searchParams.set("limit", "10");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    // Fail closed: if we cannot establish admin rights, we do not grant them.
    throw new NotAccountAdminError();
  }

  const body = (await res.json()) as HqUser[] | { results?: HqUser[] };
  const users = Array.isArray(body) ? body : body.results;
  if (!Array.isArray(users)) throw new NotAccountAdminError();
  const matches = users.filter((u) => u.email?.trim().toLowerCase() === email);
  if (matches.length !== 1 || (matches[0].access_level ?? matches[0].role) !== "account_admin") {
    throw new NotAccountAdminError();
  }
}

/** Reads a project's current status straight from Autodesk, not the cache. */
export async function fetchProjectStatus(
  projectId: string,
): Promise<{ name: string; status: string } | null> {
  try {
    const token = await getTwoLeggedToken();
    const res = await fetch(`${HQ_V1}/accounts/${env.hubId}/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: string; status?: string };
    return { name: body.name ?? projectId, status: body.status ?? "unknown" };
  } catch {
    // One failed status read must not abort a bulk archive and skip the cache
    // update for projects already archived earlier in the run.
    return null;
  }
}

/** Sets a project's status. Only ever sends `status` — no other field is touched. */
export async function setProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<{ status: string }> {
  const token = await getTwoLeggedToken();
  const res = await fetch(`${HQ_V1}/accounts/${env.hubId}/projects/${projectId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ status }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail ?? parsed.message ?? parsed.title ?? detail;
    } catch {
      /* keep the raw snippet */
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  const body = JSON.parse(text) as { status?: string };
  return { status: body.status ?? status };
}
