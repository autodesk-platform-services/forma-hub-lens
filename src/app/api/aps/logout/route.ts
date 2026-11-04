import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Compatibility endpoint: the public demo has no authenticated session to end. */
export async function POST() {
  return new NextResponse(null, {
    status: 303, headers: { Location: "/", "Cache-Control": "no-store" },
  });
}
