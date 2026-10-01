import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { projectActivity } from "@/lib/queries";
import { cachedProjects } from "@/lib/aps/admin";
import { Card, EmptyState, Pill, formatDate, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { ActionForm } from "@/components/ActionForm";
import { refreshProjects } from "../actions";
import { serviceLabel } from "@/lib/activityPresentation";
import { PROJECT_SORTS, projectSort, sortProjectInventory } from "@/lib/projectInventory";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const params = await searchParams;
  const sort = projectSort(params.sort);
  const rows = sortProjectInventory(projectActivity({}), sort);

  const synced = cachedProjects();
  const totalEvents = rows.reduce((sum, row) => sum + row.events, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Projects</h1>
          <p className="mt-0.5 text-xs text-adsk-gray">
            {synced.length.toLocaleString()} projects from the Hub Admin API, joined with{" "}
            {totalEvents.toLocaleString()} ingested activity events.
          </p>
        </div>
        {session.hubRole === "hub_admin" &&
          <ActionForm action={refreshProjects} label="Sync projects" pendingLabel="Syncing…" />}
      </div>

      {synced.length === 0 ? (
        <Card>
          <EmptyState title="No projects synced yet.">
            <p>
              A Hub Admin can sync the project list from{" "}
              <code>GET /construction/admin/v1/accounts/:hub/projects</code>. This needs the{" "}
              <code>account:read</code> scope and hub admin rights.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <Card
          title="Project inventory"
          action={
            <form action="/projects" method="get" className="flex max-w-full flex-wrap items-center gap-2 text-xs">
              <label htmlFor="project-sort" className="text-adsk-gray">Sort projects</label>
              <select id="project-sort" name="sort" defaultValue={sort}
                className="max-w-full rounded border border-adsk-lightgray bg-adsk-white px-2 py-1.5 text-adsk-black">
              {PROJECT_SORTS.map((option) => (
                <option
                  key={option.key}
                  value={option.key}
                >
                  {option.label}
                </option>
              ))}
              </select>
              <button type="submit" className="rounded border border-adsk-lightgray px-2 py-1.5 hover:bg-adsk-offwhite">Apply</button>
            </form>
          }
          className="overflow-hidden"
        >
          <p className="mb-3 max-w-4xl text-xs leading-relaxed text-adsk-gray">
            <strong className="text-adsk-black">Project members</strong> counts assigned memberships in the synced administration data.
            {" "}<strong className="text-adsk-black">Active people (observed)</strong> counts distinct activity identities in the ingested window, including unresolved identities.
            {" "}No observed activity means no events in that window; it does not establish that a project is inactive. Unknown values appear last when sorting counts or dates.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
                <tr className="border-b border-adsk-lightgray">
                  <th className="py-2 pr-3 font-medium">Project</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Events</th>
                  <th className="py-2 pr-3 text-right font-medium">Active people (observed)</th>
                  <th className="py-2 pr-3 font-medium">Last observed activity</th>
                  <th className="py-2 pr-3 font-medium">Observed services</th>
                  <th className="py-2 pr-3 text-right font-medium">Project members</th>
                  <th className="py-2 pr-3 text-right font-medium">Sheets</th>
                  <th className="py-2 pr-3 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((row) => (
                  <tr key={row.projectId} className="border-b border-adsk-offwhite hover:bg-adsk-offwhite">
                    <td className="max-w-[22rem] py-2 pr-3">
                      <Link
                        href={`/projects/${encodeURIComponent(row.projectId)}`}
                        className="block truncate text-adsk-black hover:text-adsk-link"
                        title={row.name}
                      >
                        {row.name}
                      </Link>
                      <span className="font-mono text-[10px] text-adsk-lightgray">{row.projectId}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {row.status ? (
                        <Pill tone={row.status === "active" ? "good" : "default"}>
                          {row.status}
                        </Pill>
                      ) : (
                        <span className="text-adsk-lightgray">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {row.events > 0 ? (
                        row.events.toLocaleString()
                      ) : (
                        <span className="text-adsk-lightgray">0</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right text-adsk-black">
                      {row.actors.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-adsk-black">{formatDateTime(row.lastEventMs)}</td>
                    <td className="max-w-[14rem] truncate py-2 pr-3 text-adsk-gray" title={row.services ?? ""}>
                      {row.services ? row.services.split(",").map(serviceLabel).join(", ") : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right text-adsk-black">
                      {row.memberCount ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right text-adsk-black">{row.sheetCount ?? "—"}</td>
                    <td className="py-2 pr-3 text-adsk-gray">{formatDate(row.lastSignIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
