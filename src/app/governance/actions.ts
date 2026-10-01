"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cachedProjects } from "@/lib/aps/admin";
import { requireSession } from "@/lib/aps/auth";
import { governanceFindings, normalizeSettings, type GovernanceRule } from "@/lib/governance";
import {
  clearGovernanceDecision,
  setGovernanceDecision,
  type GovernanceChoice,
} from "@/lib/reviewDecisions";
import { savedViewsOwner } from "@/lib/savedViews";

const RULES = new Set<GovernanceRule>([
  "quiet-project", "past-end-date", "missing-job-number",
  "large-membership", "no-project-members",
]);

function returnPath(formData: FormData): string {
  const requested = String(formData.get("filterRule") ?? "all");
  const rule = RULES.has(requested as GovernanceRule) ? requested : "all";
  const settings = normalizeSettings({
    quietDays: Number(formData.get("quietDays")),
    largeMembership: Number(formData.get("largeMembership")),
  });
  return `/governance?${new URLSearchParams({
    rule,
    quietDays: String(settings.quietDays),
    largeMembership: String(settings.largeMembership),
  })}`;
}

export async function updateGovernanceDecision(formData: FormData): Promise<void> {
  const path = returnPath(formData);
  let feedback: { kind: "notice" | "error"; text: string };
  try {
    const session = await requireSession();
    const owner = savedViewsOwner(session);
    if (!owner) throw new Error("Autodesk did not return a stable user ID or email. Sign out and in again.");
    const projectId = String(formData.get("projectId") ?? "").trim();
    const rule = String(formData.get("rule") ?? "") as GovernanceRule;
    const choice = String(formData.get("choice") ?? "");
    if (!RULES.has(rule)) throw new Error("Choose a valid review rule.");
    const project = cachedProjects().find((row) => row.id.toLowerCase() === projectId.toLowerCase());
    if (!project) throw new Error("This project is no longer in the local inventory.");
    if (choice === "reopen") {
      clearGovernanceDecision(owner, project.id, rule);
      feedback = { kind: "notice", text: "Finding returned to your review queue." };
    } else {
      if (!["acknowledged", "ignored", "snoozed"].includes(choice)) throw new Error("Choose a valid review action.");
      const settings = normalizeSettings({
        quietDays: Number(formData.get("quietDays")),
        largeMembership: Number(formData.get("largeMembership")),
      });
      const exists = governanceFindings(settings).findings.some((finding) =>
        finding.projectId.toLowerCase() === project.id.toLowerCase() && finding.rule === rule);
      if (!exists) throw new Error("This finding is no longer present. Refresh the review queue.");
      setGovernanceDecision(owner, project.id, rule, choice as GovernanceChoice);
      feedback = {
        kind: "notice",
        text: choice === "snoozed"
          ? "Finding snoozed for 30 days in your review queue."
          : choice === "ignored"
            ? "Finding ignored in your review queue."
            : "Finding acknowledged in your review queue.",
      };
    }
  } catch (error) {
    feedback = { kind: "error", text: error instanceof Error ? error.message.slice(0, 180) : "The review action failed." };
  }
  revalidatePath("/governance");
  redirect(`${path}&${feedback.kind}=${encodeURIComponent(feedback.text)}`);
}
