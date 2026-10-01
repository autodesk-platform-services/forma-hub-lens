"use client";

import { CheckboxGroup } from "@/components/CheckboxGroup";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { CachedTemplate, Recipe } from "@/lib/recipes";
import { bulkCreateProjects, type ManageState } from "@/app/manage/actions";
import {
  deleteRecipeAction, previewRecipeAction, refreshNativeTemplates, saveRecipeAction,
  type RecipeActionState, type RecipePreviewState,
} from "./actions";

function SubmitButton({ label, pendingLabel, disabled = false }: {
  label: string; pendingLabel: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending || disabled}
    className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black hover:opacity-90 disabled:opacity-40">
    {pending ? pendingLabel : label}
  </button>;
}

function Message({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state) return null;
  return <p role="status" className={`mt-2 text-xs ${state.ok ? "text-adsk-gray" : "text-adsk-linkvisited"}`}>
    {state.message}
  </p>;
}

export function TemplateRefresh({ count }: { count: number }) {
  const [state, action] = useActionState<RecipeActionState, FormData>(refreshNativeTemplates, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [router, state]);
  return <form action={action} className="text-right">
    <SubmitButton label={`Refresh templates (${count})`} pendingLabel="Refreshing…" />
    <Message state={state} />
  </form>;
}

export function RecipeEditor({ recipe, templates, canWrite, projectTypes, productLabels }: {
  recipe: Recipe | null;
  templates: CachedTemplate[];
  canWrite: boolean;
  projectTypes: string[];
  productLabels: string[];
}) {
  const [state, action] = useActionState<RecipeActionState, FormData>(saveRecipeAction, null);
  const [deleteState, deleteAction] = useActionState<RecipeActionState, FormData>(deleteRecipeAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && state.recipeId) {
      router.push(`/recipes?recipe=${encodeURIComponent(state.recipeId)}`);
      router.refresh();
    }
  }, [router, state]);
  useEffect(() => {
    if (deleteState?.ok) {
      router.push("/recipes");
      router.refresh();
    }
  }, [router, deleteState]);

  return <div className="space-y-4">
    <form action={action} className="space-y-4">
      {recipe && <input type="hidden" name="recipeId" value={recipe.id} />}
      <fieldset disabled={!canWrite} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-adsk-gray">
            Recipe name
            <input name="name" required maxLength={100} defaultValue={recipe?.name ?? ""} placeholder="Healthcare standard"
              className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-xs normal-case tracking-normal text-adsk-black" />
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-adsk-gray">
            Project type
            <select name="projectType" defaultValue={recipe?.projectType ?? "Office"}
              className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-xs normal-case tracking-normal text-adsk-black">
              {projectTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-adsk-gray">
            Classification
            <select name="classification" defaultValue={recipe?.classification ?? "production"}
              className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-xs normal-case tracking-normal text-adsk-black">
              <option value="production">Production</option><option value="template">Template</option>
            </select>
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-adsk-gray">
            Job number pattern
            <input name="jobNumberPattern" maxLength={100} defaultValue={recipe?.jobNumberPattern ?? ""} placeholder="HC-{nnn} or {name}-{n}"
              className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-xs normal-case tracking-normal text-adsk-black" />
          </label>
        </div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-adsk-gray">
          Native Forma template
          <select name="templateProjectId" defaultValue={recipe?.templateProjectId ?? ""}
            className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-xs normal-case tracking-normal text-adsk-black">
            <option value="">No native template</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name ?? template.id}</option>)}
          </select>
          <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal">Refresh this list from APS before selecting a template. Only active projects classified as templates appear.</span>
        </label>
        <div className="border-t border-adsk-lightgray pt-3">
          <h3 className="text-xs font-semibold">Follow-up presets</h3>
          <p className="mt-1 text-[11px] text-adsk-gray">Saved for the checklist after creation. This workflow does not assign these people or products.</p>
          <label className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-adsk-gray">
            Member emails, one per line
            <textarea name="memberEmails" rows={3} defaultValue={recipe?.memberEmails.join("\n") ?? ""}
              placeholder="admin@example.com"
              className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-xs normal-case tracking-normal text-adsk-black" />
          </label>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-adsk-gray">Product access to assign later</p>
          <CheckboxGroup name="productLabels" label="Product access to assign later" className="mt-2">
          <div className="flex flex-wrap gap-2">
            {productLabels.map((label) => <label key={label}
              className="inline-flex items-center gap-1.5 rounded border border-adsk-lightgray px-2 py-1 text-xs">
              <input type="checkbox" name="productLabels" value={label}
                defaultChecked={recipe?.productLabels.includes(label)} />{label}
            </label>)}
          </div>
          </CheckboxGroup>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="text-xs">Access level for later assignment{" "}
              <select name="memberAccessLevel" defaultValue={recipe?.memberAccessLevel ?? "member"}
                className="ml-1 rounded border border-adsk-lightgray px-2 py-1">
                <option value="member">Member</option><option value="administrator">Project administrator</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input name="suppressInvitationEmails" type="checkbox" defaultChecked={recipe?.suppressInvitationEmails} />
              Suppress invitation emails when members are assigned later
            </label>
          </div>
        </div>
      </fieldset>
      {canWrite && <SubmitButton label={recipe ? "Save changes" : "Save recipe"} pendingLabel="Saving…" />}
      <Message state={state} />
    </form>
    {recipe && canWrite && <form action={deleteAction} className="border-t border-adsk-lightgray pt-3">
      <input type="hidden" name="recipeId" value={recipe.id} />
      <button type="submit" className="text-xs text-adsk-linkvisited underline">Delete recipe</button>
      <Message state={deleteState} />
    </form>}
  </div>;
}

