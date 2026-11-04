import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Ignore old OAuth responses. No codes, states, cookies or tokens are processed. */
export async function GET() {
  return new NextResponse(null, {
    status: 307, headers: { Location: "/", "Cache-Control": "no-store" },
  });
}
