"use server";

import { revalidatePath } from "next/cache";
import { cachedProjects } from "@/lib/aps/admin";
import { requireHubAdminSession } from "@/lib/aps/auth";
import type { NewProject } from "@/lib/aps/hubAdmin";
import { saveAdminPlan, type PlanPreview } from "@/lib/adminOperations";
import {
  cachedTemplates, deleteRecipe, getRecipe, previewProjects, refreshTemplateCache, saveRecipe,
  type RecipeInput, type RecipePreview,
} from "@/lib/recipes";

export type RecipeActionState = { ok: boolean; message: string; recipeId?: string } | null;
export type RecipePreviewState = {
  ok: boolean;
  message: string;
  plan?: PlanPreview;
  targets?: NewProject[];
  skips?: RecipePreview["skips"];
} | null;

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function saveRecipeAction(
  _prev: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  try {
    const session = await requireHubAdminSession();
    const input: RecipeInput = {
      name: String(formData.get("name") ?? ""),
      projectType: String(formData.get("projectType") ?? ""),
      classification: String(formData.get("classification") ?? "") as RecipeInput["classification"],
      jobNumberPattern: String(formData.get("jobNumberPattern") ?? ""),
      templateProjectId: String(formData.get("templateProjectId") ?? "") || null,
      memberEmails: String(formData.get("memberEmails") ?? "").split(/\r?\n/),
      productLabels: formData.getAll("productLabels").map(String),
      memberAccessLevel: String(formData.get("memberAccessLevel") ?? "member") as RecipeInput["memberAccessLevel"],
      suppressInvitationEmails: formData.get("suppressInvitationEmails") === "on",
    };
    const recipe = saveRecipe(session, input, String(formData.get("recipeId") ?? "") || undefined);
    revalidatePath("/recipes");
    return { ok: true, message: "Recipe saved for your Autodesk user.", recipeId: recipe.id };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function refreshNativeTemplates(
  _prev: RecipeActionState,
  _formData: FormData,
): Promise<RecipeActionState> {
  try {
    const session = await requireHubAdminSession();
    const templates = await refreshTemplateCache(session);
    revalidatePath("/recipes");
    return { ok: true, message: "Refreshed " + templates.length + " active native Forma templates." };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function deleteRecipeAction(
  _prev: RecipeActionState,
  formData: FormData,
): Promise<RecipeActionState> {
  try {
    const session = await requireHubAdminSession();
    const id = String(formData.get("recipeId") ?? "");
    if (!deleteRecipe(session, id)) throw new Error("Recipe not found for this Autodesk user.");
    revalidatePath("/recipes");
    return { ok: true, message: "Recipe deleted." };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function previewRecipeAction(
  _prev: RecipePreviewState,
  formData: FormData,
): Promise<RecipePreviewState> {
  try {
    const session = await requireHubAdminSession();
    const recipe = getRecipe(session, String(formData.get("recipeId") ?? ""));
    if (!recipe) throw new Error("Choose a saved recipe.");
    if (recipe.templateProjectId && !cachedTemplates(session).some((template) =>
      template.id === recipe.templateProjectId && template.classification === "template" && template.status === "active")) {
      throw new Error("The recipe's native template is not in the current cached template list. Refresh and review it.");
    }
    const existing = cachedProjects().map((project) => project.name);
    const preview = previewProjects(recipe, String(formData.get("projectNames") ?? ""), existing);
    if (!preview.targets.length) {
      return { ok: false, message: "No new project names remain after preview checks.", skips: preview.skips };
    }
    const summary = "Recipe " + recipe.name + ": create " + preview.targets.length +
      " project(s); " + preview.skips.length + " skipped.";
    const details = preview.targets.slice(0, 30).map((project) =>
      project.name + " · " + project.type +
      (project.jobNumber ? " · " + project.jobNumber : "") +
      (project.templateProjectId ? " · native template " + project.templateProjectId : ""));
    const plan = saveAdminPlan(
      session,
      { kind: "create_projects", targets: preview.targets, skips: preview.skips },
      summary,
      details,
    );
    return { ok: true, message: summary, plan, targets: preview.targets, skips: preview.skips };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}
