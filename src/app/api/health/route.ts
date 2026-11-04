import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { configProblems } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Public readiness probe: configuration and immutable in-memory sample data only.
 * Configuration names, values, filesystem paths and sample counts stay private.
 */
export async function GET() {
  const problems = configProblems();
  const checks: Record<string, string> = {};

  checks.config = problems.length === 0 ? "ok" : "unavailable";

  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    checks.database = "ok";
  } catch {
    // This endpoint is public: never disclose filesystem paths or SQL details.
    checks.database = "unavailable";
  }

  const healthy = checks.config === "ok" && checks.database === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
