"use client";

import { useActionState, useState } from "react";
import {
  bulkAddMembers,
  bulkCreateProjects,
  bulkRemoveMembers,
  type ManageState,
} from "@/app/manage/actions";

type Project = { id: string; name: string; status: string | null };
type Company = { id: string; name: string };

const label = "block font-legend text-[10px] uppercase tracking-wide text-adsk-gray";
const input =
  "mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black focus:border-adsk-blue focus:outline-none";
const mono = input + " font-mono";

function Result({ state }: { state: ManageState }) {
  if (!state) return null;
  return (
    <div className="mt-3">
      <p className={`text-xs ${state.ok ? "text-adsk-black" : "text-adsk-linkvisited"}`}>
        {state.message}
      </p>
      {state.detail && state.detail.length > 0 && (
        <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto rounded bg-adsk-offwhite p-2">
          {state.detail.map((line, index) => (
            <li key={index} className="font-mono text-[10px] text-adsk-gray">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectPicker({ projects }: { projects: Project[] }) {
  const [filter, setFilter] = useState("");
  const shown = projects.filter((p) =>
    p.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <div>
      <label className={label} htmlFor="projectFilter">
        Projects <span className="normal-case">(ctrl-click for several)</span>
      </label>
      <input
        id="projectFilter"
        className={input}
        placeholder="Filter by name…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <select name="projectIds" multiple size={7} className={`${input} h-auto`}>
        {shown.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
            {project.status && project.status !== "active" ? ` (${project.status})` : ""}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[10px] text-adsk-gray">
        {shown.length} of {projects.length} projects shown
      </p>
    </div>
  );
}

export function AddMembersPanel({
  projects,
  companies,
  productOptions,
}: {
  projects: Project[];
  companies: Company[];
  productOptions: Array<{ label: string; keys: string[]; note?: string }>;
}) {
  const [state, action, pending] = useActionState<ManageState, FormData>(bulkAddMembers, null);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <ProjectPicker projects={projects} />

        <div>
          <label className={label} htmlFor="members">
            Members — one per line: <code>email, First, Last</code>
          </label>
          <textarea
            id="members"
            name="members"
            rows={7}
            className={mono}
            placeholder={"jane.doe@example.com, Jane, Doe\njohn.smith@example.com"}
          />
        </div>
      </div>

      <fieldset>
        <legend className={label}>Choose product access…</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {productOptions.map((option) => (
            <label
              key={option.label}
              title={option.note ? `${option.note} (${option.keys.join(", ")})` : option.keys.join(", ")}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black hover:border-adsk-blue has-checked:border-adsk-yellow"
            >
              <input type="checkbox" name="products" value={option.label} className="accent-adsk-yellow" />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className={label} htmlFor="accessLevel">
            Access level
          </label>
          <select id="accessLevel" name="accessLevel" className={input} defaultValue="member">
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
          <input type="checkbox" name="suppressEmails" className="accent-adsk-yellow" />
          Suppress invitation emails
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Add members"}
      </button>
      <Result state={state} />
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
          Type REMOVE to confirm
        </label>
        <input id="confirm" name="confirm" className={input} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded border border-adsk-linkvisited px-3 py-1.5 font-legend text-xs text-adsk-linkvisited hover:bg-adsk-linkvisited hover:text-adsk-white disabled:opacity-50"
      >
        {pending ? "Removing…" : "Remove members"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function CreateProjectsPanel({ projectTypes }: { projectTypes: string[] }) {
  const [state, action, pending] = useActionState<ManageState, FormData>(bulkCreateProjects, null);

  return (
    <form action={action} className="space-y-4">
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
        {pending ? "Creating…" : "Create projects"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function Tabs({
  tabs,
}: {
  tabs: Array<{ id: string; label: string; content: React.ReactNode }>;
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-adsk-lightgray">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2 font-legend text-xs ${
              active === tab.id
                ? "border-adsk-yellow text-adsk-black"
                : "border-transparent text-adsk-gray hover:text-adsk-black"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-5">{tabs.find((tab) => tab.id === active)?.content}</div>
    </div>
  );
}