export function RecipePlanner({ recipe, canWrite }: { recipe: Recipe; canWrite: boolean }) {
  const [state, action] = useActionState<RecipePreviewState, FormData>(previewRecipeAction, null);
  return <div className="space-y-4">
    <form action={action} className="space-y-3">
      <input type="hidden" name="recipeId" value={recipe.id} />
      <label className="block text-[11px] font-medium uppercase tracking-wide text-adsk-gray">
        Project names, one per line (up to 50)
        <textarea name="projectNames" required rows={5} placeholder={"Riverside Medical Center\nNorthgate Transit Hub"}
          disabled={!canWrite}
          className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-xs normal-case tracking-normal text-adsk-black" />
      </label>
      {canWrite && <SubmitButton label="Preview projects" pendingLabel="Preparing preview…" />}
      <Message state={state} />
    </form>

    {state?.skips?.length ? <div className="rounded border border-adsk-lightgray p-3 text-xs">
      <h3 className="font-semibold">Skipped at preview ({state.skips.length})</h3>
      <ul className="mt-1 space-y-1 text-adsk-gray">{state.skips.map((item) =>
        <li key={item.key}>{item.label}: {item.reason}</li>)}</ul>
    </div> : null}

    {state?.ok && state.plan && state.targets && <div className="rounded border border-adsk-gold bg-adsk-gold/10 p-3 text-xs">
      <h3 className="font-semibold">Review {state.plan.planned} project creation requests</h3>
      <p className="mt-1 text-adsk-gray">Preview expires at {new Date(state.plan.expiresAt).toLocaleString()}.</p>
      <div className="mt-3 max-h-56 overflow-auto rounded border border-adsk-lightgray bg-adsk-white">
        <table className="w-full text-left text-xs"><thead><tr className="border-b border-adsk-lightgray text-adsk-gray">
          <th className="p-2">Project</th><th className="p-2">Type</th><th className="p-2">Job number</th><th className="p-2">Native template</th>
        </tr></thead><tbody>{state.targets.map((project) => <tr key={project.name} className="border-b border-adsk-offwhite">
          <td className="p-2">{project.name}</td><td className="p-2">{project.type}</td>
          <td className="p-2">{project.jobNumber || "—"}</td><td className="p-2 font-mono text-[10px]">{project.templateProjectId || "—"}</td>
        </tr>)}</tbody></table>
      </div>
      <p className="mt-3 text-adsk-gray">Execution creates projects only. Review member and product presets in the checklist below.</p>
      <ExecuteRecipePlan key={state.plan.id} planId={state.plan.id} recipeId={recipe.id}
        hasFollowUp={recipe.memberEmails.length > 0 || recipe.productLabels.length > 0} />
    </div>}

    {(recipe.memberEmails.length > 0 || recipe.productLabels.length > 0) &&
      <div className="rounded border border-adsk-lightgray p-3 text-xs">
        <h3 className="font-semibold">Manual follow-up checklist</h3>
        {recipe.memberEmails.length > 0 && <div className="mt-2 text-adsk-gray">
          <p>Assign {recipe.memberEmails.length} saved member{recipe.memberEmails.length === 1 ? "" : "s"} as {recipe.memberAccessLevel};
            {" "}{recipe.suppressInvitationEmails ? "suppress" : "send"} invitation emails as appropriate.</p>
          <ul className="mt-1 max-h-28 overflow-auto font-mono text-[11px]">
            {recipe.memberEmails.map((email) => <li key={email}>{email}</li>)}
          </ul>
        </div>}
        {recipe.productLabels.length > 0 && <p className="mt-1 text-adsk-gray">
          Set product access: {recipe.productLabels.join(", ")}.
        </p>}
        <p className="mt-2 text-adsk-gray">Confirm each project exists and is active in Forma before completing these steps.</p>
        <Link href={`/manage?recipe=${encodeURIComponent(recipe.id)}`}
          className="mt-2 inline-block text-adsk-link underline">
          Use current saved presets in Manage after activation →
        </Link>
      </div>}
  </div>;
}

function ExecuteRecipePlan({ planId, recipeId, hasFollowUp }: {
  planId: string; recipeId: string; hasFollowUp: boolean;
}) {
  const [execution, execute] = useActionState<ManageState, FormData>(bulkCreateProjects, null);
  return <>
    {!execution?.operationId && <form action={execute} className="mt-3">
      <input type="hidden" name="intent" value="execute" />
      <input type="hidden" name="planId" value={planId} />
      <SubmitButton label="Create reviewed projects" pendingLabel="Creating projects…" />
    </form>}
    <Message state={execution} />
    {execution?.operationId && <div className="mt-2 flex flex-wrap gap-3">
      <Link href={`/manage/audit/${encodeURIComponent(execution.operationId)}`}
        className="text-adsk-link underline">View administrative audit →</Link>
      {hasFollowUp && <Link href={`/manage?recipe=${encodeURIComponent(recipeId)}`}
        className="text-adsk-link underline">After activation, use saved member presets →</Link>}
    </div>}
  </>;
}
