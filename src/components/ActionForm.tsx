"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import type { ActionState } from "@/app/actions";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Form wrapper for the server actions that call Autodesk. Shows pending state
 * and the action's result inline — these calls take seconds, not milliseconds.
 */
export function ActionForm({
  action,
  label,
  pendingLabel,
  hidden,
  variant = "secondary",
  children,
  className = "",
}: {
  action: Action;
  label: string;
  pendingLabel?: string;
  hidden?: Record<string, string>;
  variant?: "primary" | "secondary";
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);

  const buttonClass =
    variant === "primary"
      ? "rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black hover:opacity-90 disabled:opacity-50"
      : "rounded border border-adsk-lightgray px-3 py-1.5 text-xs font-medium text-adsk-black hover:border-adsk-gray hover:text-adsk-black disabled:opacity-50";

  return (
    <form action={formAction} className={className}>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? (pendingLabel ?? "Working…") : label}
        </button>
        {state && (
          <p className={`text-xs ${state.ok ? "text-adsk-black" : "text-adsk-linkvisited"}`}>{state.message}</p>
        )}
      </div>
    </form>
  );
}
