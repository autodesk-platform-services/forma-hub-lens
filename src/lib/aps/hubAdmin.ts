import "server-only";

import { env } from "../env";
import type { Session } from "./auth";
import { apsFetch, apsPaginate } from "./client";

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
};

export async function createProject(
  session: Session,
  project: NewProject,
): Promise<{ id: string; name?: string }> {
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

  return apsFetch<{ id: string; name?: string }>(
    session,
    `${ADMIN_V1}/accounts/${env.hubId}/projects`,
    { method: "POST", regional: true, body },
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
