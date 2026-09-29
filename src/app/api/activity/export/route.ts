import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/aps/auth";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { listActivities } from "@/lib/queries";
import { csvCell } from "@/lib/csvExport";

export const dynamic = "force-dynamic";

const PAGE = 5_000;
const MAX_ROWS = 500_000;

const COLUMNS = [
  "occurred_at",
  "project_id",
  "project_name",
  "actor_name",
  "actor_email",
  "service",
  "action",
  "target_type",
  "target_name",
] as const;

/** Exports the currently filtered activity view as CSV. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params: SearchParams = {};
  for (const key of request.nextUrl.searchParams.keys()) {
    params[key] = request.nextUrl.searchParams.getAll(key);
  }
  const filters = parseFilters(params);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(COLUMNS.join(",") + "\n"));

      let offset = 0;
      while (offset < MAX_ROWS) {
        const { rows } = listActivities(filters, { limit: PAGE, offset });
        if (rows.length === 0) break;
        const chunk = rows
          .map((row) =>
            [
              row.occurredAt ?? "",
              row.projectId ?? "",
              row.projectName,
              row.actorName ?? "",
              row.actorEmail ?? "",
              row.service ?? "",
              row.action ?? "",
              row.targetType ?? "",
              row.targetName ?? "",
            ]
              .map(csvCell)
              .join(","),
          )
          .join("\n");
        controller.enqueue(encoder.encode(chunk + "\n"));
        offset += rows.length;
        if (rows.length < PAGE) break;
      }
      controller.close();
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="forma-activity-${stamp}.csv"`,
    },
  });
}
