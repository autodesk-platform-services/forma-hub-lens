"use client";

import { useId, useState } from "react";
import { hiddenSelectedValues, toggleShownSelection } from "@/lib/checkboxSelection";

export type CheckboxListOption = { value: string; label: string };

type Props = {
  label: string;
  name: string;
  options: CheckboxListOption[];
  defaultSelected?: string[];
  selected?: string[];
  onSelectionChange?: (values: string[]) => void;
  maxSelected?: number;
  limitNoun?: string;
  emptyMessage?: string;
  className?: string;
};

/** Repeated checkbox names preserve the same FormData.getAll payload as a native multiple select. */
export function CheckboxList({
  label,
  name,
  options,
  defaultSelected = [],
  selected,
  onSelectionChange,
  maxSelected,
  limitNoun = "projects",
  emptyMessage = "No projects match this filter.",
  className = "max-h-56",
}: Props) {
  const searchId = useId();
  const [filter, setFilter] = useState("");
  const [localSelected, setLocalSelected] = useState<string[]>(defaultSelected);
  const current = selected ?? localSelected;
  const selectedSet = new Set(current);
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const shown = options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedFilter));
  const allShownSelected = shown.length > 0 && shown.every((option) => selectedSet.has(option.value));
  const needed = shown.filter((option) => !selectedSet.has(option.value)).length;
  const selectAllDisabled = shown.length === 0 ||
    (!allShownSelected && maxSelected !== undefined && current.length + needed > maxSelected);

  function update(next: string[]) {
    if (selected === undefined) setLocalSelected(next);
    onSelectionChange?.(next);
  }

  function toggle(value: string) {
    if (selectedSet.has(value)) update(current.filter((item) => item !== value));
    else if (maxSelected === undefined || current.length < maxSelected) update([...current, value]);
  }

  function toggleShown() {
    if (!selectAllDisabled) update(toggleShownSelection(current, shown.map((option) => option.value), maxSelected));
  }

  return <fieldset className="min-w-0">
    <legend className="block font-legend text-[10px] uppercase tracking-wide text-adsk-gray">{label}</legend>
    <label htmlFor={searchId} className="sr-only">Filter {label.toLocaleLowerCase()}</label>
    <input id={searchId} type="search" value={filter} onChange={(event) => setFilter(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
      placeholder="Filter by name…"
      className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black focus:border-adsk-blue focus:outline-none" />
    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-t border border-adsk-lightgray bg-adsk-offwhite px-2.5 py-1.5">
      <button type="button" onClick={toggleShown} disabled={selectAllDisabled}
        className="text-left font-legend text-xs text-adsk-link hover:underline disabled:cursor-not-allowed disabled:text-adsk-gray disabled:no-underline">
        {allShownSelected ? "Clear shown" : "Select all shown"}
      </button>
      <span className="flex items-center gap-2">
        <span className="text-[10px] text-adsk-gray" aria-live="polite">{shown.length} shown · {current.length} selected</span>
        {current.length > 0 && <button type="button" onClick={() => update([])} className="text-[10px] text-adsk-link hover:underline">Clear all</button>}
      </span>
    </div>
    <div className={`${className} overflow-auto rounded-b border-x border-b border-adsk-lightgray bg-adsk-white`}>
      {shown.length === 0 ? <p className="px-2.5 py-2 text-xs text-adsk-gray">{emptyMessage}</p> :
        <ul>{shown.map((option) => <li key={option.value}>
          <label className="flex cursor-pointer items-start gap-2 border-b border-adsk-offwhite px-2.5 py-1.5 text-xs text-adsk-black last:border-b-0 hover:bg-adsk-offwhite">
            <input type="checkbox" name={name} value={option.value} checked={selectedSet.has(option.value)}
              disabled={!selectedSet.has(option.value) && maxSelected !== undefined && current.length >= maxSelected}
              onChange={() => toggle(option.value)} className="mt-0.5 shrink-0 accent-adsk-yellow" />
            <span>{option.label}</span>
          </label>
        </li>)}</ul>}
    </div>
    {hiddenSelectedValues(current, shown.map((option) => option.value)).map((value) =>
      <input key={value} type="hidden" name={name} value={value} />)}
    {maxSelected !== undefined && <p className="mt-1 text-[10px] text-adsk-gray">
      Maximum {maxSelected} {limitNoun}. {selectAllDisabled && shown.length > 0 && !allShownSelected ? "Filter the list to select all shown." : ""}
    </p>}
  </fieldset>;
}
