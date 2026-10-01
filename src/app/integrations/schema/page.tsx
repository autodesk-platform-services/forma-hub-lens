import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { getTable, listTables, resolveColumn } from "@/lib/dataset";
import { getDb } from "@/lib/db";
import { CLASSIFICATION_NOTICE_URL, PUBLISHED_MIGRATION, SCHEMA_SERVICE_GROUPS, parsePublishedChanges, parsePublishedTables } from "@/lib/integrationOfficial";
import { latestOfficialSnapshot, listManifests } from "@/lib/integrationStore";
import { Card, Pill, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { CheckboxGroup } from "@/components/CheckboxGroup";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { refreshIntegrationChangesAction, refreshIntegrationSchemaAction, registerIntegrationSchemaAction } from "../actions";

export const dynamic = "force-dynamic";

function projectSwitch(group: "takeoff" | "estimates", projectId: string): string {
  const table = getTable(`${group}_settings`);
  if (!table) return "Unknown: settings table is not loaded.";
  const project = resolveColumn(table, "project_id") ?? resolveColumn(table, "bim360_project_id");
  const value = resolveColumn(table, "forma_classifications");
  if (!project || !value) return "Unknown: project ID or forma_classifications column is absent.";
  const quoted = (name: string) => `"${name}"`;
  const rows = getDb().prepare(`SELECT ${quoted(value)} AS setting FROM ${quoted(table.sqlName)} WHERE ${quoted(project)} = ? LIMIT 2`)
    .all(projectId) as Array<{ setting: string | null }>;
  if (rows.length !== 1) return rows.length ? "Unknown: multiple settings rows match this project." : "Unknown: project has no settings row in this local extract.";
  if (/^(true|1)$/i.test(String(rows[0].setting ?? ""))) return "Converted in this uploaded snapshot (true).";
  if (/^(false|0)$/i.test(String(rows[0].setting ?? ""))) return "Legacy in this uploaded snapshot (false).";
  return "Unknown: setting value is unreadable.";
}

export default async function IntegrationSchemaPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const query = await searchParams;
  const projectId = typeof query.project === "string" && query.project.length <= 200 ? query.project : null;
  const snapshot = latestOfficialSnapshot("schema");
  const changeSnapshot = latestOfficialSnapshot("changes");
  const published = snapshot ? parsePublishedTables(snapshot.body) : null;
  const changes = changeSnapshot ? parsePublishedChanges(changeSnapshot.body) : null;
  const local = new Map(listTables().map((table) => [table.name, table]));
  const mapped = PUBLISHED_MIGRATION.mappings.map((item) => {
    const localName = `${item.service}_${item.table}`;
    const localTable = local.get(localName);
    const fields = item.replacement.includes("classification3_node_id through classification5_node_id")
      ? ["classification3_node_id", "classification4_node_id", "classification5_node_id"]
      : item.replacement.match(/classification[1-5]_node_id|forma_classifications|content_version/g) ?? [];
    return { ...item, localName, localTable, fields, observed: fields.map((field) => ({ field, present: Boolean(localTable && resolveColumn(localTable, field)) })) };
  });
  return <div className="space-y-5">
    <div><Link href="/integrations" className="text-xs text-adsk-link">← Integration Health</Link><h1 className="mt-2 font-legend text-2xl">Schema and migration map</h1>
      <p className="mt-1 max-w-4xl text-sm text-adsk-gray">Autodesk published changes are mapped to local CSV headers. A missing local field can reflect an older extract or partial service selection; inspect the extract before concluding a consumer is broken.</p></div>
    {projectId && <Card title="Selected project conversion evidence" subtitle="Per-project settings read from the current local reporting tables; project creation date is not used to infer conversion.">
      <p className="mb-2 font-mono text-xs">{projectId}</p><div className="grid gap-2 text-xs sm:grid-cols-2"><p><strong>Takeoff:</strong> {projectSwitch("takeoff", projectId)}</p><p><strong>Estimates:</strong> {projectSwitch("estimates", projectId)}</p></div>
      <p className="mt-2 text-xs text-adsk-gray">Settings are a snapshot. User-uploaded ZIP files have unverified source hub and project coverage. Confirm the source job in <Link href="/integrations/inventory" className="text-adsk-link underline">extraction inventory</Link>.</p>
      <div className="mt-3 text-xs"><strong>Manifests expecting this project:</strong> {listManifests().filter((manifest) => manifest.expectedProjectIds.includes(projectId)).map((manifest) => <Link key={manifest.id} href={`/integrations/${manifest.id}`} className="ml-2 text-adsk-link underline">{manifest.name}</Link>)}</div>
    </Card>}
    <Card title="Published classification migration" subtitle="Autodesk's notice says the rollout dates may change. Use project settings and extraction evidence to determine actual conversion state.">
      <div className="flex flex-wrap gap-2 text-xs">{PUBLISHED_MIGRATION.milestones.map((milestone) => <div key={milestone.date} className="rounded border border-adsk-lightgray p-2"><strong>{milestone.date}</strong><div className="text-adsk-gray">{milestone.label}</div></div>)}</div>
      <p className="mt-3 text-xs"><a href={CLASSIFICATION_NOTICE_URL} target="_blank" rel="noreferrer" className="text-adsk-link underline">Read Autodesk's change notice ↗</a></p>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-adsk-lightgray text-adsk-gray"><th className="py-2 pr-3">Service / table</th><th className="py-2 pr-3">Legacy</th><th className="py-2 pr-3">Replacement or action</th><th className="py-2">Local header observation</th></tr></thead>
        <tbody>{mapped.map((item, index) => <tr key={index} className="border-b border-adsk-offwhite align-top"><td className="py-2 pr-3 font-mono">{item.service}.{item.table}</td><td className="py-2 pr-3">{item.legacy ?? "New"}</td><td className="py-2 pr-3">{item.replacement}</td><td className="py-2">{!item.localTable ? <Pill>Table not loaded</Pill> : item.observed.length ? item.observed.map((entry) => <span key={entry.field} className="mr-2 inline-flex gap-1"><Pill tone={entry.present ? "good" : "warn"}>{entry.present ? "Seen" : "Absent"}</Pill><code>{entry.field}</code></span>) : <span className="text-adsk-gray">Review relationship or service mapping</span>}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs text-adsk-gray">Columns numbered 1–5 are positions, not classification structure identities. For converted Takeoff quantities, use quantities.item_id → takeoff_items.id and the item type with quantity_order to find quantity_definitions. New 2D content_version values are Autodesk Files version URNs and need Data Management resolution.</p>
    </Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Captured public schema" subtitle="Read from Autodesk's public Data Connector schema JSON endpoint, or an admin-entered reference labeled separately.">
        <p className="text-xs text-adsk-gray">Capture: {formatDateTime(snapshot?.capturedAt)} · Source: {snapshot?.source === "autodesk_endpoint" ? "Autodesk public endpoint" : snapshot?.source === "admin_registered" ? "Admin registered, authenticity unverified" : "None"} · Parsed tables: {published?.length ?? "unknown"}</p>
        {snapshot && <p className="mt-2 text-xs"><a href={snapshot.sourceUrl} target="_blank" rel="noreferrer" className="text-adsk-link underline">Source URL ↗</a></p>}
        {session.hubRole === "hub_admin" && <ActionForm action={refreshIntegrationSchemaAction} label="Capture selected service schemas" className="mt-4 space-y-3">
          <CheckboxGroup name="groups" selectAllLabel="Select all service groups">
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{SCHEMA_SERVICE_GROUPS.map((group) => <label key={group}><input type="checkbox" name="groups" value={group} defaultChecked={["takeoff", "estimates", "classifications"].includes(group)} className="mr-2" />{group}</label>)}</div>
          </CheckboxGroup>
        </ActionForm>}
        {session.hubRole === "hub_admin" && <details className="mt-4 text-xs"><summary className="cursor-pointer text-adsk-link">Register an official JSON snapshot manually</summary><p className="my-2 text-adsk-gray">Fallback if the Autodesk endpoint is unavailable. Lens records this as admin supplied, even when its link is on Autodesk's domain.</p>
          <ActionForm action={registerIntegrationSchemaAction} label="Register reference" className="space-y-2"><label className="block">Official Autodesk documentation URL<input name="sourceUrl" type="url" required className="mt-1 block w-full rounded border border-adsk-lightgray p-2" /></label>
            <label className="block">JSON response<textarea name="schemaJson" rows={5} required className="mt-1 block w-full rounded border border-adsk-lightgray p-2 font-mono" /></label></ActionForm></details>}
      </Card>
      <Card title="Schema change feed" subtitle="Captures Autodesk's public change feed; it describes published schema changes, not whether this hub has converted.">
        <p className="text-xs text-adsk-gray">Capture: {formatDateTime(changeSnapshot?.capturedAt)} · Watermark: {changes?.watermark || "unknown"} · Parsed changes: {changes?.changes.length ?? "unknown"}</p>
        {session.hubRole === "hub_admin" && <ActionForm action={refreshIntegrationChangesAction} label="Capture public changes" className="mt-3" />}
        <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto text-xs">{changes?.changes.slice().reverse().slice(0, 40).map((item, index) => <li key={index} className="rounded border border-adsk-lightgray p-2"><strong>{item.serviceGroup}.{item.table}{item.column ? `.${item.column}` : ""}</strong> · {item.changeType}<p className="text-adsk-gray">{item.year}-{item.month} · {item.notes || "No note"}</p></li>)}
          {!changes && <li className="text-adsk-gray">No machine-readable change feed captured. Unknown does not mean unchanged.</li>}</ul>
        {changes && changes.changes.length > 40 && <p className="mt-2 text-xs text-adsk-gray">Showing 40 most recent of {changes.changes.length} captured entries.</p>}
      </Card>
    </div>
  </div>;
}
