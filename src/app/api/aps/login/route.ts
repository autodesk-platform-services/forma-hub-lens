import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Retained for old bookmarks; the synthetic demo is open without sign-in. */
export async function GET() {
  return new NextResponse(null, {
    status: 307, headers: { Location: "/", "Cache-Control": "no-store" },
  });
}
