import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession, getSession } from "@/lib/aps/auth";

export const dynamic = "force-dynamic";

/**
 * Ends the current session.
 *
 * The header's Sign out button uses the server action; this endpoint is the
 * scriptable equivalent, and also clears a cookie left pointing at a session
 * that no longer exists server-side. POST only, so a stray link can't sign
 * someone out.
 */
export async function POST() {
  const session = await getSession();
  if (session) destroySession(session.id);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
