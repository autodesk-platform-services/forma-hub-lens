import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { recentAdminOperations } from "@/lib/adminOperations";
import { Card, EmptyState, Pill, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";

export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  add_members: "Add members",
  remove_members: "Remove members",
  create_projects: "Create projects",
  archive_projects: "Archive projects",
  create_company: "Create company",
  update_company: "Update company",
};

export default async function AdminAuditPage() {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  if (session.mode === "demo") return <div className="space-y-5">
    <div>
      <h1 className="text-lg font-semibold">Demo action history</h1>
      <p className="mt-0.5 text-xs text-adsk-gray">Synthetic previews and outcomes in this browser session.</p>
    </div>
    <Card title="Simulated actions only">
      <p className="text-sm text-adsk-gray">This public demo does not display the administrative audit of a live hub. Open the Demo action center to view the actions you have simulated in this browser session.</p>
      <Link href="/manage#simulation-history" className="mt-3 inline-block text-xs text-adsk-link hover:underline">Open simulated action history →</Link>
    </Card>
  </div>;
  if (session.hubRole !== "hub_admin") {
    return <Card><EmptyState title="Hub Admin access is required to view the administrative audit." /></Card>;
  }
  const operations = recentAdminOperations(100);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Administrative audit</h1>
          <p className="mt-0.5 text-xs text-adsk-gray">Actions initiated in Forma Hub Lens, including submitted imports and individual outcomes.</p>
        </div>
        <Link href="/manage" className="text-xs text-adsk-link hover:underline">← Manage</Link>
      </div>
      <Card title="Recent operations" subtitle="Newest 100">
        {operations.length === 0 ? (
          <EmptyState title="No Lens administrative actions recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
                <tr className="border-b border-adsk-lightgray">
                  <th className="py-2 pr-3 font-medium">When (UTC)</th>
                  <th className="py-2 pr-3 font-medium">Actor</th>
                  <th className="py-2 pr-3 font-medium">Operation</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Planned</th>
                  <th className="py-2 pr-3 text-right font-medium">Succeeded</th>
                  <th className="py-2 pr-3 text-right font-medium">Submitted</th>
                  <th className="py-2 pr-3 text-right font-medium">Skipped</th>
                  <th className="py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((operation) => (
                  <tr key={operation.id} className="border-b border-adsk-offwhite hover:bg-adsk-offwhite">
                    <td className="whitespace-nowrap py-2 pr-3">{formatDateTime(operation.startedAt)}</td>
                    <td className="py-2 pr-3">{operation.actorEmail ?? "Unknown"}</td>
                    <td className="py-2 pr-3"><Link href={`/manage/audit/${operation.id}`} className="text-adsk-link hover:underline">{labels[operation.kind] ?? operation.kind}</Link></td>
                    <td className="py-2 pr-3"><Pill tone={operation.status === "complete" ? "good" : operation.status === "partial" ? "warn" : "default"}>{operation.status}</Pill></td>
                    <td className="py-2 pr-3 text-right">{operation.planned}</td>
                    <td className="py-2 pr-3 text-right">{operation.succeeded}</td>
                    <td className="py-2 pr-3 text-right">{operation.submitted}</td>
                    <td className="py-2 pr-3 text-right">{operation.skipped}</td>
                    <td className="py-2 text-right">{operation.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-adsk-gray">
        This ledger covers actions sent by Lens. Autodesk may process import jobs asynchronously; “submitted” does not confirm final membership.
      </p>
    </div>
  );
}
