import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forma-recipes-"));
process.env.DATA_DIR = directory;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const {
  cachedTemplates, deleteRecipe, getRecipe, listRecipes, memberFollowUpPreset, previewProjects,
  refreshTemplateCache, saveRecipe,
} = await import("../src/lib/recipes.ts");
const { createProject } = await import("../src/lib/aps/hubAdmin.ts");
const { closeDb } = await import("../src/lib/db.ts");

const session = {
  id: "session", mode: "live" as const, accessToken: "token", refreshToken: null, expiresAt: Date.now() + 100_000,
  scope: "account:read account:write", userId: "user-a", userName: "Admin", userEmail: "admin@example.test",
  hubVerifiedAt: Date.now(), hubRole: "hub_admin" as const,
};
const otherSession = { ...session, id: "other-session", userId: "user-b", userEmail: "other@example.test" };
const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
  closeDb();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("active native templates are fetched with classification filter and cached per Autodesk user", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return Response.json({
      results: [
        { id: "template-active", name: "Hospital standard", classification: "template", status: "active" },
        { id: "template-archived", name: "Old", classification: "template", status: "archived" },
      ],
    });
  }) as typeof fetch;
  const templates = await refreshTemplateCache(session, 1234);
  assert.equal(templates.length, 1);
  assert.equal(templates[0].id, "template-active");
  assert.equal(cachedTemplates(otherSession).length, 0);
  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/construction/admin/v1/accounts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/projects");
  assert.equal(url.searchParams.get("filter[classification]"), "template");
  assert.equal(url.searchParams.get("filter[status]"), "active");
});

test("recipes are owned by one Autodesk user and preview resolves template and job-number pattern", () => {
  const recipe = saveRecipe(session, {
    name: "Healthcare", projectType: "Hospital", classification: "production",
    jobNumberPattern: "HC-{nnn}-{name}", templateProjectId: "template-active",
    memberEmails: ["Admin@Example.test", "admin@example.test"],
    productLabels: ["Forma Build"], memberAccessLevel: "member",
    suppressInvitationEmails: true,
  }, undefined, 2000);
  assert.deepEqual(recipe.memberEmails, ["admin@example.test"]);
  assert.equal(listRecipes(session).length, 1);
  assert.equal(getRecipe(otherSession, recipe.id), null);
  assert.deepEqual(memberFollowUpPreset(session, recipe.id), {
    id: recipe.id, name: "Healthcare", updatedAt: 2000,
    memberEmails: ["admin@example.test"], productLabels: ["Forma Build"],
    memberAccessLevel: "member", suppressInvitationEmails: true,
  });
  assert.equal(memberFollowUpPreset(otherSession, recipe.id), null);

  const preview = previewProjects(recipe,
    "Riverside Medical Center\nRiverside Medical Center\nExisting Hospital\nNorthgate Hospital",
    ["Existing Hospital"]);
  assert.deepEqual(preview.targets.map((target) => target.name),
    ["Riverside Medical Center", "Northgate Hospital"]);
  assert.equal(preview.targets[0].jobNumber, "HC-001-RIVERSIDE-MEDICAL-CENTER");
  assert.equal(preview.targets[1].jobNumber, "HC-004-NORTHGATE-HOSPITAL");
  assert.equal(preview.targets[1].templateProjectId, "template-active");
  assert.equal(preview.skips.length, 2);

  assert.equal(deleteRecipe(otherSession, recipe.id), false);
  assert.equal(deleteRecipe(session, recipe.id), true);
});

test("project creation sends the native template object supported by APS", async () => {
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ jobId: "creation-job-1" });
  }) as typeof fetch;
  const result = await createProject(session, {
    name: "Riverside", type: "Hospital", classification: "production",
    jobNumber: "HC-001", templateProjectId: "template-active",
  });
  assert.deepEqual(body, {
    name: "Riverside", type: "Hospital", classification: "production",
    jobNumber: "HC-001", template: { projectId: "template-active" },
  });
  assert.equal(result.jobId, "creation-job-1");
});
