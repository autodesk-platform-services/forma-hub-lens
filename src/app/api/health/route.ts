import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { configProblems } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for container platforms.
 *
 * Reports unhealthy when config is incomplete or the cache volume isn't
 * writable — the two failures that otherwise show up as confusing runtime
 * errors after a deploy. Public responses contain only generic check statuses;
 * configuration names, values, filesystem paths and hub data stay private.
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
