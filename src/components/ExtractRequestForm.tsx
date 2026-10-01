"use client";

import { useActionState, useState } from "react";
import { requestExtract, type ActionState } from "@/app/actions";
import { CheckboxList } from "@/components/CheckboxList";

const SERVICE_GROUPS = [
  { value: "activities", label: "activities", hint: "Docs, Issues and Admin audit events" },
  { value: "admin", label: "admin", hint: "Projects, users, companies, roles" },
  { value: "issues", label: "issues" },
  { value: "rfis", label: "rfis" },
  { value: "submittals", label: "submittals" },
  { value: "sheets", label: "sheets" },
  { value: "forms", label: "forms" },
  { value: "cost", label: "cost" },
  { value: "locations", label: "locations" },
];

const DATE_RANGES = [
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "TODAY", label: "Today so far" },
  { value: "PAST_7_DAYS", label: "Past 7 days" },
  { value: "MONTH_TO_DATE", label: "Month to date" },
  { value: "LAST_MONTH", label: "Last calendar month" },
  { value: "CUSTOM", label: "Custom range (max 31 days)" },
];

const labelClass = "block text-[11px] font-medium uppercase tracking-wide text-adsk-gray";
const inputClass =
  "mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black focus:border-adsk-yellow focus:outline-none";

export function ExtractRequestForm({ jobsLastDay, projects }: {
  jobsLastDay: number;
  projects: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    requestExtract,
    null,
  );
  const [dateRange, setDateRange] = useState("PAST_7_DAYS");
  const [selectedGroups, setSelectedGroups] = useState<string[]>(["activities"]);

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const nearLimit = jobsLastDay >= 20;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="description">
            Description
          </label>
          <input
            id="description"
            name="description"
            className={inputClass}
            placeholder="Weekly cross-project activity"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="projectStatus">
            Projects to include
          </label>
          <select id="projectStatus" name="projectStatus" className={inputClass} defaultValue="all">
            <option value="all">All projects in the hub</option>
            <option value="active">Active only</option>
            <option value="archived">Archived only</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="dateRange">
            Activity window
          </label>
          <select
            id="dateRange"
            name="dateRange"
            className={inputClass}
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value)}
          >
            {DATE_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-adsk-gray">
            Applies to the activities service group. History goes back 12 months.
          </p>
        </div>

        {dateRange === "CUSTOM" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="startDate">
                Start
              </label>
              <input
                id="startDate"
                name="startDate"
                type="date"
                className={inputClass}
                defaultValue={weekAgo}
                max={today}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="endDate">
                End
              </label>
              <input
                id="endDate"
                name="endDate"
                type="date"
                className={inputClass}
                defaultValue={today}
                max={today}
              />
            </div>
          </div>
        )}
      </div>

      {projects.length > 0 && <div>
        <CheckboxList label="Specific projects (optional)" name="projectIds" maxSelected={50}
          options={projects.map((project) => ({ value: project.id, label: project.name }))} />
        <p className="mt-1 text-[11px] text-adsk-gray">Leave empty for a hub-wide request, which requires Executive Overview in Autodesk. Use the checkboxes to select projects if your account has project-level Data Connector access.</p>
      </div>}

      <fieldset>
        <legend className={labelClass}>Service groups</legend>
        <div className="mt-1 flex gap-3 text-xs">
          <button type="button" onClick={() => setSelectedGroups(SERVICE_GROUPS.map((group) => group.value))}
            className="text-adsk-link hover:underline">Select all</button>
          <button type="button" onClick={() => setSelectedGroups([])}
            className="text-adsk-link hover:underline">Clear all</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SERVICE_GROUPS.map((group) => (
            <label
              key={group.value}
              title={group.hint}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black hover:border-adsk-blue has-checked:border-adsk-yellow has-checked:text-adsk-black"
            >
              <input
                type="checkbox"
                name="serviceGroups"
                value={group.value}
                checked={selectedGroups.includes(group.value)}
                onChange={(event) => setSelectedGroups((current) => event.target.checked
                  ? [...current, group.value] : current.filter((value) => value !== group.value))}
                className="accent-adsk-yellow"
              />
              {group.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-adsk-gray">
          Only <code className="text-adsk-black">activities</code> feeds the activity views. Other
          groups still land in the extract and are listed for direct download.
        </p>
      </fieldset>

      {nearLimit && (
        <p className="rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs text-adsk-black">
          {jobsLastDay} jobs already ran for this hub in the last 24 hours. Autodesk caps it at 24.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Submitting…" : "Submit data request"}
        </button>
        {state && (
          <p className={`text-xs ${state.ok ? "text-adsk-black" : "text-adsk-linkvisited"}`}>{state.message}</p>
        )}
      </div>
    </form>
  );
}
