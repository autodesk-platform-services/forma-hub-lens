"use server";

import { revalidatePath } from "next/cache";
import { requireHubAdminSession } from "@/lib/aps/auth";
import { acknowledgeSchemaChanges } from "@/lib/dataHealth";
import { configProblems } from "@/lib/env";

export async function acknowledgeCurrentSchema(): Promise<void> {
  if (configProblems().length) throw new Error("Application setup is incomplete.");
  await requireHubAdminSession();
  acknowledgeSchemaChanges();
  revalidatePath("/data-health");
}
