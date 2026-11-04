"use server";

import { requireSession } from "@/lib/aps/auth";

/** Browser demo preferences are never accepted as shared server mutations. */
async function browserOnly(): Promise<never> {
  await requireSession();
  throw new Error("Demo saved items live only in your browser. Use the demo Saved controls.");
}
export async function saveViewAction(_formData: FormData): Promise<void> { await browserOnly(); }
export async function deleteViewAction(_formData: FormData): Promise<void> { await browserOnly(); }
export async function addWatchAction(_formData: FormData): Promise<void> { await browserOnly(); }
export async function removeWatchAction(_formData: FormData): Promise<void> { await browserOnly(); }
