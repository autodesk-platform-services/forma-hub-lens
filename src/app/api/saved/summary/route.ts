import { NextResponse } from "next/server";
import { getSession } from "@/lib/aps/auth";
import { listSavedViews, listWatchItems, savedViewsOwner } from "@/lib/savedViews";

export const dynamic = "force-dynamic";

/** Keep the persistent header menu in step with user-owned local saves. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    const owner = savedViewsOwner(session);
    return NextResponse.json({
      hasOwner: Boolean(owner),
      views: owner ? listSavedViews(owner).slice(0, 4) : [],
      watched: owner ? listWatchItems(owner).slice(0, 4) : [],
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Saved items are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
