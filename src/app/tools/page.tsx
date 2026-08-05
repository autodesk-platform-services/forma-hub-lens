import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { TOOL_SPECS } from "@/lib/dashboards/specs";
import { toolStatus } from "@/lib/dashboards/engine";
import { listTables, recentUploads } from "@/lib/dataset";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { DatasetUpload, ToolsExplorer, type ToolCard } from "@/components/ToolsExplorer";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const tables = listTables();
  const datasetRows = tables.reduce((sum, table) => sum + table.rowCount, 0);
  const uploads = recentUploads(3);

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
          One dashboard per Forma tool, laid out to match the Autodesk Power BI template for that
          tool. Select a tool to open its dashboard.
        </p>
      </div>

      <section className="rounded border border-adsk-lightgray bg-adsk-white p-5">
        <h2 className="font-legend text-sm text-adsk-black">Data Connector CSV extract</h2>
        <p className="mt-1 mb-3 max-w-3xl text-xs text-adsk-gray">
          Upload the ZIP of CSVs from Insight &rsaquo; Data Connector. Each file is loaded under its
          own name — <code className="rounded bg-adsk-offwhite px-1">admin_projects.csv</code>{" "}
          becomes the <code className="rounded bg-adsk-offwhite px-1">admin_projects</code> table —
          which is exactly how the Power BI templates bind their data, so the dashboards below light
          up automatically. Uploading again replaces the tables it contains.
        </p>
        <DatasetUpload hasData={tables.length > 0} />

        {uploads.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-adsk-offwhite pt-3">
            {uploads.map((upload) => (
              <li key={upload.id} className="flex flex-wrap gap-x-3 text-[11px] text-adsk-gray">
                <span className="font-legend text-adsk-black">{upload.fileName}</span>
                <span>{upload.tables} tables</span>
                <span>{upload.rows.toLocaleString()} rows</span>
                <span>{(upload.size / 1024 / 1024).toFixed(1)} MB</span>
                <span>{new Date(upload.uploadedAt).toISOString().slice(0, 16).replace("T", " ")}Z</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ToolsExplorer tools={tools} datasetTables={tables.length} datasetRows={datasetRows} />
    </div>
  );
}
