"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/aps/auth";
import { acknowledgeSchemaChanges } from "@/lib/dataHealth";
import { configProblems } from "@/lib/env";

export async function acknowledgeCurrentSchema(): Promise<void> {
  if (configProblems().length) throw new Error("Application setup is incomplete.");
  if (!(await getSession())) throw new Error("Sign in as a hub administrator or Executive Overview user first.");
  acknowledgeSchemaChanges();
  revalidatePath("/data-health");
}
