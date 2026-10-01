"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/aps/auth";
import {
  addWatchItem,
  createSavedView,
  deleteSavedView,
  removeWatchItem,
  savedViewsOwner,
} from "@/lib/savedViews";

async function run(operation: (owner: string) => void, success: string): Promise<never> {
  let error: string | null = null;
  try {
    const session = await requireSession();
    const owner = savedViewsOwner(session);
    if (!owner) throw new Error("Autodesk did not return a stable user ID or email. Sign out and in again.");
    operation(owner);
  } catch (cause) {
    error = cause instanceof Error ? cause.message.slice(0, 180) : "The action failed.";
  }
  revalidatePath("/views");
  redirect(`/views?${error ? `error=${encodeURIComponent(error)}` : `notice=${encodeURIComponent(success)}`}`);
}

export async function saveViewAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "");
  const path = String(formData.get("path") ?? "");
  await run((owner) => { createSavedView(owner, name, path); }, "View saved.");
}

export async function deleteViewAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  await run((owner) => {
    if (!deleteSavedView(owner, id)) throw new Error("Saved view was not found in your account.");
  }, "View removed.");
}

export async function addWatchAction(formData: FormData): Promise<void> {
  const kind = String(formData.get("kind") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const label = String(formData.get("label") ?? "");
  await run((owner) => {
    if (kind !== "project" && kind !== "person") throw new Error("Choose a project or person.");
    addWatchItem(owner, kind, targetId, label);
  }, "Watchlist item saved.");
}

export async function removeWatchAction(formData: FormData): Promise<void> {
  const kind = String(formData.get("kind") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  await run((owner) => {
    if (kind !== "project" && kind !== "person") throw new Error("Choose a project or person.");
    if (!removeWatchItem(owner, kind, targetId)) throw new Error("Watchlist item was not found in your account.");
  }, "Watchlist item removed.");
}
