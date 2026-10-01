import type { ExpectedDeliverable } from "@/lib/closeoutStore";
import { removeDeliverableAction, updateDeliverableAction } from "./actions";

export function DeliverableEditor({ item }: { item: ExpectedDeliverable }) {
  return <details className="mt-1 text-xs"><summary className="cursor-pointer text-adsk-link">Edit requirement or remove it</summary>
    <form action={updateDeliverableAction} className="mt-2 grid gap-2 rounded border p-2 sm:grid-cols-2">
      <input type="hidden" name="deliverableId" value={item.id} />
      <label>Label<input required maxLength={160} name="label" defaultValue={item.label} className="mt-1 block w-full rounded border p-1" /></label>
      <label>Exact source ID<input maxLength={200} name="externalId" defaultValue={item.externalId} className="mt-1 block w-full rounded border p-1" /></label>
      <label>Name pattern<input maxLength={160} name="namePattern" defaultValue={item.namePattern} className="mt-1 block w-full rounded border p-1" /></label>
      <label>Exact folder path<input maxLength={300} name="folderPath" defaultValue={item.folderPath} className="mt-1 block w-full rounded border p-1" /></label>
      <label className="sm:col-span-2">Required metadata fields<input name="requiredMetadata" defaultValue={item.requiredMetadata.join(", ")} className="mt-1 block w-full rounded border p-1" /></label>
      <button className="w-fit rounded border px-3 py-1">Save changes</button>
    </form>
    <form action={removeDeliverableAction} className="mt-2"><input type="hidden" name="deliverableId" value={item.id} />
      <button className="text-red-700 hover:underline">Remove requirement</button></form>
  </details>;
}
