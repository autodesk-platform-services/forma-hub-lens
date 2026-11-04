import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/aps/auth";
import { specById } from "@/lib/dashboards/specs";
import { runDashboard, toolStatus } from "@/lib/dashboards/engine";

export const dynamic = "force-dynamic";

/** Computes one tool's dashboard on demand, so opening the Tools tab stays cheap. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Demo configuration is invalid" }, { status: 503 });

  const { id } = await params;
  const spec = specById(id);
  if (!spec) return NextResponse.json({ error: `Unknown tool "${id}"` }, { status: 404 });

  const status = toolStatus(spec);
  const result = runDashboard(spec);

  return NextResponse.json({
    id: spec.id,
    name: spec.name,
    blurb: spec.blurb,
    template: spec.template,
    enabled: status.enabled,
    missing: status.missing,
    kpis: result.kpis,
    charts: result.charts,
  });
}
