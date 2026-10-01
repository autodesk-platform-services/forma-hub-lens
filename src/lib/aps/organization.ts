import "server-only";

import { env } from "../env";
import type { CompanyEditable } from "../organizationModel";
import type { Session } from "./auth";
import { apsFetch } from "./client";

// Autodesk's published Account Admin Company create/get/patch API. These
// requests use the signed-in administrator's 3-legged token, never app rights.
const companyPath = () => `/hq/v1/accounts/${encodeURIComponent(env.hubId)}/companies`;

type HqCompany = {
  id?: string;
  name?: string;
  trade?: string;
  website_url?: string;
  erp_id?: string;
  description?: string;
};

export function toCompanyEditable(company: HqCompany): CompanyEditable {
  return {
    name: company.name ?? "", trade: company.trade ?? "",
    websiteUrl: company.website_url ?? undefined,
    erpId: company.erp_id ?? undefined,
    description: company.description ?? undefined,
  };
}

export async function getCompanyForEdit(session: Session, id: string): Promise<CompanyEditable & { id: string }> {
  const company = await apsFetch<HqCompany>(session, `${companyPath()}/${encodeURIComponent(id)}`, { regional: true });
  if (company.id !== id) throw new Error("Autodesk returned a different company ID; edit stopped.");
  return { id, ...toCompanyEditable(company) };
}

function companyBody(values: Partial<CompanyEditable>): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [key, apiKey] of [
    ["name", "name"], ["trade", "trade"], ["websiteUrl", "website_url"],
    ["erpId", "erp_id"], ["description", "description"],
  ] as const) {
    const value = values[key];
    if (typeof value === "string" && value) body[apiKey] = value;
  }
  return body;
}

export async function createPartnerCompany(session: Session, values: CompanyEditable): Promise<string | null> {
  const result = await apsFetch<HqCompany>(session, companyPath(), {
    method: "POST", regional: true, body: companyBody(values),
  });
  return typeof result.id === "string" && result.id ? result.id : null;
}

export async function patchPartnerCompany(
  session: Session,
  id: string,
  values: Partial<CompanyEditable>,
): Promise<void> {
  await apsFetch<HqCompany>(session, `${companyPath()}/${encodeURIComponent(id)}`, {
    method: "PATCH", regional: true, body: companyBody(values),
  });
}
