import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { adminOperation, adminOperationItemCount, adminOperationItems } from "@/lib/adminOperations";
import { Card, EmptyState, Pill, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 200;

export default async function AdminAuditDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  if (session.hubRole !== "hub_admin") {
    return <Card><EmptyState title="Hub Admin access is required to view the administrative audit." /></Card>;
  }
  const { id } = await params;
  const query = await searchParams;
  const operation = adminOperation(id);
  if (!operation) return <Card><EmptyState title="Operation not found." /></Card>;
  const count = adminOperationItemCount(id);
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const requested = Number(typeof query.page === "string" ? query.page : "1");
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1));
  const items = adminOperationItems(id, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Operation record</h1>
          <p className="mt-0.5 font-mono text-[10px] text-adsk-gray">{id}</p>
        </div>
        <div className="flex gap-3 text-xs">
          <a href={`/manage/audit/${id}/export`} className="text-adsk-link hover:underline">Export CSV</a>
          <Link href="/manage/audit" className="text-adsk-link hover:underline">← Audit</Link>
        </div>
      </div>
      <Card title={operation.kind.replaceAll("_", " ")}>
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><span className="text-adsk-gray">Actor</span><div>{operation.actorEmail ?? "Unknown"}</div></div>
          <div><span className="text-adsk-gray">Started</span><div>{formatDateTime(operation.startedAt)}</div></div>
          <div><span className="text-adsk-gray">Finished</span><div>{formatDateTime(operation.finishedAt)}</div></div>
          <div><span className="text-adsk-gray">Status</span><div><Pill tone={operation.status === "complete" ? "good" : "warn"}>{operation.status}</Pill></div></div>
        </div>
        <p className="mt-3 text-xs text-adsk-gray">{operation.summary}</p>
        <p className="mt-2 text-xs text-adsk-black">
          {operation.planned} planned · {operation.succeeded} succeeded · {operation.submitted} submitted · {operation.skipped} skipped · {operation.failed} failed
        </p>
      </Card>
      <Card title="Item outcomes" subtitle={`Page ${page} of ${totalPages}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
              <tr className="border-b border-adsk-lightgray">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.index} className="border-b border-adsk-offwhite align-top">
                  <td className="py-2 pr-3">{item.label}<span className="mt-0.5 block font-mono text-[10px] text-adsk-gray">{item.key}</span></td>
                  <td className="py-2 pr-3"><Pill tone={item.status === "failed" ? "bad" : item.status === "succeeded" ? "good" : "default"}>{item.status}</Pill></td>
                  <td className="py-2 text-adsk-gray">{item.detail ?? "Awaiting result"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="mt-3 flex gap-3 text-xs">
            {page > 1 && <Link href={`/manage/audit/${id}?page=${page - 1}`} className="text-adsk-link hover:underline">← Previous</Link>}
            {page < totalPages && <Link href={`/manage/audit/${id}?page=${page + 1}`} className="text-adsk-link hover:underline">Next →</Link>}
          </div>
        )}
      </Card>
    </div>
  );
}
