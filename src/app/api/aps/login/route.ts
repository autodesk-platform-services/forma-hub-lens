import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const problems = configProblems();
  if (problems.length > 0) {
    return NextResponse.json({ error: "Configuration incomplete", problems }, { status: 500 });
  }
  const { url } = buildAuthorizeUrl();
  return NextResponse.redirect(url);
}
