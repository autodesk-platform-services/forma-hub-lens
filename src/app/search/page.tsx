import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems, env } from "@/lib/env";
import {
  searchPortfolio,
  type CompanyHit,
  type PersonHit,
  type ProjectHit,
  type SearchKind,
  type SearchResult,
} from "@/lib/portfolioSearch";
import { PEOPLE_PAGE_SIZE } from "@/lib/people";
import { savedViewsOwner } from "@/lib/savedViews";
import { Card, EmptyState, Pill, formatDateTime } from "@/components/ui";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { DemoWatchButton } from "@/components/DemoPreferences";

export const dynamic = "force-dynamic";

type SearchTab = SearchKind | "all";
type Params = Record<string, string | string[] | undefined>;
function value(params: Params, key: string): string {
  return typeof params[key] === "string" ? params[key].trim() : "";
}
function tab(value: string): SearchTab {
  return value === "projects" || value === "people" || value === "companies" ? value : "all";
}
function link(query: string, kind: SearchTab, page = 1): string {
  const params = new URLSearchParams({ q: query, kind });
  if (page > 1) params.set("page", String(page));
  return `/search?${params.toString()}`;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;

  const params = await searchParams;
  const query = value(params, "q").slice(0, 120);
  const kind = tab(value(params, "kind"));
  const requestedPage = Number(value(params, "page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const results = searchPortfolio(query, kind, page);
  const canSave = savedViewsOwner(session);
  const savedPath = link(query, kind);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-legend text-2xl text-adsk-black">Search across the hub</h1>
          <p className="mt-1 max-w-3xl text-sm text-adsk-gray">
            {env.demoMode
              ? "Search synthetic projects, people, and companies in the sample hub. Results are examples, not live Autodesk records."
              : "Search cached projects and uploaded people and company records. Results are paginated and show their source age; they are not live directory or access checks."}
          </p>
        </div>
        {query && canSave && <Link href={`/views?save=${encodeURIComponent(savedPath)}`} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-xs text-adsk-black">Save view</Link>}
      </div>

      <Card>
        <form action="/search" method="get" role="search" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="kind" value={kind} />
          <label className="text-xs text-adsk-gray">
            Name, email, ID, job number or company
            <input name="q" defaultValue={query} maxLength={120} autoFocus className="mt-1 block w-80 max-w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-sm text-adsk-black" />
          </label>
          <button type="submit" className="rounded border border-adsk-gold bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black">Search</button>
          {query && <Link href="/search" className="px-2 py-1.5 text-xs text-adsk-link">Clear</Link>}
        </form>
      </Card>

      {!query ? (
        <Card><EmptyState title="Enter a search term to explore the portfolio.">
          {env.demoMode
            ? "All results in this deployment come from synthetic sample records."
            : "Project results come from the last Admin API sync. People and companies come from the uploaded Data Connector ZIP."}
        </EmptyState></Card>
      ) : (
        <>
          <nav aria-label="Search categories" className="flex flex-wrap gap-2 text-xs">
            {([
              ["all", "All", results.projects.total + results.people.total + results.companies.total],
              ["projects", "Projects", results.projects.total],
              ["people", "People", results.people.total],
              ["companies", "Companies", results.companies.total],
            ] as const).map(([key, label, count]) => (
              <Link
                key={key}
                href={link(query, key)}
                aria-current={kind === key ? "page" : undefined}
                className={`rounded border px-3 py-1.5 ${kind === key ? "border-adsk-gold bg-adsk-gold/10 text-adsk-black" : "border-adsk-lightgray bg-adsk-white text-adsk-gray hover:text-adsk-black"}`}
              >
                {label} ({count.toLocaleString()})
              </Link>
            ))}
          </nav>

          {(kind === "all" || kind === "projects") && (
            <ProjectResults result={results.projects} query={query} preview={kind === "all"} canSave={canSave} />
          )}
          {(kind === "all" || kind === "people") && (
            <PersonResults result={results.people} query={query} preview={kind === "all"} canSave={canSave} />
          )}
          {(kind === "all" || kind === "companies") && (
            <CompanyResults result={results.companies} query={query} preview={kind === "all"} />
          )}
          {kind !== "all" && <Pager query={query} kind={kind} page={results[kind].page} total={results[kind].total} />}
        </>
      )}
    </div>
  );
}

function SourceLine<T>({ result }: { result: SearchResult<T> }) {
  if (env.demoMode) return <div className="mb-3 text-[11px] text-adsk-gray">
    <span className="rounded border border-adsk-gold bg-adsk-yellow/15 px-2 py-0.5 text-adsk-black">Sample data · synthetic hub records</span>
  </div>;
  const source = result.source.label === "Forma Admin API project sync" ? "project-sync" : "user-zip";
  return (
    <div className="mb-3 text-[11px] text-adsk-gray">
      <span className="mr-2">{result.source.label}</span>
      {result.source.available ? <ProvenanceBadge source={source} asOf={result.source.asOf} /> : <span>not loaded</span>}
      {result.source.truncated && <span className="ml-2"><Pill tone="warn">Truncated source</Pill></span>}
      <div className="mt-1">{result.source.note}</div>
    </div>
  );
}

function ProjectResults({ result, query, preview, canSave }: {
  result: SearchResult<ProjectHit>; query: string; preview: boolean; canSave: string | null;
}) {
  const rows = preview ? result.rows.slice(0, 5) : result.rows;
  return (
    <Card title={`Projects (${result.total.toLocaleString()})`} action={preview && result.total > 5 ? <Link href={link(query, "projects")} className="text-xs text-adsk-link">View all</Link> : undefined}>
      <SourceLine result={result} />
      {!result.source.available ? <EmptyState title={env.demoMode ? "Sample projects are unavailable." : "No project sync is available."}>{env.demoMode
        ? "The demo owner can restore the synthetic data set."
        : <>Use <Link href="/projects" className="text-adsk-link">Sync projects</Link> first.</>}</EmptyState>
        : rows.length === 0 ? <EmptyState title="No projects match." /> : (
          <ul className="divide-y divide-adsk-offwhite">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                <div className="min-w-0">
                  <Link href={`/projects/${encodeURIComponent(row.id)}`} className="font-medium text-adsk-black hover:text-adsk-link">{row.name}</Link>
                  <div className="text-[11px] text-adsk-gray">{[row.status, row.type, row.jobNumber ? `Job ${row.jobNumber}` : null].filter(Boolean).join(" · ") || "No status"}</div>
                  <div className="font-mono text-[10px] text-adsk-gray">{row.id} · {env.demoMode ? "sample updated" : "synced"} {formatDateTime(row.syncedAt)}</div>
                </div>
                {canSave && <WatchButton owner={canSave} kind="project" targetId={row.id} label={row.name} />}
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function PersonResults({ result, query, preview, canSave }: {
  result: SearchResult<PersonHit>; query: string; preview: boolean; canSave: string | null;
}) {
  const rows = preview ? result.rows.slice(0, 5) : result.rows;
  return (
    <Card title={`People (${result.total.toLocaleString()})`} action={preview && result.total > 5 ? <Link href={link(query, "people")} className="text-xs text-adsk-link">View all</Link> : undefined}>
      <SourceLine result={result} />
      {!result.source.available ? <EmptyState title={env.demoMode ? "Sample people are unavailable." : "No user table is available."}>{env.demoMode
        ? "The demo owner can restore the synthetic data set."
        : <>Upload <code>admin_users.csv</code> through <Link href="/data-health#reporting-dataset" className="text-adsk-link">Data health</Link>.</>}</EmptyState>
        : rows.length === 0 ? <EmptyState title="No people match." /> : (
          <ul className="divide-y divide-adsk-offwhite">
            {rows.map((row, index) => (
              <li key={`${row.id ?? "missing"}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                <div className="min-w-0">
                  {row.id && !row.duplicateId ? <Link href={`/people/${encodeURIComponent(row.id)}`} className="font-medium text-adsk-black hover:text-adsk-link">{row.name ?? row.email ?? row.id}</Link>
                    : <span className="font-medium text-adsk-black">{row.name ?? row.email ?? "(unnamed)"}</span>}
                  <div className="text-[11px] text-adsk-gray">{row.email ?? "No email"}{row.status ? ` · ${row.status}` : ""}</div>
                  {(row.duplicateId || !row.id) && <Pill tone="warn">{row.duplicateId ? "Duplicate source ID" : "No source ID"}</Pill>}
                </div>
                {canSave && row.id && !row.duplicateId && <WatchButton owner={canSave} kind="person" targetId={row.id} label={row.name ?? row.email ?? row.id} />}
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function CompanyResults({ result, query, preview }: {
  result: SearchResult<CompanyHit>; query: string; preview: boolean;
}) {
  const rows = preview ? result.rows.slice(0, 5) : result.rows;
  return (
    <Card title={`Companies (${result.total.toLocaleString()})`} action={preview && result.total > 5 ? <Link href={link(query, "companies")} className="text-xs text-adsk-link">View all</Link> : undefined}>
      <SourceLine result={result} />
      {!result.source.available ? <EmptyState title={env.demoMode ? "Sample companies are unavailable." : "No company table is available."}>{env.demoMode
        ? "The demo owner can restore the synthetic data set."
        : <>Upload <code>admin_companies.csv</code> through <Link href="/data-health#reporting-dataset" className="text-adsk-link">Data health</Link>.</>}</EmptyState>
        : rows.length === 0 ? <EmptyState title="No companies match." /> : (
          <ul className="divide-y divide-adsk-offwhite">
            {rows.map((row, index) => (
              <li key={`${row.id ?? "missing"}-${index}`} className="py-2.5 text-xs">
                <div className="font-medium text-adsk-black">
                  {row.id ? <Link href={`/companies/${encodeURIComponent(row.id)}`} className="hover:text-adsk-link hover:underline">{row.name ?? row.id}</Link>
                    : row.name ?? "(unnamed)"}
                </div>
                <div className="text-[11px] text-adsk-gray">{[row.trade, row.city, row.country, row.status].filter(Boolean).join(" · ") || "No additional details"}</div>
                {row.id && <div className="font-mono text-[10px] text-adsk-gray">{row.id}</div>}
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function WatchButton({ owner, kind, targetId, label }: { owner: string | null; kind: "project" | "person"; targetId: string; label: string }) {
  return <DemoWatchButton owner={owner} kind={kind} targetId={targetId} label={label} />;
}

function Pager({ query, kind, page, total }: { query: string; kind: SearchKind; page: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Search pages" className="flex items-center justify-between text-xs text-adsk-gray">
      <span>Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
      <div className="flex gap-2">
        {page > 1 && <Link href={link(query, kind, page - 1)} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5">Previous</Link>}
        {page < pages && <Link href={link(query, kind, page + 1)} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5">Next</Link>}
      </div>
    </nav>
  );
}
