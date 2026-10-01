import { getSession } from "@/lib/aps/auth";
import { adminOperation, adminOperationItemCount, adminOperationItems } from "@/lib/adminOperations";
import { csvCell } from "@/lib/csvExport";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in required", { status: 401 });
  if (session.hubRole !== "hub_admin") return new Response("Hub Admin required", { status: 403 });
  const { id } = await params;
  const operation = adminOperation(id);
  if (!operation) return new Response("Operation not found", { status: 404 });

  const rows = ["operation_id,kind,actor,started_at,item_index,item_key,label,status,detail"];
  const total = adminOperationItemCount(id);
  for (let offset = 0; offset < total; offset += 1000) {
    for (const item of adminOperationItems(id, 1000, offset)) {
      rows.push([
        id, operation.kind, operation.actorEmail ?? "", new Date(operation.startedAt).toISOString(),
        String(item.index), item.key, item.label, item.status, item.detail ?? "",
      ].map(csvCell).join(","));
    }
  }
  return new Response(rows.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="forma-hub-lens-admin-${id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
