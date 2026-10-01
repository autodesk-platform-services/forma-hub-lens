"use client";

import Link from "next/link";
import { useActionState } from "react";
import { bulkRemoveMembers, type ManageState } from "@/app/manage/actions";

/** Uses the same server-side preview and audit path as Manage > Remove members. */
export function OffboardingRemovePanel({
  email,
  projectIds,
  batch,
  batches,
}: {
  email: string;
  projectIds: string[];
  batch: number;
  batches: number;
}) {
  const [state, action, pending] = useActionState<ManageState, FormData>(bulkRemoveMembers, null);
  return <form action={action} className="space-y-3 rounded border border-adsk-lightgray bg-adsk-white p-4">
    <div className="font-legend text-sm text-adsk-black">Removal batch {batch} of {batches}</div>
    <p className="text-xs text-adsk-gray">{projectIds.length} project{projectIds.length === 1 ? "" : "s"} · {email}. The preview rechecks current membership before any change.</p>
    <input type="hidden" name="members" value={email} />
    {projectIds.map((id) => <input key={id} type="hidden" name="projectIds" value={id} />)}
    <label className="block text-xs text-adsk-black">
      Type REMOVE to preview this batch
      <input name="confirm" autoComplete="off" className="mt-1 block w-52 rounded border border-adsk-lightgray px-2.5 py-1.5" />
    </label>
    <button type="submit" disabled={pending} className="rounded border border-adsk-linkvisited px-3 py-1.5 font-legend text-xs text-adsk-linkvisited hover:bg-adsk-linkvisited hover:text-adsk-white disabled:opacity-50">
      {pending ? "Working…" : "Preview removal"}
    </button>
    {state && <div className="space-y-2 text-xs">
      <p role="status" className={state.ok ? "text-adsk-black" : "text-adsk-linkvisited"}>{state.message}</p>
      {state.preview && <div className="rounded border border-adsk-gold bg-adsk-gold/10 p-3">
        <div className="font-semibold">{state.preview.planned} removal(s) planned; {state.preview.skipped} skipped</div>
        <p className="mt-1">Preview expires at {new Date(state.preview.expiresAt).toLocaleTimeString()}.</p>
        <a href={`/manage/preview/${state.preview.id}/export`} className="mt-1 inline-block text-adsk-link hover:underline">Export preview CSV</a>
        <input type="hidden" name="planId" value={state.preview.id} />
        <button type="submit" name="intent" value="execute" disabled={pending} className="mt-2 rounded bg-adsk-black px-3 py-1.5 font-legend text-xs text-adsk-white disabled:opacity-50">Confirm and execute this preview</button>
      </div>}
      {state.detail && <ul className="max-h-28 overflow-auto">{state.detail.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      {state.operationId && <Link href={`/manage/audit/${state.operationId}`} className="text-adsk-link hover:underline">View audited operation →</Link>}
    </div>}
  </form>;
}
