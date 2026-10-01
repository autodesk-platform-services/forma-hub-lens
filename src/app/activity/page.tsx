import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { cachedProjects } from "@/lib/aps/admin";
import { parseFilters, filtersToQuery } from "@/lib/filters";
import {
  countByDay,
  distinctValues,
  listActivities,
  topActions,
  topActors,
  topProjects,
  topServices,
} from "@/lib/queries";
import { BarList, Card, DailyChart, EmptyState, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { actionLabel, actorDisplay, serviceLabel } from "@/lib/activityPresentation";
import { CheckboxList } from "@/components/CheckboxList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const labelClass = "block text-[11px] font-medium uppercase tracking-wide text-adsk-gray";
const inputClass =
  "mt-1 w-full rounded border border-adsk-lightgray bg-adsk-offwhite px-2.5 py-1.5 text-xs text-adsk-black focus:border-adsk-yellow focus:outline-none";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const params = await searchParams;
  const filters = parseFilters(params);
  const requestedPage = Math.max(1, Number(params.page) || 1);

  // Count first so a page number past the end lands on the last page of results
  // rather than an empty table.
  const { total } = listActivities(filters, { limit: 0, offset: 0 });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const { rows } = listActivities(filters, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const projects = cachedProjects();
  const services = distinctValues("service");
  const actions = distinctValues("action");
  const exportQuery = filtersToQuery(filters).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Activity explorer</h1>
          <p className="mt-0.5 text-xs text-adsk-gray">
            {total.toLocaleString()} matching event{total === 1 ? "" : "s"} across the hub
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/views?save=${encodeURIComponent(`/activity${exportQuery ? `?${exportQuery}` : ""}`)}`}
            className="rounded border border-adsk-lightgray px-3 py-1.5 text-xs font-medium text-adsk-black hover:border-adsk-gray hover:text-adsk-black"
          >
            Save view
          </Link>
          <a
            href={`/api/activity/export${exportQuery ? `?${exportQuery}` : ""}`}
            className="rounded border border-adsk-lightgray px-3 py-1.5 text-xs font-medium text-adsk-black hover:border-adsk-gray hover:text-adsk-black"
          >
            Export CSV
          </a>
        </div>
      </div>

      <Card title="Filters">
        <form method="get" className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div>
              <label className={labelClass} htmlFor="from">
                From
              </label>
              <input
                id="from"
                name="from"
                type="date"
                className={inputClass}
                defaultValue={filters.from ?? ""}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="to">
                To
              </label>
              <input
                id="to"
                name="to"
                type="date"
                className={inputClass}
                defaultValue={filters.to ?? ""}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="service">
                Service
              </label>
              <select id="service" name="service" className={inputClass} defaultValue={filters.services?.[0] ?? ""}>
                <option value="">All services</option>
                {services.map((service) => (
                  <option key={service} value={service}>
                    {serviceLabel(service)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="action">
                Action
              </label>
              <select id="action" name="action" className={inputClass} defaultValue={filters.actions?.[0] ?? ""}>
                <option value="">All actions</option>
                {actions.map((action) => (
                  <option key={action} value={action}>
                    {actionLabel(action)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="actor">
                Person
              </label>
              <input
                id="actor"
                name="actor"
                className={inputClass}
                placeholder="name or email"
                defaultValue={filters.actor ?? ""}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="q">
                Contains
              </label>
              <input
                id="q"
                name="q"
                className={inputClass}
                placeholder="file, action, any field"
                defaultValue={filters.search ?? ""}
              />
            </div>
          </div>

          <CheckboxList label="Projects" name="project" className="max-h-36"
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
            defaultSelected={filters.projectIds ?? []} />

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black hover:opacity-90"
            >
              Apply
            </button>
            <Link href="/activity" className="text-xs text-adsk-gray hover:text-adsk-black">
              Reset
            </Link>
          </div>
        </form>
      </Card>

      {total === 0 ? (
        <Card>
          <EmptyState title="No events match these filters.">
            <p>
              If the cache is empty, submit an extract from the{" "}
              <Link href="/extracts" className="text-adsk-link hover:underline">
                Extracts
              </Link>{" "}
              page first.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Events per day">
            <DailyChart data={countByDay(filters)} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <Card title="Projects">
              <BarList items={topProjects(filters, 8)} />
            </Card>
            <Card title="People">
              <BarList items={topActors(filters, 8)} />
            </Card>
            <Card title="Services">
              <BarList items={topServices(filters, 8)} />
            </Card>
            <Card title="Actions">
              <BarList items={topActions(filters, 8)} />
            </Card>
          </div>

          <Card
            title="Events"
            subtitle={`Page ${page} of ${totalPages.toLocaleString()}`}
            action={<Pagination page={page} totalPages={totalPages} params={params} />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
                  <tr className="border-b border-adsk-lightgray">
                    <th className="py-2 pr-3 font-medium">When (UTC)</th>
                    <th className="py-2 pr-3 font-medium">Project</th>
                    <th className="py-2 pr-3 font-medium">Person</th>
                    <th className="py-2 pr-3 font-medium">Service</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 pr-3 font-medium">Target</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="tnum">
                  {rows.map((row) => {
                    const actor = actorDisplay(row.actorName, row.actorEmail, row.actorId, row.actorResolvedName);
                    return (
                    <tr key={row.id} className="border-b border-adsk-offwhite align-top hover:bg-adsk-offwhite">
                      <td className="whitespace-nowrap py-2 pr-3 text-adsk-black">
                        {formatDateTime(row.occurredMs)}
                      </td>
                      <td className="max-w-[16rem] truncate py-2 pr-3" title={row.projectName}>
                        {row.projectId ? <Link href={`/projects/${encodeURIComponent(row.projectId)}`}
                          className="text-adsk-link hover:underline">{row.projectName}</Link> : row.projectName}
                      </td>
                      <td className="max-w-[14rem] py-2 pr-3">
                        <span className="block truncate text-adsk-black">
                          {row.actorResolvedId ? <Link href={`/people/${encodeURIComponent(row.actorResolvedId)}`}
                            className="text-adsk-link hover:underline">{actor.label}</Link> : actor.label}
                        </span>
                        {actor.detail && <span className="block truncate text-[10px] text-adsk-gray" title={actor.detail}>{actor.detail}</span>}
                      </td>
                      <td className="py-2 pr-3 text-adsk-gray" title={row.service ?? undefined}>{serviceLabel(row.service)}</td>
                      <td className="py-2 pr-3 text-adsk-black" title={row.action ?? undefined}>{actionLabel(row.action)}</td>
                      <td className="max-w-[20rem] py-2 pr-3">
                        <span className="block truncate text-adsk-black" title={row.targetName ?? ""}>
                          {row.targetName ?? "—"}
                        </span>
                        {row.targetType && (
                          <span className="block text-[10px] text-adsk-lightgray">{row.targetType}</span>
                        )}
                      </td>
                      <td className="py-2">
                        <details className="group">
                          <summary className="cursor-pointer list-none text-[10px] text-adsk-lightgray hover:text-adsk-link">
                            raw
                          </summary>
                          <pre className="mt-1 max-w-[36rem] overflow-x-auto rounded bg-adsk-offwhite p-2 text-[10px] leading-relaxed text-adsk-black">
                            {JSON.stringify(row.raw, null, 2)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  params,
}: {
  page: number;
  totalPages: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const link = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "page" || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value]) query.append(key, entry);
    }
    query.set("page", String(target));
    return `/activity?${query.toString()}`;
  };

  const linkClass =
    "rounded border border-adsk-lightgray px-2 py-1 text-[11px] text-adsk-black hover:border-adsk-gray hover:text-adsk-black";
  const disabledClass = "rounded border border-adsk-lightgray px-2 py-1 text-[11px] text-adsk-lightgray";

  return (
    <div className="flex items-center gap-1.5">
      {page > 1 ? (
        <Link href={link(page - 1)} className={linkClass}>
          ← Prev
        </Link>
      ) : (
        <span className={disabledClass}>← Prev</span>
      )}
      {page < totalPages ? (
        <Link href={link(page + 1)} className={linkClass}>
          Next →
        </Link>
      ) : (
        <span className={disabledClass}>Next →</span>
      )}
    </div>
  );
}
