"use server";

import { revalidatePath } from "next/cache";
import { requireHubAdminSession } from "@/lib/aps/auth";
import { fetchCompanies } from "@/lib/aps/hubAdmin";
import { createPartnerCompany, getCompanyForEdit, patchPartnerCompany } from "@/lib/aps/organization";
import {
  adminOperation, adminOperationItems, claimAdminPlan, finishAdminItem, finishAdminOperation,
  saveAdminPlan, startAdminItem,
  type AdminPlan, type PlanKind,
} from "@/lib/adminOperations";
import {
  companyChangeDetails, companyHasChangedSincePreview, companyMatchesPlannedValues,
  planCompanyChange, type CompanyEditable,
} from "@/lib/organizationModel";
import type { ManageState } from "./actions";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function companyPeers(companies: Awaited<ReturnType<typeof fetchCompanies>>): Array<CompanyEditable & { id: string }> {
  return companies.map((company) => ({
    id: company.id, name: company.name ?? "", trade: company.trade ?? "",
    websiteUrl: company.websiteUrl, erpId: company.erpId,
  }));
}

async function executeCompanyPlan(kind: "create_company" | "update_company", formData: FormData): Promise<ManageState> {
  const session = await requireHubAdminSession();
  const { plan, operationId } = claimAdminPlan(session, String(formData.get("planId") ?? ""), kind);
  if (plan.kind !== kind) throw new Error("The stored company preview has a different action.");
  const change = plan.targets[0];
  if (!change || change.mode !== (kind === "create_company" ? "create" : "update")) {
    throw new Error("The stored company preview is invalid.");
  }
  const label = change.values.name;
  startAdminItem(operationId, 0, change.companyId ?? label, label);
  let detail = "";
  try {
    if (change.mode === "create") {
      const current = await fetchCompanies(session);
      if (current.some((company) => company.name?.trim().toLowerCase() === label.toLowerCase())) {
        finishAdminItem(operationId, 0, "skipped", "Company name appeared in the live hub after preview; no write sent.");
        detail = "No write sent because this company name now exists.";
      } else {
        const id = await createPartnerCompany(session, change.values);
        if (!id) {
          finishAdminItem(operationId, 0, "submitted", "Autodesk accepted create, but did not return a company ID. Verify in company directory.");
          detail = "Creation accepted; company ID unavailable for verification.";
        } else {
          try {
            const verified = await getCompanyForEdit(session, id);
            if (companyMatchesPlannedValues(change, verified)) {
              finishAdminItem(operationId, 0, "succeeded", `Created and verified Autodesk company ${id}.`);
              detail = `Created and verified ${label} (${id}).`;
            } else {
              finishAdminItem(operationId, 0, "submitted", `Autodesk accepted create for ${id}; readback differs or has not propagated.`);
              detail = `Created ${label} (${id}); readback is pending or differs.`;
            }
          } catch (error) {
            finishAdminItem(operationId, 0, "submitted", `Autodesk accepted create for ${id}; readback failed: ${message(error)}`);
            detail = `Created ${label} (${id}); readback unavailable.`;
          }
        }
      }
    } else {
      const current = await getCompanyForEdit(session, change.companyId!);
      const peers = await fetchCompanies(session);
      if (companyHasChangedSincePreview(change, current)) {
        finishAdminItem(operationId, 0, "skipped", "One of the planned fields changed in Autodesk after preview; no write sent.");
        detail = "No write sent because company data changed after preview.";
      } else if (peers.some((company) => company.id !== change.companyId
        && company.name?.trim().toLowerCase() === change.values.name.toLowerCase())) {
        finishAdminItem(operationId, 0, "skipped", "Company name appeared in the live hub after preview; no write sent.");
        detail = "No write sent because this company name now exists.";
      } else {
        const patch: Partial<CompanyEditable> = {};
        for (const field of change.changedFields) patch[field] = change.values[field];
        await patchPartnerCompany(session, change.companyId!, patch);
        try {
          const verified = await getCompanyForEdit(session, change.companyId!);
          if (companyMatchesPlannedValues(change, verified)) {
            finishAdminItem(operationId, 0, "succeeded", "Company update verified by Autodesk readback.");
            detail = `Updated and verified ${label}.`;
          } else {
            finishAdminItem(operationId, 0, "submitted", "Autodesk accepted update; readback differs or has not propagated.");
            detail = `Updated ${label}; readback is pending or differs.`;
          }
        } catch (error) {
          finishAdminItem(operationId, 0, "submitted", `Autodesk accepted update; readback failed: ${message(error)}`);
          detail = `Updated ${label}; readback unavailable.`;
        }
      }
    }
  } catch (error) {
    finishAdminItem(operationId, 0, "failed", `${message(error)}. The request may have reached Autodesk; check the live directory before retrying.`);
    detail = `${label}: ${message(error)}. Check Autodesk before retrying.`;
  } finally {
    finishAdminOperation(operationId, `${kind === "create_company" ? "Create" : "Update"} partner company ${label}.`);
  }
  revalidatePath("/manage");
  revalidatePath("/manage/audit");
  revalidatePath("/companies");
  const result = adminOperation(operationId);
  const outcome = adminOperationItems(operationId)[0]?.status;
  return { ok: outcome === "succeeded", message: outcome === "succeeded"
    ? "Company change verified and recorded."
    : outcome === "skipped" ? "No company write was sent because the live directory changed after preview. Preview again."
      : outcome === "submitted" ? "Autodesk accepted the company change; readback is pending or unavailable. Verify in the audit log."
        : "Company change failed or could not be verified. Review the audit log before retrying.",
    detail: [detail], operationId };
}

export async function companyChangeAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  try {
    const requestedKind = formData.get("kind");
    if (requestedKind !== "create_company" && requestedKind !== "update_company") {
      throw new Error("Choose create or edit company.");
    }
    const kind: PlanKind = requestedKind;
    if (formData.get("intent") === "execute") return await executeCompanyPlan(kind, formData);

    const session = await requireHubAdminSession();
    const mode = kind === "create_company" ? "create" : "update";
    const companyId = String(formData.get("companyId") ?? "");
    const peers = companyPeers(await fetchCompanies(session));
    const original = mode === "update" ? await getCompanyForEdit(session, companyId) : null;
    const directory = original ? [original, ...peers.filter((company) => company.id !== original.id)] : peers;
    const change = planCompanyChange(mode, {
      name: formData.get("name"), trade: formData.get("trade"),
      websiteUrl: formData.get("websiteUrl"), erpId: formData.get("erpId"),
      description: formData.get("description"),
    }, directory, companyId);
    const plan: AdminPlan = { kind, targets: [change], skips: [] };
    const preview = saveAdminPlan(session, plan,
      `Preview: ${mode === "create" ? "create" : "update"} ${change.values.name}; ${change.changedFields.length} field(s).`,
      companyChangeDetails(change));
    return { ok: true, message: preview.summary, preview, detail: preview.details };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
