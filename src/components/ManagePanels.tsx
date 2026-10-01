"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { MemberFollowUpPreset } from "@/lib/recipes";
import { CheckboxList } from "@/components/CheckboxList";
import {
  bulkAddMembers,
  bulkArchiveProjects,
  bulkCreateProjects,
  bulkRemoveMembers,
  type ManageState,
} from "@/app/manage/actions";

type Project = { id: string; name: string; status: string | null };
type Company = { id: string; name: string };
type AssignableRole = { id: string; name: string; projectIds: string[] };

const label = "block font-legend text-[10px] uppercase tracking-wide text-adsk-gray";
const input =
  "mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black focus:border-adsk-blue focus:outline-none";
const mono = input + " font-mono";

function Result({ state, pending }: { state: ManageState; pending: boolean }) {
  if (!state) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className={`text-xs ${state.ok ? "text-adsk-black" : "text-adsk-linkvisited"}`}>
        {state.message}
      </p>
      {state.preview && (
        <div className="rounded border border-adsk-gold bg-adsk-gold/10 p-3 text-xs text-adsk-black">
          <p className="font-semibold">Review the stored preview</p>
          <p className="mt-1">
            {state.preview.planned} planned change(s) · {state.preview.skipped} skipped · expires at{" "}
            {new Date(state.preview.expiresAt).toLocaleTimeString()}
          </p>
          <p className="mt-1 text-adsk-gray">If you change any fields above, preview again before confirming.</p>
          <a href={`/manage/preview/${state.preview.id}/export`} className="mt-1 inline-block text-adsk-link hover:underline">
            Export full preview CSV
          </a>
          <input type="hidden" name="planId" value={state.preview.id} />
          <button
            type="submit"
            name="intent"
            value="execute"
            disabled={pending}
            className="mt-2 rounded border border-adsk-black bg-adsk-black px-3 py-1.5 font-legend text-xs text-adsk-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Executing…" : "Confirm and execute this preview"}
          </button>
        </div>
      )}
      {state.detail && state.detail.length > 0 && (
        <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto rounded bg-adsk-offwhite p-2">
          {state.detail.map((line, index) => (
            <li key={index} className="font-mono text-[10px] text-adsk-gray">
              {line}
            </li>
          ))}
        </ul>
      )}
      {state.operationId && (
        <Link href={`/manage/audit/${state.operationId}`} className="inline-block text-xs text-adsk-link hover:underline">
          View full operation record →
        </Link>
      )}
    </div>
  );
}

function ProjectPicker({ projects }: { projects: Project[] }) {
  return <CheckboxList label="Projects" name="projectIds" maxSelected={50} className="max-h-48" options={projects.map((project) => ({
    value: project.id,
    label: project.name + (project.status && project.status !== "active" ? ` (${project.status})` : ""),
  }))} />;
}

