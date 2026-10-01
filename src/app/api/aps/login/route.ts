import { NextResponse } from "next/server";
import { buildAuthorizeUrl, OAUTH_STATE_COOKIE } from "@/lib/aps/auth";
import { configProblems, env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const problems = configProblems();
  if (problems.length > 0) {
    return NextResponse.json({ error: "Configuration incomplete", problems }, { status: 500 });
  }
  const { url, state } = buildAuthorizeUrl();
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.callbackUrl.startsWith("https://"),
    path: "/api/aps",
    maxAge: 15 * 60,
  });
  return response;
}
