import "server-only";

import { randomUUID } from "node:crypto";
import type { Session } from "./aps/auth";
import {
  fetchTemplateProjects,
  PRODUCT_ACCESS_OPTIONS,
  PROJECT_TYPES,
  type NewProject,
  type TemplateProject,
} from "./aps/hubAdmin";
import { getDb } from "./db";
import { env } from "./env";

export type RecipeInput = {
  name: string;
  projectType: string;
  classification: "production" | "template";
  jobNumberPattern: string;
  templateProjectId: string | null;
  memberEmails: string[];
  productLabels: string[];
  memberAccessLevel: "member" | "administrator";
  suppressInvitationEmails: boolean;
};

export type Recipe = RecipeInput & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export type MemberFollowUpPreset = Pick<Recipe,
  "id" | "name" | "updatedAt" | "memberEmails" | "productLabels" |
  "memberAccessLevel" | "suppressInvitationEmails">;

export type CachedTemplate = TemplateProject & { fetchedAt: number };

function ownerKey(session: Session): string {
  const identity = session.userId || session.userEmail?.trim().toLowerCase();
  if (!identity) throw new Error("A verified Autodesk identity is required to manage recipes.");
  return env.hubId + "/" + identity;
}

function ensureRecipeTables(): void {
  getDb().exec(
    "CREATE TABLE IF NOT EXISTS provisioning_recipes (" +
    "id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, spec TEXT NOT NULL, " +
    "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  getDb().exec("CREATE INDEX IF NOT EXISTS provisioning_recipes_owner ON provisioning_recipes(owner_key)");
  getDb().exec(
    "CREATE TABLE IF NOT EXISTS provisioning_templates (" +
    "owner_key TEXT NOT NULL, template_id TEXT NOT NULL, name TEXT NOT NULL, " +
    "classification TEXT NOT NULL, status TEXT NOT NULL, fetched_at INTEGER NOT NULL, " +
    "PRIMARY KEY (owner_key, template_id))",
  );
}

export function cachedTemplates(session: Session): CachedTemplate[] {
  ensureRecipeTables();
  const rows = getDb().prepare(
    "SELECT template_id, name, classification, status, fetched_at " +
    "FROM provisioning_templates WHERE owner_key = ? ORDER BY name COLLATE NOCASE",
  ).all(ownerKey(session)) as Array<{
    template_id: string; name: string; classification: string; status: string; fetched_at: number;
  }>;
  return rows.map((row) => ({
    id: row.template_id, name: row.name, classification: row.classification,
    status: row.status, fetchedAt: row.fetched_at,
  }));
}

export async function refreshTemplateCache(session: Session, now = Date.now()): Promise<CachedTemplate[]> {
  const templates = (await fetchTemplateProjects(session)).filter(
    (project) => project.id && project.classification === "template" && project.status === "active",
  );
  ensureRecipeTables();
  const db = getDb();
  const owner = ownerKey(session);
  const insert = db.prepare(
    "INSERT INTO provisioning_templates " +
    "(owner_key, template_id, name, classification, status, fetched_at) VALUES (?, ?, ?, 'template', 'active', ?)",
  );
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM provisioning_templates WHERE owner_key = ?").run(owner);
    for (const template of templates) {
      insert.run(owner, template.id, template.name || "(unnamed template)", now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return cachedTemplates(session);
}

function validateRecipe(session: Session, input: RecipeInput): RecipeInput {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("Recipe name must be 1–100 characters.");
  if (!PROJECT_TYPES.includes(input.projectType)) throw new Error("Choose a supported project type.");
  if (!["production", "template"].includes(input.classification)) throw new Error("Choose a supported classification.");
  const pattern = input.jobNumberPattern.trim();
  if (pattern.length > 100 || /[{}]/.test(pattern.replace(/\{name\}|\{n+\}/g, ""))) {
    throw new Error("Job number pattern may use only {name}, {n}, {nn}, and similar number tokens.");
  }
  const emails = [...new Set(input.memberEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (emails.length > 200 || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Enter up to 200 valid member emails, one per line.");
  }
  const validProducts = new Set(PRODUCT_ACCESS_OPTIONS.map((option) => option.label));
  const productLabels = [...new Set(input.productLabels)];
  if (productLabels.some((label) => !validProducts.has(label))) {
    throw new Error("One of the product presets is not supported.");
  }
  if (!["member", "administrator"].includes(input.memberAccessLevel)) {
    throw new Error("Choose a supported member access level.");
  }
  if (input.templateProjectId && !cachedTemplates(session).some((template) =>
    template.id === input.templateProjectId && template.classification === "template" && template.status === "active")) {
    throw new Error("Refresh the native template list and choose an active Forma template.");
  }
  return {
    name,
    projectType: input.projectType,
    classification: input.classification,
    jobNumberPattern: pattern,
    templateProjectId: input.templateProjectId || null,
    memberEmails: emails,
    productLabels,
    memberAccessLevel: input.memberAccessLevel,
    suppressInvitationEmails: Boolean(input.suppressInvitationEmails),
  };
}

export function saveRecipe(session: Session, input: RecipeInput, id?: string, now = Date.now()): Recipe {
  ensureRecipeTables();
  const spec = validateRecipe(session, input);
  const owner = ownerKey(session);
  const db = getDb();
  if (id) {
    const existing = getRecipe(session, id);
    if (!existing) throw new Error("Recipe not found for this Autodesk user.");
    db.prepare("UPDATE provisioning_recipes SET spec = ?, updated_at = ? WHERE id = ? AND owner_key = ?")
      .run(JSON.stringify(spec), now, id, owner);
    return { ...spec, id, createdAt: existing.createdAt, updatedAt: now };
  }
  const newId = randomUUID();
  db.prepare(
    "INSERT INTO provisioning_recipes (id, owner_key, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(newId, owner, JSON.stringify(spec), now, now);
  return { ...spec, id: newId, createdAt: now, updatedAt: now };
}

function toRecipe(row: { id: string; spec: string; created_at: number; updated_at: number }): Recipe {
  return {
    ...JSON.parse(row.spec) as RecipeInput,
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function listRecipes(session: Session): Recipe[] {
  ensureRecipeTables();
  const rows = getDb().prepare(
    "SELECT id, spec, created_at, updated_at FROM provisioning_recipes " +
    "WHERE owner_key = ? ORDER BY updated_at DESC",
  ).all(ownerKey(session)) as Array<{ id: string; spec: string; created_at: number; updated_at: number }>;
  return rows.map(toRecipe);
}

export function getRecipe(session: Session, id: string): Recipe | null {
  ensureRecipeTables();
  const row = getDb().prepare(
    "SELECT id, spec, created_at, updated_at FROM provisioning_recipes WHERE id = ? AND owner_key = ?",
  ).get(id, ownerKey(session)) as
    { id: string; spec: string; created_at: number; updated_at: number } | undefined;
  return row ? toRecipe(row) : null;
}

/** Only the saved recipe's owner can load member defaults for Manage. */
export function memberFollowUpPreset(session: Session, recipeId: string): MemberFollowUpPreset | null {
  const recipe = getRecipe(session, recipeId);
  if (!recipe) return null;
  return {
    id: recipe.id,
    name: recipe.name,
    updatedAt: recipe.updatedAt,
    memberEmails: recipe.memberEmails,
    productLabels: recipe.productLabels,
    memberAccessLevel: recipe.memberAccessLevel,
    suppressInvitationEmails: recipe.suppressInvitationEmails,
  };
}

export function deleteRecipe(session: Session, id: string): boolean {
  ensureRecipeTables();
  return getDb().prepare("DELETE FROM provisioning_recipes WHERE id = ? AND owner_key = ?")
    .run(id, ownerKey(session)).changes > 0;
}

export type RecipePreview = {
  targets: NewProject[];
  skips: Array<{ key: string; label: string; reason: string }>;
};

function jobNumber(pattern: string, name: string, index: number): string | undefined {
  if (!pattern) return undefined;
  const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return pattern.replace(/\{name\}|\{n+\}/g, (token) =>
    token === "{name}" ? slug : String(index).padStart(token.length - 2, "0"));
}

export function previewProjects(
  recipe: Recipe,
  namesText: string,
  existingNames: Iterable<string> = [],
): RecipePreview {
  const names = namesText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  if (names.length === 0 || names.length > 50) throw new Error("Enter 1–50 project names, one per line.");
  const existing = new Set([...existingNames].map((name) => name.trim().toLowerCase()));
  const seenNames = new Set<string>();
  const seenJobs = new Set<string>();
  const targets: NewProject[] = [];
  const skips: RecipePreview["skips"] = [];
  names.forEach((name, index) => {
    const key = "line-" + String(index + 1);
    let reason = "";
    const normalized = name.toLowerCase();
    const number = jobNumber(recipe.jobNumberPattern, name, index + 1);
    if (name.length > 255) reason = "Project name exceeds 255 characters.";
    else if (seenNames.has(normalized)) reason = "Duplicate name in this preview.";
    else if (existing.has(normalized)) reason = "Name already exists in the cached hub inventory.";
    else if (number && number.length > 100) reason = "Generated job number exceeds 100 characters.";
    else if (number && seenJobs.has(number.toLowerCase())) reason = "Duplicate generated job number.";
    seenNames.add(normalized);
    if (reason) {
      skips.push({ key, label: name, reason });
    } else {
      if (number) seenJobs.add(number.toLowerCase());
      targets.push({
        name,
        type: recipe.projectType,
        classification: recipe.classification,
        jobNumber: number,
        templateProjectId: recipe.templateProjectId || undefined,
      });
    }
  });
  return { targets, skips };
}
