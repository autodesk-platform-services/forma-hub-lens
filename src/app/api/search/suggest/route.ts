import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/aps/auth";
import { searchPortfolio } from "@/lib/portfolioSearch";

export const dynamic = "force-dynamic";

/** Suggestions use only the local project mirror and uploaded CSV tables. */
export async function GET(request: NextRequest) {
  try {
    if (!await getSession()) {
      return NextResponse.json({ error: "Demo configuration is invalid" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
    if (query.length < 2) {
      return NextResponse.json({ query, suggestions: [], total: 0 }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const result = searchPortfolio(query, "all", 1);
    const suggestions = [
      ...result.projects.rows.slice(0, 3).map((item) => ({
        kind: "project" as const,
        id: item.id,
        title: item.name,
        detail: [item.status, item.jobNumber ? `Job ${item.jobNumber}` : null].filter(Boolean).join(" · ") || "Project",
        href: `/projects/${encodeURIComponent(item.id)}`,
      })),
      ...result.people.rows.filter((item) => item.id && !item.duplicateId).slice(0, 3).map((item) => ({
        kind: "person" as const,
        id: item.id!,
        title: item.name ?? item.email ?? item.id!,
        detail: item.email ?? "Person from uploaded CSV",
        href: `/people/${encodeURIComponent(item.id!)}`,
      })),
      ...result.companies.rows.filter((item) => item.id).slice(0, 3).map((item) => ({
        kind: "company" as const,
        id: item.id!,
        title: item.name ?? item.id!,
        detail: [item.city, item.country].filter(Boolean).join(", ") || "Company from uploaded CSV",
        href: `/companies/${encodeURIComponent(item.id!)}`,
      })),
    ];
    return NextResponse.json({
      query,
      suggestions,
      total: result.projects.total + result.people.total + result.companies.total,
      sources: {
        projects: result.projects.source.asOf,
        people: result.people.source.asOf,
        companies: result.companies.source.asOf,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Suggestions are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
