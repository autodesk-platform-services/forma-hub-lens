import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { configProblems } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for container platforms.
 *
 * Reports unhealthy when config is incomplete or the cache volume isn't
 * writable — the two failures that otherwise show up as confusing runtime
 * errors after a deploy. Deliberately exposes no hub data.
 */
export async function GET() {
  const problems = configProblems();
  const checks: Record<string, string> = {};

  checks.config = problems.length === 0 ? "ok" : problems.join("; ");

  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM dataset_tables")
      .get() as { n: number } | undefined;
    checks.database = "ok";
    checks.datasetTables = String(row?.n ?? 0);
  } catch {
    // This endpoint is public: never disclose filesystem paths or SQL details.
    checks.database = "unavailable";
  }

  const healthy = checks.config === "ok" && checks.database === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