export function AddMembersPanel({
  projects,
  companies,
  productOptions,
  roleOptions = [],
  roleSourceReady = false,
  preset,
}: {
  projects: Project[];
  companies: Company[];
  productOptions: Array<{ label: string; keys: string[]; note?: string }>;
  roleOptions?: AssignableRole[];
  roleSourceReady?: boolean;
  preset?: MemberFollowUpPreset | null;
}) {
  const [state, action, pending] = useActionState<ManageState, FormData>(bulkAddMembers, null);
  const [selectedProducts, setSelectedProducts] = useState<string[]>(preset?.productLabels ?? []);

  return (
    <form action={action} className="space-y-4">
      {preset && (
        <p className="rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs text-adsk-black">
          Loaded the current saved member and product defaults from <strong>{preset.name}</strong>. After project creation finishes,
          sync projects and select the active projects below. Review the values and run a preview before any import is sent.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <ProjectPicker projects={preset ? projects.filter((project) => project.status === "active") : projects} />

        <div>
          <label className={label} htmlFor="members">
            Members — one per line: <code>email, First, Last</code>
          </label>
          <textarea
            id="members"
            name="members"
            rows={7}
            defaultValue={preset?.memberEmails.join("\n") ?? ""}
            className={mono}
            placeholder={"jane.doe@example.com, Jane, Doe\njohn.smith@example.com"}
          />
        </div>
      </div>

      <fieldset>
        <legend className={label}>Choose product access…</legend>
        <div className="mt-1 flex gap-2 text-[11px]">
          <button type="button" onClick={() => setSelectedProducts(productOptions.map((option) => option.label))} className="text-adsk-link hover:underline">Select all products</button>
          <button type="button" onClick={() => setSelectedProducts([])} className="text-adsk-link hover:underline">Clear</button>
          <span className="text-adsk-gray">{selectedProducts.length} selected</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {productOptions.map((option) => (
            <label
              key={option.label}
              title={option.note ? `${option.note} (${option.keys.join(", ")})` : option.keys.join(", ")}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black hover:border-adsk-blue has-checked:border-adsk-yellow"
            >
              <input type="checkbox" name="products" value={option.label}
                checked={selectedProducts.includes(option.label)}
                onChange={() => setSelectedProducts((current) => current.includes(option.label)
                  ? current.filter((label) => label !== option.label) : [...current, option.label])}
                className="accent-adsk-yellow" />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        {roleSourceReady && roleOptions.length > 0 ? <>
          <CheckboxList label="Roles for new members (optional)" name="roleIds" className="max-h-40" maxSelected={20} limitNoun="roles"
            options={roleOptions.map((role) => ({ value: role.id, label: `${role.name} (${role.projectIds.length} projects in snapshot)` }))} />
          <p className="mt-1 text-[11px] text-adsk-gray">Only active roles from a Lens-ingested APS Data Connector admin extract are offered. Each selected role must appear on every selected project. Existing project members are skipped and their roles are not changed.</p>
        </> : <p className="text-[11px] text-adsk-gray">Role assignment is available after a trusted, complete APS Data Connector admin extract is ingested. The Roles tab can still be browsed from uploaded snapshots.</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className={label} htmlFor="accessLevel">
            Access level
          </label>
          <select id="accessLevel" name="accessLevel" className={input} defaultValue={preset?.memberAccessLevel ?? "member"}>
            <option value="member">Member</option>
            <option value="administrator">Administrator</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="companyId">
            Company (optional)
          </label>
          <select id="companyId" name="companyId" className={input} defaultValue="">
            <option value="">— none —</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-end gap-2 pb-1.5 text-xs text-adsk-black">
          <input type="checkbox" name="suppressEmails"
            defaultChecked={preset?.suppressInvitationEmails ?? false}
            className="accent-adsk-yellow" />
          Suppress invitation emails
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Previewing…" : "Preview additions"}
      </button>
      <Result state={state} pending={pending} />
    </form>
  );
}

export function RemoveMembersPanel({ projects }: { projects: Project[] }) {
  const [state, action, pending] = useActionState<ManageState, FormData>(bulkRemoveMembers, null);

  return (
    <form action={action} className="space-y-4">
      <p className="rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs text-adsk-black">
        Removing a member revokes their access to the selected projects immediately. This cannot be
        undone from here.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <ProjectPicker projects={projects} />
        <div>
          <label className={label} htmlFor="removeMembers">
            Emails to remove — one per line
          </label>
          <textarea id="removeMembers" name="members" rows={7} className={mono} />
        </div>
      </div>

      <div className="max-w-xs">
        <label className={label} htmlFor="confirm">
          Type REMOVE to preview
        </label>
        <input id="confirm" name="confirm" className={input} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded border border-adsk-linkvisited px-3 py-1.5 font-legend text-xs text-adsk-linkvisited hover:bg-adsk-linkvisited hover:text-adsk-white disabled:opacity-50"
      >
        {pending ? "Previewing…" : "Preview removal"}
      </button>
      <Result state={state} pending={pending} />
    </form>
  );
}

export function CreateProjectsPanel({ projectTypes }: { projectTypes: string[] }) {
  const [state, action, pending] = useActionState<ManageState, FormData>(bulkCreateProjects, null);

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded border border-adsk-lightgray bg-adsk-offwhite p-3 text-xs">
        <strong>Start blank</strong>
        <span className="text-adsk-gray">or</span>
        <Link href="/recipes" className="text-adsk-link underline">Create from a recipe →</Link>
      </div>
      <div>
        <label className={label} htmlFor="projects">
          Projects — one per line: <code>Name, Type, JobNumber</code> (type and job number optional)
        </label>
        <textarea
          id="projects"
          name="projects"
          rows={7}
          className={mono}
          placeholder={"Riverside Medical Center, Hospital, JOB-1001\nNorthgate Transit Hub"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={label} htmlFor="type">
            Default type
          </label>
          <select id="type" name="type" className={input} defaultValue="Office">
            {projectTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="classification">
            Classification
          </label>
          <select id="classification" name="classification" className={input} defaultValue="production">
            <option value="production">Production</option>
            <option value="template">Template</option>
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Previewing…" : "Preview project creation"}
      </button>
      <Result state={state} pending={pending} />
    </form>
  );
}

export function Tabs({
  tabs,
  defaultActive,
  links = [],
}: {
  tabs: Array<{ id: string; label: string; group: string; content: React.ReactNode }>;
  defaultActive?: string;
  links?: Array<{ group: string; label: string; href: string }>;
}) {
  const [active, setActive] = useState(tabs.find((tab) => tab.id === defaultActive)?.id ?? tabs[0]?.id);
  const groups = [...new Set([...tabs.map((tab) => tab.group), ...links.map((link) => link.group)])];
  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Admin actions" className="space-y-4 border-b border-adsk-lightgray pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
        {groups.map((group) => <div key={group}>
          <h2 className="mb-1 font-legend text-[11px] uppercase tracking-wide text-adsk-gray">{group}</h2>
          <div className="flex flex-wrap gap-1 lg:block">
            {tabs.filter((tab) => tab.group === group).map((tab) => <button key={tab.id} type="button"
              onClick={() => setActive(tab.id)} aria-current={active === tab.id ? "page" : undefined}
              className={`rounded px-3 py-2 text-left font-legend text-xs lg:block lg:w-full ${active === tab.id
                ? "bg-adsk-yellow text-adsk-black" : "text-adsk-gray hover:bg-adsk-offwhite hover:text-adsk-black"}`}>
              {tab.label}
            </button>)}
            {links.filter((link) => link.group === group).map((link) => <Link key={link.href} href={link.href}
              className="rounded px-3 py-2 text-left font-legend text-xs text-adsk-gray hover:bg-adsk-offwhite hover:text-adsk-black lg:block lg:w-full">
              {link.label} ↗
            </Link>)}
          </div>
        </div>)}
      </nav>
      <section aria-label={tabs.find((tab) => tab.id === active)?.label} className="min-w-0">
        <h2 className="font-legend text-base text-adsk-black">{tabs.find((tab) => tab.id === active)?.label}</h2>
        <div className="pt-4">{tabs.find((tab) => tab.id === active)?.content}</div>
      </section>
    </div>
  );
}

/**
 * Bulk archive. Only active projects are offered — archiving is a move from
 * active to archived, so anything already archived or suspended is not a
 * candidate and is left out of the picker entirely.
 */
export function ArchiveProjectsPanel({ projects }: { projects: Project[] }) {
  const [state, action, pending] = useActionState<ManageState, FormData>(
    bulkArchiveProjects,
    null,
  );
  const [selected, setSelected] = useState<string[]>([]);

  const active = projects.filter((p) => p.status === "active");

  return (
    <form action={action} className="space-y-4">
      <p className="rounded border border-adsk-lightgray bg-adsk-offwhite px-3 py-2 text-xs text-adsk-black">
        Archiving moves a project from <strong>Active</strong> to <strong>Archived</strong>. Nothing
        is deleted — the project keeps all of its data and members, and it can be set back to active
        in Forma. Archived projects disappear from users&apos; active project lists.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <CheckboxList label={`Active projects (${active.length} of ${projects.length})`} name="projectIds"
            options={active.map((project) => ({ value: project.id, label: project.name }))}
            selected={selected} onSelectionChange={setSelected} maxSelected={50}
            emptyMessage="No active projects match." />
        </div>

        <div className="space-y-3">
          <div>
            <span className={label}>Selected for archiving</span>
            <div className="mt-1 max-h-40 overflow-auto rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-2">
              {selected.length === 0 ? (
                <p className="text-[11px] text-adsk-gray">Nothing selected yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {selected.map((id) => (
                    <li key={id} className="truncate text-[11px] text-adsk-black">
                      {/* look up across all projects: once archived, a project
                          leaves `active` and would otherwise show as a raw id */}
                      {projects.find((p) => p.id === id)?.name ?? id}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="max-w-xs">
            <label className={label} htmlFor="archiveConfirm">
              Type ARCHIVE to preview
            </label>
            <input id="archiveConfirm" name="confirm" className={input} autoComplete="off" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || selected.length === 0}
          className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? "Previewing…"
            : `Preview ${selected.length || ""} project${selected.length === 1 ? "" : "s"}`.trim()}
        </button>
        <span className="text-[10px] text-adsk-gray">
          Requires Autodesk account administrator rights · max 50 per run
        </span>
      </div>
      <Result state={state} pending={pending} />
    </form>
  );
}
