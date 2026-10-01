import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { impactsForManifest } from "@/lib/integrationImpact";
import { PUBLISHED_API_NOTICE, parsePublishedChanges } from "@/lib/integrationOfficial";
import { latestOfficialSnapshot, listApiNotices, listManifests } from "@/lib/integrationStore";
import { Card, Pill, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { addIntegrationNoticeAction, refreshIntegrationChangesAction } from "../actions";

export const dynamic = "force-dynamic";
const input = "mt-1 block w-full rounded border border-adsk-lightgray bg-adsk-white px-2 py-1.5 text-xs";

export default async function IntegrationWatchPage() {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const manifests = listManifests();
  const notices = listApiNotices();
  const snapshot = latestOfficialSnapshot("changes");
  const feed = snapshot ? parsePublishedChanges(snapshot.body) : null;
  const impacted = manifests.map((manifest) => ({ manifest, impacts: impactsForManifest(manifest, notices) }))
    .filter((entry) => entry.impacts.length > 0);
  return <div className="space-y-5">
    <div><Link href="/integrations" className="text-xs text-adsk-link">← Integration Health</Link><h1 className="mt-2 font-legend text-2xl">API change watch</h1>
      <p className="mt-1 max-w-3xl text-sm text-adsk-gray">Match published or admin-recorded notices to declared API paths. A match is potential exposure. A missing match does not prove an integration's code is unaffected.</p></div>
    <Card title="Published Forma Classifications API notice" subtitle="Autodesk published this change; the impact match uses only paths an admin declared in a manifest.">
      <div className="flex flex-wrap items-center gap-2 text-xs"><Pill tone="warn">Removal {PUBLISHED_API_NOTICE.effectiveOn}</Pill><a href={PUBLISHED_API_NOTICE.sourceUrl} target="_blank" rel="noreferrer" className="text-adsk-link underline">Official Autodesk notice ↗</a></div>
      <p className="mt-2 text-sm">{PUBLISHED_API_NOTICE.title}</p><p className="mt-1 text-xs text-adsk-gray">{PUBLISHED_API_NOTICE.summary}</p>
      <p className="mt-2 font-mono text-xs text-adsk-gray">{PUBLISHED_API_NOTICE.affectedPaths.join(" · ")}</p>
    </Card>
    <Card title="Potential consumer impact" subtitle="Based on saved dependency paths only. Review downstream code and contract tests before marking a migration complete.">
      {impacted.length ? <div className="space-y-3">{impacted.map(({ manifest, impacts }) => <div key={manifest.id} className="rounded border border-adsk-lightgray p-3 text-xs"><Link href={`/integrations/${manifest.id}`} className="font-semibold text-adsk-link underline">{manifest.name}</Link><span className="ml-2 text-adsk-gray">{manifest.customer || "Team unknown"}</span>
        <ul className="mt-2 space-y-1">{impacts.map((impact, index) => <li key={index}><Pill tone="warn">Potential</Pill> <a href={impact.sourceUrl} target="_blank" rel="noreferrer" className="text-adsk-link underline">{impact.title}</a><span className="text-adsk-gray"> · {impact.matchedPaths.join(", ")}</span></li>)}</ul></div>)}</div> : <p className="text-xs text-adsk-gray">No saved dependency paths match these notices. Manifests without declared paths have unknown exposure.</p>}
    </Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Admin-recorded notices" subtitle="Lens validates the official Autodesk link domain, but does not verify an admin's interpretation or inspect consumer code.">
        {notices.length ? <div className="space-y-3 text-xs">{notices.map((notice) => <div key={notice.id} className="rounded border border-adsk-lightgray p-3"><a href={notice.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-adsk-link underline">{notice.title}</a><p className="mt-1 text-adsk-gray">Published {notice.publishedOn ?? "unknown"} · Effective {notice.effectiveOn ?? "unknown"} · Recorded {formatDateTime(notice.recordedAt)}</p><p className="mt-2">{notice.description}</p><p className="mt-1 font-mono text-adsk-gray">{notice.affectedPaths.join(", ")}</p></div>)}</div> : <p className="text-xs text-adsk-gray">No admin-recorded API notices.</p>}
        {session.hubRole === "hub_admin" && <details className="mt-4"><summary className="cursor-pointer text-xs text-adsk-link">Record a notice from an official Autodesk page</summary><ActionForm action={addIntegrationNoticeAction} label="Record notice" className="mt-3 space-y-2"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">Title<input name="title" required maxLength={150} className={input} /></label><label className="text-xs">Official Autodesk URL<input name="sourceUrl" type="url" required className={input} /></label>
          <label className="text-xs">Published on<input name="publishedOn" type="date" className={input} /></label><label className="text-xs">Effective on<input name="effectiveOn" type="date" className={input} /></label></div>
          <label className="block text-xs">Affected relative API paths · one per line<textarea name="affectedPaths" required rows={3} placeholder="/classification/v1/accounts/{accountId}/trees" className={input + " font-mono"} /></label>
          <label className="block text-xs">Impact interpretation<textarea name="description" required rows={3} maxLength={1000} className={input} /></label>
        </ActionForm></details>}
      </Card>
      <Card title="Data Connector schema changes" subtitle="This is the separate public schema-change feed; API deprecations above are published notices, not entries inferred from this feed.">
        <p className="text-xs text-adsk-gray">Last capture {formatDateTime(snapshot?.capturedAt)} · watermark {feed?.watermark || "unknown"}</p>
        {session.hubRole === "hub_admin" && <ActionForm action={refreshIntegrationChangesAction} label="Refresh public schema changes" className="mt-3" />}
        {feed ? <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto text-xs">{feed.changes.slice().reverse().slice(0, 30).map((change, index) => <li key={index} className="rounded border border-adsk-lightgray p-2"><strong>{change.changeType}</strong> · {change.serviceGroup}.{change.table}{change.column ? `.${change.column}` : ""}<p className="text-adsk-gray">{change.year}-{change.month} · {change.notes || "No note"}</p></li>)}</ul> : <p className="mt-3 text-xs text-adsk-gray">No machine-readable feed captured yet. Change status is unknown.</p>}
      </Card>
    </div>
  </div>;
}
