import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { impactsForManifest } from "@/lib/integrationImpact";
import { getManifest, latestRun, listApiNotices, CAPABILITY_KEYS, CAPABILITY_LABELS } from "@/lib/integrationStore";
import { isIntegrationPreflightStale, type IntegrationPreflight, type IntegrationCheck } from "@/lib/integrationAnalysis";
import { Card, EmptyState, Pill, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { captureIntegrationBaselineAction, runIntegrationPreflightAction } from "../actions";

export const dynamic = "force-dynamic";

function tone(status: IntegrationCheck["status"]): "good" | "bad" | "warn" | "default" {
  return status === "pass" ? "good" : status === "fail" ? "bad" : status === "review" ? "warn" : "default";
}

export default async function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const { id } = await params;
  const manifest = id.length <= 100 ? getManifest(id) : null;
  if (!manifest) return <Card><EmptyState title="Manifest not found." /></Card>;
  const run = latestRun(id);
  const result = run?.result as IntegrationPreflight | undefined;
  const stale = isIntegrationPreflightStale(manifest, result);
  const impacts = impactsForManifest(manifest, listApiNotices());

  return <div className="space-y-5">
    <div><Link href="/integrations" className="text-xs text-adsk-link">← Integration Health</Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-legend text-2xl text-adsk-black">{manifest.name}</h1>
        <p className="mt-1 text-xs text-adsk-gray">{manifest.customer || "Team unknown"} · Owner {manifest.owner || "unknown"} · Revision {manifest.version} · Updated {formatDateTime(manifest.updatedAt)}</p></div>
        {session.hubRole === "hub_admin" && <Link href={`/integrations/${id}/edit`} className="rounded border border-adsk-lightgray px-3 py-1.5 text-xs text-adsk-link">Edit contract</Link>}</div>
      {manifest.description && <p className="mt-2 max-w-4xl text-sm text-adsk-gray">{manifest.description}</p>}
    </div>
    <Card title="Readiness preflight" subtitle="A stored evidence check of the current manifest revision and locally available reporting data. It cannot validate downstream code or real-time Autodesk project state.">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {!run ? <Pill>Never run</Pill> : <Pill tone={stale ? "warn" : result?.status === "blocked" ? "bad" : result?.status === "locally_ready" ? "good" : "warn"}>
          {run.version !== manifest.version ? "Older revision" : stale ? "Evidence changed since run" : result?.status === "blocked" ? "Blocked" : result?.status === "locally_ready" ? "Local checks pass" : "Needs review"}</Pill>}
        <span className="text-adsk-gray">{run ? `Run ${formatDateTime(run.evaluatedAt)} against revision ${run.version}` : "Run a check to capture evidence."}</span>
      </div>
      {session.hubRole === "hub_admin" && <div className="mt-4 flex flex-wrap gap-3">
        <ActionForm action={runIntegrationPreflightAction} label="Run and record preflight" variant="primary" hidden={{ manifestId: id }} />
        {manifest.tables.length > 0 && <ActionForm action={captureIntegrationBaselineAction} label="Capture current row baselines" hidden={{ manifestId: id }} />}
      </div>}
      {result && <><p className="mt-4 text-xs text-adsk-gray">{result.note}</p><div className="mt-3 flex flex-wrap gap-3 text-xs">
        <span>{result.counts.pass} passed</span><span>{result.counts.fail} failed</span><span>{result.counts.review} need review</span><span>{result.counts.unknown} unknown</span>
      </div><div className="mt-4 space-y-2">{result.checks.map((item) => <div key={item.id} className="grid gap-2 rounded border border-adsk-lightgray p-3 text-xs sm:grid-cols-[8rem_minmax(12rem,1fr)_7rem]">
        <div><Pill tone={tone(item.status)}>{item.status}</Pill><div className="mt-1 text-adsk-gray">{item.group}</div></div>
        <div><strong className="text-adsk-black">{item.label}</strong><p className="mt-1 text-adsk-gray">{item.detail}</p></div>
        <span className="text-adsk-gray">{item.evidence.replaceAll("_", " ")}</span>
      </div>)}</div></>}
    </Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Extraction and data contract" subtitle="Declared by an administrator; each source is checked separately in preflight.">
        <dl className="space-y-2 text-xs"><div><dt className="font-medium">APS request ID</dt><dd className="font-mono text-adsk-gray">{manifest.requestId ?? "Not linked"}</dd></div>
          <div><dt className="font-medium">Required service groups</dt><dd className="text-adsk-gray">{manifest.expectedServices.join(", ") || "None declared"}</dd></div>
          <div><dt className="font-medium">Expected project IDs</dt><dd className="text-adsk-gray">{manifest.expectedProjectIds.length ? manifest.expectedProjectIds.join(", ") : "No project scope declared"}</dd></div></dl>
        <h3 className="mt-4 text-xs font-semibold">Reporting tables</h3><ul className="mt-2 space-y-2 text-xs">{manifest.tables.length ? manifest.tables.map((table) => <li key={table.table} className="rounded border border-adsk-lightgray p-2">
          <strong className="font-mono">{table.table}</strong><p className="text-adsk-gray">Minimum rows {table.minRows ?? "unset"}; max trusted extract age {table.maxAgeHours ?? "unset"} hours; baseline {table.baselineRows ?? "unset"} rows at {table.baselineMinPct}% floor; project field {table.projectField ?? "unmapped"}.</p>
        </li>) : <li className="text-adsk-gray">No tables declared.</li>}</ul>
        <h3 className="mt-4 text-xs font-semibold">Field and reference requirements</h3>
        <ul className="mt-2 space-y-1 text-xs text-adsk-gray">{manifest.fields.map((field) => <li key={`${field.table}.${field.field}`}><code>{field.table}.{field.field}</code> → {field.consumerField ?? "consumer mapping unknown"}; expected {field.type}; max null {field.maxNullPct ?? "unset"}%</li>)}
          {manifest.references.map((ref, index) => <li key={index}><code>{ref.sourceTable}.{ref.sourceField}</code> → <code>{ref.targetTable}.{ref.targetField}</code>; max unmatched {ref.maxMissingPct}%</li>)}
          {!manifest.fields.length && !manifest.references.length && <li>No field or reference requirements declared.</li>}</ul>
      </Card>
      <Card title="Migration and API impact" subtitle="Declared dependencies only. Lens does not inspect an integration's code.">
        <h3 className="text-xs font-semibold">Classification paths</h3><p className="mt-1 text-xs text-adsk-gray">{Object.entries(manifest.classification).filter(([, on]) => on).map(([key]) => key).join(", ") || "None declared"}</p>
        <ul className="mt-3 space-y-2 text-xs">{CAPABILITY_KEYS.map((key) => <li key={key} className="rounded border border-adsk-lightgray p-2">
          <strong>{CAPABILITY_LABELS[key]}</strong><p className="text-adsk-gray">{manifest.capabilities[key].status.replaceAll("_", " ")}{manifest.capabilities[key].reference ? ` · ${manifest.capabilities[key].reference}` : ""}</p>
        </li>)}</ul>
        <h3 className="mt-4 text-xs font-semibold">Declared API paths</h3><ul className="mt-1 space-y-1 text-xs text-adsk-gray">{manifest.dependencies.length ? manifest.dependencies.map((dependency, index) => <li key={index}><code>{dependency.path}</code>{dependency.version ? ` · ${dependency.version}` : ""}{dependency.note ? ` · ${dependency.note}` : ""}</li>) : <li>None declared; impact matching is incomplete.</li>}</ul>
        <h3 className="mt-4 text-xs font-semibold">Potential notices</h3><ul className="mt-1 space-y-2 text-xs">{impacts.length ? impacts.map((impact, index) => <li key={index} className="rounded border border-adsk-gold bg-adsk-gold/10 p-2">
          <a href={impact.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-adsk-link underline">{impact.title}</a><p className="mt-1 text-adsk-gray">{impact.detail}</p><p className="mt-1 text-adsk-gray">Effective {impact.effectiveOn ?? "date unknown"} · matched {impact.matchedPaths.join(", ")}</p>
        </li>) : <li className="text-adsk-gray">No declared path matches recorded notices. This is not proof of no API exposure.</li>}</ul>
      </Card>
    </div>
  </div>;
}
