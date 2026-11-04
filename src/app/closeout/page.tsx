import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { listCloseoutProfiles, listRecentCloseoutPackages } from "@/lib/closeoutStore";
import { closeoutPortfolioStatus } from "@/lib/closeoutPortfolio";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";
const date = (value: number) => new Date(value).toLocaleString();

export default async function CloseoutPage() {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const profiles = listCloseoutProfiles();
  const profileNames = new Map(profiles.map((item) => [item.id, item.name]));
  const packages = listRecentCloseoutPackages(10);
  const portfolio = closeoutPortfolioStatus();
  const rows = portfolio.rows.slice(0, 500);
  const counts = portfolio.counts;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-legend text-2xl text-adsk-black">Closeout readiness</h1>
        <p className="mt-1 max-w-3xl text-sm text-adsk-gray">Explore a sample turnover standard and the fictional records behind closeout exceptions. Profiles and selected document metadata are read-only; no real package is assembled.</p></div>
      <Link className="rounded bg-adsk-black px-4 py-2 text-sm text-white" href="/closeout/profiles">Turnover profiles</Link>
    </header>
    <div className="grid gap-3 sm:grid-cols-4">
      {[ ["Assigned", counts.assigned], ["Current saved ready", counts.ready], ["Current saved blocked", counts.blockers], ["Unknown or stale", counts.unknown] ].map(([label, value]) =>
        <div key={label} className="rounded border border-adsk-lightgray bg-white p-4"><p className="text-xs text-adsk-gray">{label}</p><p className="font-legend text-2xl">{value}</p></div>)}
    </div>
    <Card title="Projects and last assessment">
      {portfolio.totalProjects === 0 ? <p className="text-sm text-adsk-gray">No synced projects. A Hub Admin can sync projects on Overview, then return here.</p> :
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-adsk-lightgray"><th className="py-2">Project</th><th>Profile</th><th>Last assessment</th><th>As of</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>
        {rows.map(({ project, assignment, latest, stale }) => <tr key={project.id} className="border-b border-adsk-lightgray/70">
          <td className="py-2"><span className="font-medium">{project.name}</span><span className="block text-xs text-adsk-gray">{project.id}</span></td>
          <td>{assignment ? profileNames.get(assignment.profileId) ?? "Missing profile" : "Unassigned"}</td>
          <td>{stale ? `Stale ${latest?.status ?? "assessment"} · reassess` : latest?.status ?? "Not assessed"}</td><td>{latest ? date(latest.createdAt) : "—"}</td>
          <td><Link className="text-adsk-link hover:underline" href={`/closeout/${encodeURIComponent(project.id)}`}>Review →</Link></td>
        </tr>)}</tbody></table></div>}
      {portfolio.totalProjects > rows.length && <p className="mt-3 text-xs text-adsk-gray">Showing the first 500 of {portfolio.totalProjects} projects. Open a project through its exact ID URL to review the rest.</p>}
    </Card>
    <Card title="Recent packages">
      {packages.length === 0 ? <p className="text-sm text-adsk-gray">Package generation is disabled in the demo. Explore the sample record set on a project instead.</p> :
      <ul className="space-y-2 text-sm">{packages.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 border-b border-adsk-lightgray/70 pb-2">
        <Link className="text-adsk-link hover:underline" href={`/closeout/packages/${item.id}`}>{item.projectId} · {item.status}</Link><time>{date(item.createdAt)}</time>
      </li>)}</ul>}
    </Card>
  </div>;
}
