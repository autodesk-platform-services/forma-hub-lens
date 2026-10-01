"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cachedProjects } from "@/lib/aps/admin";
import { requireSession } from "@/lib/aps/auth";
import {
  clearLifecycleDecision,
  setLifecycleDecision,
  type LifecycleChoice,
} from "@/lib/reviewDecisions";
import { savedViewsOwner } from "@/lib/savedViews";

export async function updateLifecycleDecision(formData: FormData): Promise<void> {
  let feedback: { kind: "notice" | "error"; text: string };
  try {
    const session = await requireSession();
    const owner = savedViewsOwner(session);
    if (!owner) throw new Error("Autodesk did not return a stable user ID or email. Sign out and in again.");
    const projectId = String(formData.get("projectId") ?? "").trim();
    const choice = String(formData.get("choice") ?? "");
    const project = cachedProjects().find((row) => row.id.toLowerCase() === projectId.toLowerCase());
    if (!project) throw new Error("This project is no longer in the local inventory.");
    if (choice === "reopen") {
      clearLifecycleDecision(owner, project.id);
      feedback = { kind: "notice", text: "Project returned to your lifecycle review queue." };
    } else {
      if (project.status !== "active") throw new Error("Only active projects can receive a lifecycle review state.");
      if (!["keep-active", "snoozed", "prepare-archive"].includes(choice)) throw new Error("Choose a valid lifecycle action.");
      setLifecycleDecision(owner, project.id, choice as LifecycleChoice);
      feedback = {
        kind: "notice",
        text: choice === "snoozed"
          ? "Project snoozed for 90 days in your lifecycle queue."
          : choice === "keep-active"
            ? "Project marked Keep active in your lifecycle queue."
            : "Project marked Prepare archive. No Autodesk project status was changed.",
      };
    }
  } catch (error) {
    feedback = { kind: "error", text: error instanceof Error ? error.message.slice(0, 180) : "The lifecycle action failed." };
  }
  revalidatePath("/lifecycle");
  redirect(`/lifecycle?${feedback.kind}=${encodeURIComponent(feedback.text)}`);
}
