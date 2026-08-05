import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { projectActivity } from "@/lib/queries";
import { cachedProjects } from "@/lib/aps/admin";
import { Card, EmptyState, Pill, formatDate, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { ActionForm } from "@/components/ActionForm";
import { refreshProjects } from "../actions";

export const dynamic = "force-dynamic";

type SortKey = "events" | "actors" | "name" | "members" | "recent";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "events", label: "Events" },
  { key: "actors", label: "People" },
  { key: "recent", label: "Last event" },
  { key: "members", label: "Members" },
  { key: "name", label: "Name" },
];

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
  const sort = (typeof params.sort === "string" ? params.sort : "events") as SortKey;

  const rows = projectActivity({});
  sortRows(rows, sort);

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
        <ActionForm action={refreshProjects} label="Sync projects" pendingLabel="Syncing…" />
      </div>

      {synced.length === 0 ? (
        <Card>
          <EmptyState title="No projects synced yet.">
            <p>
              Press <strong>Sync projects</strong> to pull the hub project list from{" "}
              <code>GET /construction/admin/v1/accounts/:hub/projects</code>. This needs the{" "}
              <code>account:read</code> scope and hub admin rights.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <Card
          title="Cross-project rollup"
          action={
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-adsk-gray">Sort</span>
              {SORTS.map((option) => (
                <Link
                  key={option.key}
                  href={`/projects?sort=${option.key}`}
                  className={`rounded px-1.5 py-0.5 ${
                    sort === option.key
                      ? "bg-adsk-lightgray text-adsk-black"
                      : "text-adsk-gray hover:text-adsk-black"
                  }`}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          }
          className="overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
                <tr className="border-b border-adsk-lightgray">
                  <th className="py-2 pr-3 font-medium">Project</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Events</th>
                  <th className="py-2 pr-3 text-right font-medium">People</th>
                  <th className="py-2 pr-3 font-medium">Last event</th>
                  <th className="py-2 pr-3 font-medium">Services</th>
                  <th className="py-2 pr-3 text-right font-medium">Members</th>
                  <th className="py-2 pr-3 text-right font-medium">Sheets</th>
                  <th className="py-2 pr-3 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((row) => (
                  <tr key={row.projectId} className="border-b border-adsk-offwhite hover:bg-adsk-offwhite">
                    <td className="max-w-[22rem] py-2 pr-3">
                      <Link
                        href={`/activity?project=${encodeURIComponent(row.projectId)}`}
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
                      {row.actors > 0 ? row.actors.toLocaleString() : "—"}
                    </td>
                    <td className="py-2 pr-3 text-adsk-black">{formatDateTime(row.lastEventMs)}</td>
                    <td className="max-w-[14rem] truncate py-2 pr-3 text-adsk-gray" title={row.services ?? ""}>
                      {row.services ?? "—"}
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

function sortRows(
  rows: Array<{
    events: number;
    actors: number;
    name: string;
    memberCount: number | null;
    lastEventMs: number | null;
  }>,
  sort: SortKey,
): void {
  switch (sort) {
    case "actors":
      rows.sort((a, b) => b.actors - a.actors || a.name.localeCompare(b.name));
      break;
    case "name":
      rows.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "members":
      rows.sort((a, b) => (b.memberCount ?? -1) - (a.memberCount ?? -1));
      break;
    case "recent":
      rows.sort((a, b) => (b.lastEventMs ?? 0) - (a.lastEventMs ?? 0));
      break;
    default:
      rows.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  }
}
