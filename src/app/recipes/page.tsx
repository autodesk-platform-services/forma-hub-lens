import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { PRODUCT_ACCESS_OPTIONS, PROJECT_TYPES } from "@/lib/aps/hubAdmin";
import { configProblems, env } from "@/lib/env";
import { cachedTemplates, listRecipes } from "@/lib/recipes";
import { Card, EmptyState } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { RecipeEditor, RecipePlanner, TemplateRefresh } from "./RecipeForms";

export const dynamic = "force-dynamic";

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ recipe?: string }>;
}) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  if (env.demoMode) return <div className="space-y-5">
    <h1 className="font-legend text-2xl">Project provisioning recipes · Demo</h1>
    <p className="text-sm text-adsk-gray">A fictional standard shows how project defaults and follow-up access requirements can be assembled.</p>
    <Card title="Healthcare project standard · Sample recipe"><dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-adsk-gray">Project type</dt><dd>Hospital · Production</dd></div>
      <div><dt className="text-adsk-gray">Naming</dt><dd>Northwind Healthcare — Project name</dd></div>
      <div><dt className="text-adsk-gray">Product checklist</dt><dd>Docs · Build · Model Coordination</dd></div>
      <div><dt className="text-adsk-gray">Access checklist</dt><dd>Project managers · Field leads · Owner representatives</dd></div>
    </dl><p className="mt-4 text-xs text-adsk-gray">This example is read-only. The project-creation simulator accepts fictional names and creates results only within that view; it does not provision products or members.</p>
    <Link href="/manage?task=projects" className="mt-4 inline-block text-sm text-adsk-link underline">Try the project-creation simulation →</Link></Card>
  </div>;

  const recipes = listRecipes(session);
  const templates = cachedTemplates(session);
  const selectedId = (await searchParams).recipe;
  const selected = recipes.find((recipe) => recipe.id === selectedId) ?? null;
  const canWrite = session.hubRole === "hub_admin";

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mb-2 text-xs text-adsk-gray"><Link href="/manage" className="hover:underline">Admin</Link> / Project provisioning / Recipes</p>
        <h1 className="font-legend text-2xl text-adsk-black">Project provisioning recipes</h1>
        <p className="mt-1 max-w-3xl text-sm text-adsk-gray">
          Save project defaults, preview a batch, and submit project creation through the audited Manage workflow.
          Native Forma templates are selected from active template projects.
        </p>
      </div>
      <Link href="/manage?task=projects" className="text-xs text-adsk-link underline">Create projects →</Link>
    </div>

    {!canWrite && <Card title="Hub Admin required">
      <p className="text-xs text-adsk-gray">Your signed-in role can view recipes, but only a Hub Admin can save a recipe or create projects.</p>
    </Card>}

    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <Card title="Saved recipes" action={<Link href="/recipes" className="text-xs text-adsk-link underline">New recipe</Link>}>
        {recipes.length === 0 ? <EmptyState title="No recipes yet.">Save a recipe using the form.</EmptyState> :
          <ul className="space-y-2">{recipes.map((recipe) => <li key={recipe.id}>
            <Link href={`/recipes?recipe=${encodeURIComponent(recipe.id)}`}
              aria-current={recipe.id === selected?.id ? "page" : undefined}
              className={`block rounded border px-3 py-2 text-xs hover:border-adsk-gold ${recipe.id === selected?.id ? "border-adsk-gold bg-adsk-gold/10" : "border-adsk-lightgray"}`}>
              <span className="block font-medium">{recipe.name}</span>
              <span className="mt-0.5 block text-adsk-gray">{recipe.projectType} · {recipe.classification}</span>
            </Link>
          </li>)}</ul>}
      </Card>

      <div className="space-y-5">
        <Card title={selected ? "Edit recipe" : "New recipe"}
          subtitle="Saved per signed-in Autodesk user and hub. Presets do not change projects until an audited plan is executed."
          action={canWrite ? <TemplateRefresh count={templates.length} /> : undefined}>
          <RecipeEditor key={selected ? selected.id + ":" + selected.updatedAt : "new"} recipe={selected} templates={templates} canWrite={canWrite}
            projectTypes={PROJECT_TYPES} productLabels={PRODUCT_ACCESS_OPTIONS.map((option) => option.label)} />
        </Card>
        {selected && <Card title="Create projects with this recipe"
          subtitle="Preview resolves generated names and job numbers; execution is a live APS write with a ten-minute preview window.">
          <RecipePlanner key={selected.id + ":" + selected.updatedAt} recipe={selected} canWrite={canWrite} />
        </Card>}
        <Card title="Provisioning boundary">
          <div className="space-y-2 text-xs text-adsk-gray">
            <p>Automated here: create each project with its name, type, classification, generated job number, and optional native Forma template reference. Lens records the request and per-project outcome in the administrative audit.</p>
            <p>Follow up in Forma: verify project activation and template content; assign a project administrator if the template requires one to copy members. Member emails, product access, and access level saved in this recipe are a checklist only. They are not added by this action.</p>
            <p>Project creation and native template setup are asynchronous in Autodesk. An accepted response does not establish that every template setting or membership has finished applying.</p>
          </div>
        </Card>
      </div>
    </div>
  </div>;
}
