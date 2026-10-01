import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { cachedProjects } from "@/lib/aps/admin";
import { configProblems } from "@/lib/env";
import {
  listAccessMatrix,
  listPeople,
  peopleSourceStatus,
  PEOPLE_PAGE_SIZE,
  type MatrixRow,
  type PeopleSourceStatus,
  type PersonRow,
} from "@/lib/people";
import { Card, EmptyState, Pill, formatDate, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { savedViewsOwner } from "@/lib/savedViews";
import { resolveCompanyNames } from "@/lib/entityProfiles";
import { fetchCompanies } from "@/lib/aps/hubAdmin";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

function value(params: Params, key: string): string {
  const item = params[key];
  return typeof item === "string" ? item.trim() : "";
}

function pageNumber(params: Params): number {
  const page = Number(value(params, "page"));
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function href(view: "directory" | "matrix", params: Record<string, string>, page: number): string {
  const query = new URLSearchParams({ view });
  for (const [key, item] of Object.entries(params)) if (item) query.set(key, item);
  if (page > 1) query.set("page", String(page));
  return `/people?${query.toString()}`;
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Params> }) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;

  const params = await searchParams;
  const view = value(params, "view") === "matrix" ? "matrix" : "directory";
  const search = value(params, "q").slice(0, 120);
  const project = value(params, "project").slice(0, 120);
  const status = value(params, "status").slice(0, 40);
  const page = pageNumber(params);
  const sources = peopleSourceStatus();
  const result = view === "matrix"
    ? listAccessMatrix({ search, project, status, page })
    : listPeople(search, page);
  const filters: Record<string, string> = view === "matrix"
    ? { q: search, project, status }
    : { q: search };
  const companyNames = new Map<string, { name: string; source: "snapshot" | "live" }>();
  if (view === "directory") {
    const companyIds = new Set((result.rows as PersonRow[]).map((row) => row.companyId).filter((id): id is string => Boolean(id)));
    for (const [id, name] of resolveCompanyNames([...companyIds])) companyNames.set(id, { name, source: "snapshot" });
    if ([...companyIds].some((id) => !companyNames.has(id))) {
      try {
        const live = await fetchCompanies(session);
        // Refuse an arbitrary name when a live response contains a duplicate ID, too.
        const counts = new Map<string, number>();
        for (const company of live) counts.set(company.id, (counts.get(company.id) ?? 0) + 1);
        for (const company of live) {
          if (companyIds.has(company.id) && counts.get(company.id) === 1 && company.name && !companyNames.has(company.id)) {
            companyNames.set(company.id, { name: company.name, source: "live" });
          }
        }
      } catch {
        // Keep the company profile accessible even if this account cannot resolve the live label.
      }
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-legend text-2xl text-adsk-black">People and access</h1>
          <p className="mt-1 max-w-3xl text-sm text-adsk-gray">
            Explore the user directory and project access in the uploaded Data Connector CSV extract.
            This is a local snapshot; it does not verify anyone&apos;s current access in Forma.
          </p>
        </div>
        {savedViewsOwner(session) && (
          <Link href={`/views?save=${encodeURIComponent(href(view, filters, 1))}`} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-xs text-adsk-black">
            Save view
          </Link>
        )}
      </div>

      <SourcePanel status={sources} />

      <nav aria-label="People views" className="flex flex-wrap gap-2">
        {([
          ["directory", "Directory"],
          ["matrix", "Access matrix"],
        ] as const).map(([key, label]) => (
          <Link
            key={key}
            href={href(key, {}, 1)}
            aria-current={view === key ? "page" : undefined}
            className={`rounded border px-3 py-1.5 font-legend text-xs ${
              view === key
                ? "border-adsk-gold bg-adsk-gold/10 text-adsk-black"
                : "border-adsk-lightgray bg-adsk-white text-adsk-gray hover:text-adsk-black"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {view === "directory" ? (
        <DirectoryPanel
          rows={result.rows as PersonRow[]}
          total={result.total}
          page={result.page}
          search={search}
          ready={sources.directoryReady}
          companyNames={companyNames}
        />
      ) : (
        <MatrixPanel
          rows={result.rows as MatrixRow[]}
          total={result.total}
          page={result.page}
          search={search}
          project={project}
          status={status}
          ready={sources.matrixReady}
          productsReady={sources.productsReady}
          syncedProjectIds={new Set(cachedProjects().map((item) => item.id.toLowerCase()))}
        />
      )}
      <Pager view={view} filters={filters} page={result.page} total={result.total} />
    </div>
  );
}

function SourcePanel({ status }: { status: PeopleSourceStatus }) {
  return (
    <Card title="Snapshot sources" subtitle="Times below are local import times, not extraction or last-change times.">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {status.sources.map((source) => (
          <div key={source.name} className="rounded border border-adsk-lightgray px-3 py-2 text-xs">
            <div className="font-mono text-[11px] text-adsk-black">{source.name}.csv</div>
            <div className="mt-1 text-adsk-gray">
              {source.rows.toLocaleString()} rows · imported {formatDateTime(source.uploadedAt)}
            </div>
            {source.truncated && <Pill tone="warn">Truncated</Pill>}
            {source.missingColumns.length > 0 && <Pill tone="warn">Missing join columns</Pill>}
          </div>
        ))}
      </div>
      {status.warnings.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs text-adsk-black">
          {status.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
        </ul>
      )}
      <p className="mt-3 text-xs text-adsk-gray">
        Uploading another ZIP replaces only the tables it contains. These files may come from different
        extracts even when their import times are close.
      </p>
    </Card>
  );
}

function DirectoryPanel({ rows, total, page, search, ready, companyNames }: {
  rows: PersonRow[]; total: number; page: number; search: string; ready: boolean;
  companyNames: Map<string, { name: string; source: "snapshot" | "live" }>;
}) {
  return (
    <Card title="User directory" subtitle={`${total.toLocaleString()} source records`}>
      <form method="get" action="/people" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value="directory" />
        <label className="text-xs text-adsk-gray">
          Search name, email or ID
          <input
            name="q"
            defaultValue={search}
            maxLength={120}
            className="mt-1 block w-72 max-w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-sm text-adsk-black"
          />
        </label>
        <button type="submit" className="rounded border border-adsk-gold bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black">Search</button>
        {search && <Link href="/people" className="px-2 py-1.5 text-xs text-adsk-link">Clear</Link>}
      </form>
      <p className="mb-3 text-xs text-adsk-gray">Company associations come from the user snapshot. Names use the uploaded company directory when available; live fallback names are labeled below.</p>
      {!ready ? (
        <EmptyState title="No user directory is available.">
          Upload an Insight Data Connector ZIP containing <code>admin_users.csv</code> in <Link href="/data-health#reporting-dataset" className="text-adsk-link">Data health</Link>.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title={page > 1 ? "No records on this page." : "No people match this search."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
              <tr className="border-b border-adsk-lightgray">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 pr-3 font-medium">Autodesk ID</th>
                <th className="py-2 pr-3 font-medium">Company</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 text-right font-medium">Project memberships</th>
                <th className="py-2 pr-3 font-medium">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.id ?? "missing"}-${index}`} className="border-b border-adsk-offwhite">
                  <td className="max-w-[22rem] py-2 pr-3">
                    {row.id && !row.duplicateId ? (
                      <Link href={`/people/${encodeURIComponent(row.id)}`} className="font-medium text-adsk-black hover:text-adsk-link">
                        {row.name ?? row.email ?? row.id}
                      </Link>
                    ) : <span className="font-medium text-adsk-black">{row.name ?? row.email ?? "(unnamed)"}</span>}
                    <div className="truncate text-[11px] text-adsk-gray">{row.email ?? "No email"}</div>
                    {row.duplicateId && <Pill tone="warn">Duplicate source ID</Pill>}
                    {!row.id && <Pill tone="warn">No source ID</Pill>}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-adsk-gray">{row.autodeskId ?? "—"}</td>
                  <td className="max-w-64 py-2 pr-3">
                    {row.companyId ? (
                      <>
                        <Link href={`/companies/${encodeURIComponent(row.companyId)}`} title={`${companyNames.get(row.companyId)?.source ?? "Unresolved"}: ${row.companyId}`}
                          className="text-adsk-link hover:underline">
                          {companyNames.get(row.companyId)?.name ?? "Unknown company"}
                        </Link>
                        {companyNames.get(row.companyId)?.source === "live" && <span className="block text-[10px] text-adsk-gray">Live company name</span>}
                        {!companyNames.get(row.companyId) && <div className="break-all font-mono text-[10px] text-adsk-gray">{row.companyId}</div>}
                      </>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-3">{row.status ?? "—"}</td>
                  <td className="py-2 pr-3 text-right">{row.memberships?.toLocaleString() ?? "—"}</td>
                  <td className="py-2 pr-3 text-adsk-gray">{formatDate(row.lastSignIn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MatrixPanel({ rows, total, page, search, project, status, ready, productsReady, syncedProjectIds }: {
  rows: MatrixRow[]; total: number; page: number; search: string; project: string;
  status: string; ready: boolean; productsReady: boolean; syncedProjectIds: Set<string>;
}) {
  const unresolved = rows.filter((row) => row.identity !== "matched").length;
  return (
    <Card title="Project access matrix" subtitle={`${total.toLocaleString()} membership records in the uploaded extract`}>
      <form method="get" action="/people" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value="matrix" />
        <label className="text-xs text-adsk-gray">
          Person, email or user ID
          <input name="q" defaultValue={search} maxLength={120} className="mt-1 block w-60 rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-sm text-adsk-black" />
        </label>
        <label className="text-xs text-adsk-gray">
          Project name or ID
          <input name="project" defaultValue={project} maxLength={120} className="mt-1 block w-60 rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-sm text-adsk-black" />
        </label>
        <label className="text-xs text-adsk-gray">
          Membership status
          <input name="status" defaultValue={status} maxLength={40} placeholder="e.g. active" className="mt-1 block w-32 rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-sm text-adsk-black" />
        </label>
        <button type="submit" className="rounded border border-adsk-gold bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black">Filter</button>
        {(search || project || status) && <Link href="/people?view=matrix" className="px-2 py-1.5 text-xs text-adsk-link">Clear</Link>}
      </form>
      <p className="mb-3 text-xs text-adsk-gray">
        Membership and product access come from CSV rows. Role names in <code>admin_project_roles.csv</code>
        do not establish which role a user holds, so roles are not inferred here.
      </p>
      {!productsReady && ready && <p role="alert" className="mb-3 rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs">Product access is unavailable until <code>admin_project_user_products.csv</code> with its join columns is uploaded.</p>}
      {unresolved > 0 && <p role="alert" className="mb-3 rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs">{unresolved} membership record{unresolved === 1 ? "" : "s"} on this page could not be matched to exactly one user by source ID.</p>}
      {!ready ? (
        <EmptyState title="No access matrix is available.">
          Upload an Insight Data Connector ZIP containing <code>admin_project_users.csv</code> with user and project IDs in <Link href="/data-health#reporting-dataset" className="text-adsk-link">Data health</Link>.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title={page > 1 ? "No records on this page." : "No memberships match these filters."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
              <tr className="border-b border-adsk-lightgray">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 pr-3 font-medium">Project</th>
                <th className="py-2 pr-3 font-medium">Membership</th>
                <th className="py-2 pr-3 font-medium">Access level</th>
                <th className="py-2 pr-3 font-medium">Products</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowId} className="border-b border-adsk-offwhite align-top">
                  <td className="max-w-[20rem] py-2 pr-3">
                    {row.identity === "matched" && row.userId ? (
                      <Link href={`/people/${encodeURIComponent(row.userId)}`} className="font-medium text-adsk-black hover:text-adsk-link">
                        {row.userName ?? row.email ?? row.userId}
                      </Link>
                    ) : <span className="font-mono text-[11px] text-adsk-black">{row.userId ?? "(no user ID)"}</span>}
                    {row.email && <div className="truncate text-[11px] text-adsk-gray">{row.email}</div>}
                    {row.identity !== "matched" && <div><Pill tone="warn">{row.identity === "ambiguous" ? "Duplicate ID" : "Unmatched ID"}</Pill></div>}
                  </td>
                  <td className="max-w-[20rem] py-2 pr-3">
                    <div className="font-medium text-adsk-black">{row.projectId && syncedProjectIds.has(row.projectId.toLowerCase()) ? <Link href={`/projects/${encodeURIComponent(row.projectId)}`} className="text-adsk-link hover:underline">{row.projectName ?? row.projectId}</Link> : row.projectName ?? row.projectId ?? "(no project ID)"}</div>
                    {row.projectName && <div className="truncate font-mono text-[10px] text-adsk-gray">{row.projectId}</div>}
                    {row.projectId && !syncedProjectIds.has(row.projectId.toLowerCase()) && <div className="text-[10px] text-adsk-gray">Not in synced project inventory</div>}
                  </td>
                  <td className="py-2 pr-3">{row.membershipStatus ?? "—"}</td>
                  <td className="py-2 pr-3">{row.accessLevel ?? "—"}</td>
                  <td className="max-w-[18rem] py-2 pr-3">
                    {row.products === null ? "Unavailable" : row.products.length === 0 ? "None recorded" : (
                      <ul className="space-y-0.5">
                        {row.products.map((product) => <li key={`${product.key}-${product.access ?? ""}`}>{product.key}{product.access ? ` (${product.access})` : ""}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Pager({ view, filters, page, total }: {
  view: "directory" | "matrix"; filters: Record<string, string>; page: number; total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Results pages" className="flex items-center justify-between text-xs text-adsk-gray">
      <span>Page {page.toLocaleString()} of {pages.toLocaleString()} · {total.toLocaleString()} records</span>
      <div className="flex gap-2">
        {page > 1 && <Link href={href(view, filters, page - 1)} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-adsk-black">Previous</Link>}
        {page < pages && <Link href={href(view, filters, page + 1)} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-adsk-black">Next</Link>}
      </div>
    </nav>
  );
}
