import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { getIntegrationMonitorState, latestRun, listManifests } from "@/lib/integrationStore";
import { isIntegrationPreflightStale, type IntegrationPreflight } from "@/lib/integrationAnalysis";
import { latestOfficialSnapshot } from "@/lib/integrationStore";
import { Card, EmptyState, Pill, Stat, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { configureIntegrationMonitorAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const manifests = listManifests();
  const monitor = getIntegrationMonitorState();
  const schema = latestOfficialSnapshot("schema");
  const changes = latestOfficialSnapshot("changes");
  const runs = manifests.map((manifest) => { const run = latestRun(manifest.id); return { manifest, run,
    stale: isIntegrationPreflightStale(manifest, run?.result as IntegrationPreflight | undefined) }; });
  const blocked = runs.filter(({ run, stale }) => run && !stale && (run.result as { status?: string }).status === "blocked").length;
  const unknown = runs.filter(({ stale }) => stale).length;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="mb-1 text-xs text-adsk-gray">Data / Integration Health</p>
        <h1 className="font-legend text-2xl text-adsk-black">Integration Health</h1>
        <p className="mt-1 max-w-3xl text-sm text-adsk-gray">Explore how a fictional consumer manifest connects reporting fields, sample extracts, and migration readiness checks. No customer integration is monitored in this demo.</p>
      </div>
      {session.hubRole === "hub_admin" && <Link href="/integrations/new" className="rounded border border-adsk-gold bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black">New manifest</Link>}
    </div>
    <nav aria-label="Integration Health sections" className="flex flex-wrap gap-2 text-xs">
      <Link href="/integrations/schema" className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-adsk-link">Schema and migration map →</Link>
      <Link href="/integrations/inventory" className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-adsk-link">Extraction inventory →</Link>
      <Link href="/integrations/watch" className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-adsk-link">API change watch →</Link>
    </nav>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Integration manifests" value={String(manifests.length)} hint="Fictional consumer contracts" />
      <Stat label="Latest blocked preflights" value={String(blocked)} hint="Among stored runs" tone={blocked ? "bad" : "default"} />
      <Stat label="Need fresh run" value={String(unknown)} hint="Manifest or evidence changed" tone={unknown ? "warn" : "default"} />
      <Stat label="Sample schema snapshot" value={schema ? formatDateTime(schema.capturedAt) : "None"} hint="Bundled fictional example" />
    </div>
    <Card title="Consumer manifests" subtitle="Requirements are self-declared; preflight evidence identifies its own source and limits.">
      {runs.length === 0 ? <EmptyState title="No integrations registered.">A Hub Admin can create a manifest for a reporting template, API consumer, or customer pipeline.</EmptyState> :
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[11px] uppercase tracking-wide text-adsk-gray"><tr className="border-b border-adsk-lightgray"><th className="py-2 pr-3">Consumer</th><th className="py-2 pr-3">Owner</th><th className="py-2 pr-3">Dependencies</th><th className="py-2 pr-3">Latest preflight</th><th className="py-2">Updated</th></tr></thead>
          <tbody>{runs.map(({ manifest, run, stale }) => <tr key={manifest.id} className="border-b border-adsk-offwhite align-top">
            <td className="py-2 pr-3"><Link href={`/integrations/${manifest.id}`} className="font-medium text-adsk-link hover:underline">{manifest.name}</Link><div className="text-adsk-gray">{manifest.customer || "No team recorded"}</div></td>
            <td className="py-2 pr-3">{manifest.owner || "Unknown"}</td>
            <td className="py-2 pr-3">{manifest.tables.length} tables · {manifest.fields.length} fields · {manifest.dependencies.length} APIs</td>
            <td className="py-2 pr-3">{!run ? <Pill>Not run</Pill> : run.version !== manifest.version ? <Pill tone="warn">Older revision</Pill> : stale ? <Pill tone="warn">Evidence changed</Pill> :
              <Pill tone={(run.result as { status?: string }).status === "blocked" ? "bad" : (run.result as { status?: string }).status === "locally_ready" ? "good" : "warn"}>
                {(run.result as { status?: string }).status === "blocked" ? "Blocked" : (run.result as { status?: string }).status === "locally_ready" ? "Local checks pass" : "Needs review"}
              </Pill>}</td>
            <td className="py-2">{formatDateTime(manifest.updatedAt)}</td>
          </tr>)}</tbody></table></div>}
    </Card>
    <Card title="Monitoring example" subtitle="Monitoring is disabled in this public demo. These fields illustrate the production workflow; no background checks run.">
      <div className="grid gap-3 text-xs sm:grid-cols-3"><div><strong>Status</strong><p className="mt-1 text-adsk-gray">{monitor.enabled ? "Enabled" : "Disabled"}</p></div><div><strong>Last run</strong><p className="mt-1 text-adsk-gray">{formatDateTime(monitor.lastRunAt)}</p></div><div><strong>Next due</strong><p className="mt-1 text-adsk-gray">{formatDateTime(monitor.nextRunAt)}</p></div></div>
      {monitor.lastError && <p role="alert" className="mt-3 rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs">Last run errors: {monitor.lastError}</p>}
      {session.hubRole === "hub_admin" && <ActionForm action={configureIntegrationMonitorAction} label="Save monitor settings" className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs"><input type="checkbox" name="enabled" defaultChecked={monitor.enabled} className="mr-2" />Enable checks</label>
        <label className="text-xs text-adsk-gray">Interval (minutes)<input type="number" name="intervalMinutes" min={60} max={1440} step={60} defaultValue={monitor.intervalMinutes} className="ml-2 w-24 rounded border border-adsk-lightgray px-2 py-1" /></label>
      </ActionForm>}
      <p className="mt-3 text-xs text-adsk-gray">Sample change feed snapshot: {formatDateTime(changes?.capturedAt)}. Sample compatibility notices illustrate review; they do not validate a customer pipeline.</p>
    </Card>
  </div>;
}
