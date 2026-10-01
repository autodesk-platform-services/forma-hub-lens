"use client";

import { useRef, type ReactNode } from "react";

/** Select-all controls for native, uncontrolled checkbox groups. FormData keeps each original name/value. */
export function CheckboxGroup({ name, label, selectAllLabel = "Select all", clearLabel = "Clear all", children, className = "" }: {
  name: string;
  label?: string;
  selectAllLabel?: string;
  clearLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  function setAll(checked: boolean) {
    for (const checkbox of container.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []) {
      if (checkbox.name === name && !checkbox.disabled) {
        checkbox.checked = checked;
        checkbox.indeterminate = false;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
  return <div ref={container} role="group" aria-label={label ?? name} className={className}>
    <div className="mb-2 flex flex-wrap gap-3 text-xs">
      <button type="button" onClick={() => setAll(true)} className="text-adsk-link hover:underline">{selectAllLabel}</button>
      <button type="button" onClick={() => setAll(false)} className="text-adsk-link hover:underline">{clearLabel}</button>
    </div>
    {children}
  </div>;
}
