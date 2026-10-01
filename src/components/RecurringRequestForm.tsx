"use client";

import { useActionState, useState } from "react";
import { requestRecurringExtract, type ActionState } from "@/app/actions";
import { CheckboxList } from "@/components/CheckboxList";

const groups = ["activities", "admin", "issues", "rfis", "submittals", "sheets", "forms", "cost", "locations"];
const labelClass = "block text-[11px] font-medium uppercase tracking-wide text-adsk-gray";
const inputClass = "mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black focus:border-adsk-yellow focus:outline-none";

export function RecurringRequestForm({ jobsLastDay, projects }: {
  jobsLastDay: number;
  projects: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestRecurringExtract, null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(["activities"]);
  const firstRun = new Date(Date.now() + 86_400_000).toISOString().slice(0, 11) + "02:00";
  const endDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  return <form action={action} className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div>
        <label htmlFor="schedule-description" className={labelClass}>Description</label>
        <input id="schedule-description" name="description" required maxLength={200}
          placeholder="Daily portfolio activity" className={inputClass} />
      </div>
      <div>
        <label htmlFor="schedule-interval" className={labelClass}>Repeat</label>
        <select id="schedule-interval" name="scheduleInterval" className={inputClass} defaultValue="DAY">
          <option value="DAY">Every day</option><option value="WEEK">Every week</option>
          <option value="MONTH">Every month</option><option value="YEAR">Every year</option>
        </select>
      </div>
      <div>
        <label htmlFor="schedule-projects" className={labelClass}>Projects</label>
        <select id="schedule-projects" name="projectStatus" className={inputClass} defaultValue="active">
          <option value="all">All visible projects</option>
          <option value="active">Active projects</option>
          <option value="archived">Archived projects</option>
        </select>
      </div>
      <div>
        <label htmlFor="schedule-from" className={labelClass}>First run (UTC)</label>
        <input id="schedule-from" name="effectiveFromUtc" type="datetime-local"
          required defaultValue={firstRun} className={inputClass} />
      </div>
      <div>
        <label htmlFor="schedule-to" className={labelClass}>End date (UTC)</label>
        <input id="schedule-to" name="effectiveToUtc" type="date"
          required defaultValue={endDate} className={inputClass} />
      </div>
      <div>
        <label htmlFor="schedule-range" className={labelClass}>Activity window per job</label>
        <select id="schedule-range" name="dateRange" className={inputClass} defaultValue="YESTERDAY">
          <option value="YESTERDAY">Yesterday</option>
          <option value="PAST_7_DAYS">Past 7 days</option>
          <option value="MONTH_TO_DATE">Month to date</option>
          <option value="LAST_MONTH">Last calendar month</option>
          <option value="TODAY">Today so far</option>
        </select>
        <p className="mt-1 text-[11px] text-adsk-gray">Applies to activities only; choose a relative range so future jobs remain useful.</p>
      </div>
    </div>

    {projects.length > 0 && <div>
      <CheckboxList label="Specific projects (optional)" name="projectIds" maxSelected={50}
        options={projects.map((project) => ({ value: project.id, label: project.name }))} />
      <p className="mt-1 text-[11px] text-adsk-gray">Leave empty for a hub-wide schedule, which requires Executive Overview in Autodesk. Use the checkboxes for project-level access.</p>
    </div>}

    <fieldset>
      <legend className={labelClass}>Service groups</legend>
      <div className="mt-1 flex gap-3 text-xs">
        <button type="button" onClick={() => setSelectedGroups(groups)}
          className="text-adsk-link hover:underline">Select all</button>
        <button type="button" onClick={() => setSelectedGroups([])}
          className="text-adsk-link hover:underline">Clear all</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {groups.map((group) => <label key={group}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-adsk-lightgray px-2.5 py-1.5 text-xs hover:border-adsk-blue has-checked:border-adsk-yellow">
          <input name="serviceGroups" type="checkbox" value={group}
            checked={selectedGroups.includes(group)}
            onChange={(event) => setSelectedGroups((current) => event.target.checked
              ? [...current, group] : current.filter((value) => value !== group))}
            className="accent-adsk-yellow" />
          {group}
        </label>)}
      </div>
    </fieldset>

    <div className="rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs">
      APS will create the recurring extract jobs. Lens currently imports activity CSVs only when an admin selects Ingest;
      reporting ZIPs are uploaded separately in Tools. Automatic ingestion needs a configured background worker
      and a supported durable APS authorization flow. Each run counts toward Autodesk&apos;s 24-jobs-per-24-hours limit.
      {jobsLastDay >= 20 && <strong className="ml-1">There are already {jobsLastDay} known jobs from the past 24 hours.</strong>}
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending}
        className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black hover:opacity-90 disabled:opacity-50">
        {pending ? "Creating schedule…" : "Create APS schedule"}
      </button>
      {state && <p className={state.ok ? "text-xs text-adsk-black" : "text-xs text-adsk-linkvisited"}>{state.message}</p>}
    </div>
  </form>;
}
