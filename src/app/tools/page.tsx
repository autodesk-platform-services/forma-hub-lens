import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems, env } from "@/lib/env";
import { TOOL_SPECS } from "@/lib/dashboards/specs";
import { toolStatus } from "@/lib/dashboards/engine";
import { listTables, recentUploads } from "@/lib/dataset";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { ToolsExplorer, type ToolCard } from "@/components/ToolsExplorer";
import { savedViewsOwner } from "@/lib/savedViews";
import { toolFavoritesKey } from "@/lib/toolFavorites";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const demoMode = env.demoMode;
  const tables = listTables();
  const truncatedTables = tables.filter((table) => table.truncated);
  const datasetRows = tables.reduce((sum, table) => sum + table.rowCount, 0);
  const latestUpload = recentUploads(1)[0];

  const tools: ToolCard[] = TOOL_SPECS.map((spec) => {
    const status = toolStatus(spec);
    return {
      id: spec.id,
      name: spec.name,
      blurb: spec.blurb,
      template: spec.template,
      enabled: status.enabled,
      missing: status.missing,
      rowCount: status.rowCount,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-legend text-2xl text-adsk-black">Forma tools</h1>
        <p className="mt-1 max-w-3xl text-sm text-adsk-gray">
          {demoMode
            ? "Explore sample dashboards for Forma tools. Every chart here uses synthetic hub records."
            : "One dashboard per Forma tool, laid out to match the Autodesk Power BI template for that tool. Select a tool to open its dashboard."}
        </p>
      </div>

      <section className="rounded border border-adsk-lightgray bg-adsk-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-legend text-sm text-adsk-black">Reporting source</h2>
            <p className="mt-1 text-xs text-adsk-gray">{demoMode
              ? `${tables.length} synthetic sample tables · ${datasetRows.toLocaleString()} sample rows. No Autodesk extract or user ZIP is used in this demo.`
              : <>{tables.length} loaded CSV tables · {datasetRows.toLocaleString()} rows
                {latestUpload ? ` · last ZIP uploaded ${new Date(latestUpload.uploadedAt).toISOString().slice(0, 10)}` : ""}.
                User-supplied ZIP origin is unverified.</>}</p>
          </div>
          <Link href="/data-health#reporting-dataset" className="text-xs text-adsk-link underline">{demoMode ? "Review sample dataset →" : "Manage dataset in Data →"}</Link>
        </div>
        {truncatedTables.length > 0 && (
          <p role="alert" className="mt-3 rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs text-adsk-black">
            Some {demoMode ? "sample tables" : "source CSVs"} exceeded the 400,000 row import limit and were truncated:
            {" "}{truncatedTables.map((table) => `${table.name}.csv`).join(", ")}.
            Dashboards using these tables may undercount results.
          </p>
        )}
      </section>

      <ToolsExplorer tools={tools} datasetTables={tables.length} datasetRows={datasetRows}
        favoritesKey={toolFavoritesKey(env.hubId, savedViewsOwner(session))} demoMode={demoMode} />
    </div>
  );
}
