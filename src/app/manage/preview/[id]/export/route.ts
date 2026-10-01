import { requireHubAdminSession } from "@/lib/aps/auth";
import { readAdminPlan } from "@/lib/adminOperations";
import { csvCell } from "@/lib/csvExport";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let session: Awaited<ReturnType<typeof requireHubAdminSession>>;
  try { session = await requireHubAdminSession(); }
  catch { return new Response("Hub Admin access required", { status: 403 }); }
  const { id } = await params;
  let plan: ReturnType<typeof readAdminPlan>["plan"];
  try { ({ plan } = readAdminPlan(session, id)); }
  catch { return new Response("Preview expired or unavailable", { status: 404 }); }

  const rows = ["operation,item_key,label,preview_status,detail"];
  const add = (key: string, label: string, status: string, detail: string) => {
    rows.push([plan.kind, key, label, status, detail].map(csvCell).join(","));
  };
  for (const skip of plan.skips) add(skip.key, skip.label, "skipped", skip.reason);
  if (plan.kind === "add_members") {
    for (const target of plan.targets) for (const user of target.users) {
      add(`${target.projectId}:${user.email}`, `${user.email} · ${target.projectId}`, "planned", "Import membership");
    }
  } else if (plan.kind === "remove_members") {
    for (const target of plan.targets) add(`${target.projectId}:${target.userId}`, `${target.email} · ${target.projectId}`, "planned", "Remove membership");
  } else if (plan.kind === "create_projects") {
    for (const target of plan.targets) add(target.name, target.name, "planned", `Create ${target.classification ?? "production"} ${target.type}`);
  } else if (plan.kind === "archive_projects") {
    for (const target of plan.targets) add(target.projectId, target.name, "planned", "Change active → archived; retain data");
  } else {
    for (const target of plan.targets) for (const field of target.changedFields) {
      add(target.companyId ?? target.values.name, target.values.name, "planned",
        `${field}: ${target.before?.[field] || "—"} → ${target.values[field] || "—"}`);
    }
  }
  return new Response(rows.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="forma-hub-lens-preview-${id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
