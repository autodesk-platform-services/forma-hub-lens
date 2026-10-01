import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card } from "@/components/ui";
import { CAPABILITY_KEYS, CAPABILITY_LABELS, type IntegrationManifest } from "@/lib/integrationStore";
import { saveIntegrationAction } from "./actions";

const input = "mt-1 block w-full rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-sm text-adsk-black";
const textarea = input + " font-mono text-xs";

export function IntegrationEditor({ manifest }: { manifest: IntegrationManifest | null }) {
  return <Card title={manifest ? `Edit ${manifest.name}` : "New integration manifest"}
    subtitle="A Lens-owned dependency and quality contract. Saving it does not change Autodesk or downstream pipeline code.">
    <ActionForm action={saveIntegrationAction} label={manifest ? "Save new revision" : "Create manifest"} pendingLabel="Saving…"
      variant="primary" hidden={{ manifestId: manifest?.id ?? "", version: String(manifest?.version ?? 0) }} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-adsk-gray">Integration name *<input name="name" required maxLength={120} defaultValue={manifest?.name} className={input} /></label>
        <label className="text-xs text-adsk-gray">Customer or team<input name="customer" maxLength={120} defaultValue={manifest?.customer} className={input} /></label>
        <label className="text-xs text-adsk-gray">Owner<input name="owner" maxLength={120} defaultValue={manifest?.owner} className={input} /></label>
        <label className="text-xs text-adsk-gray">APS Data Connector request ID<input name="requestId" maxLength={200} defaultValue={manifest?.requestId ?? ""} className={input} /><span className="mt-1 block">Bind to a cached APS request to test service selection.</span></label>
      </div>
      <label className="block text-xs text-adsk-gray">Purpose and downstream consumers<textarea name="description" rows={2} maxLength={1000} defaultValue={manifest?.description} className={input} /></label>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="text-xs text-adsk-gray">Expected project IDs · one per line<textarea name="projectIds" rows={4} defaultValue={manifest?.expectedProjectIds.join("\n")} className={textarea} /></label>
        <label className="text-xs text-adsk-gray">Required service groups · one per line<textarea name="services" rows={4} defaultValue={manifest?.expectedServices.join("\n")} placeholder={"takeoff\nestimates\nclassifications"} className={textarea} /></label>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="text-xs text-adsk-gray">API dependencies · path | version | note<textarea name="dependencies" rows={4}
          defaultValue={manifest?.dependencies.map((item) => [item.path, item.version ?? "", item.note ?? ""].join(" | ")).join("\n")}
          placeholder="/classification/v1/accounts/{accountId}/trees | v1 | reads treeConnectionType" className={textarea} />
          <span className="mt-1 block">Relative paths only. Lens never calls these declared paths.</span></label>
        <label className="text-xs text-adsk-gray">Required tables · table | min rows | max extract age hours | project field | service field | baseline floor %<textarea name="tables" rows={4}
          defaultValue={manifest?.tables.map((item) => [item.table, item.minRows ?? "", item.maxAgeHours ?? "", item.projectField ?? "", item.serviceField ?? "", item.baselineMinPct].join(" | ")).join("\n")}
          placeholder="takeoff_quantity_definitions | 1 | 72 | project_id | | 80" className={textarea} /></label>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="text-xs text-adsk-gray">Required fields · table.field | expected type | max null % | consumer field<textarea name="fields" rows={6}
          defaultValue={manifest?.fields.map((item) => [`${item.table}.${item.field}`, item.type, item.maxNullPct ?? "", item.consumerField ?? ""].join(" | ")).join("\n")}
          placeholder={"takeoff_quantity_definitions.classification1_node_id | uuid | 100 | classification_node_id\ntakeoff_settings.forma_classifications | boolean | 0 | project_model"} className={textarea} />
          <span className="mt-1 block">Types: any, text, number, date, boolean, uuid, urn. Type checks sample up to 1,000 nonempty rows.</span></label>
        <label className="text-xs text-adsk-gray">Reference checks · source table.field | target table.field | max unmatched %<textarea name="references" rows={6}
          defaultValue={manifest?.references.map((item) => [`${item.sourceTable}.${item.sourceField}`, `${item.targetTable}.${item.targetField}`, item.maxMissingPct].join(" | ")).join("\n")}
          placeholder="takeoff_quantity_definitions.classification1_node_id | classifications_nodes.id | 0" className={textarea} />
          <span className="mt-1 block">Both tables must be listed above. Checks compare distinct nonempty keys in uploaded rows.</span></label>
      </div>
      <fieldset className="rounded border border-adsk-lightgray p-3">
        <legend className="px-1 text-xs font-semibold text-adsk-black">Classification migration scenarios</legend>
        <p className="mb-2 text-xs text-adsk-gray">Select the consumer paths this integration actually uses. Published migration requirements are added to preflight.</p>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <label><input type="checkbox" name="class_takeoff" defaultChecked={manifest?.classification.takeoff} className="mr-2" />Takeoff classifications</label>
          <label><input type="checkbox" name="class_estimates" defaultChecked={manifest?.classification.estimates} className="mr-2" />Estimate classifications</label>
          <label><input type="checkbox" name="class_quantities" defaultChecked={manifest?.classification.quantities} className="mr-2" />Takeoff quantities joins</label>
          <label><input type="checkbox" name="class_sheets" defaultChecked={manifest?.classification.sheetReferences} className="mr-2" />Takeoff 2D sheet references</label>
        </div>
      </fieldset>
      <fieldset className="rounded border border-adsk-lightgray p-3">
        <legend className="px-1 text-xs font-semibold text-adsk-black">Downstream implementation evidence</legend>
        <p className="mb-3 text-xs text-adsk-gray">CSV presence cannot prove pipeline code support. Mark a capability tested only after recording a real test reference. These are admin-entered claims, not code inspection by Lens.</p>
        <div className="space-y-3">{CAPABILITY_KEYS.map((key) => <div key={key} className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_11rem_minmax(12rem,1fr)] sm:items-end">
          <span className="text-xs text-adsk-black">{CAPABILITY_LABELS[key]}</span>
          <label className="text-xs text-adsk-gray">Status<select name={`capability_${key}`} defaultValue={manifest?.capabilities[key].status ?? "unknown"} className={input}>
            <option value="unknown">Unknown</option><option value="declared">Self-declared</option><option value="test_recorded">Test evidence recorded</option>
          </select></label>
          <label className="text-xs text-adsk-gray">Test or design reference<input name={`evidence_${key}`} maxLength={300} defaultValue={manifest?.capabilities[key].reference ?? ""} className={input} /></label>
        </div>)}</div>
      </fieldset>
      <p className="text-xs text-adsk-gray">Source project coverage and hub identity are not verified for user-supplied ZIP files. Review <Link href="/integrations/inventory" className="text-adsk-link underline">extraction inventory</Link> before treating a local pass as evidence of the intended account.</p>
    </ActionForm>
  </Card>;
}
