import { NextResponse } from "next/server";
import { getSession } from "@/lib/aps/auth";
import { savedViewsOwner } from "@/lib/savedViews";

export const dynamic = "force-dynamic";

/** No visitor preferences are stored or returned by the demo server. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Demo configuration is invalid" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    const owner = savedViewsOwner(session);
    return NextResponse.json({
      hasOwner: Boolean(owner),
      views: [],
      watched: [],
      storage: "browser-only",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Saved items are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
