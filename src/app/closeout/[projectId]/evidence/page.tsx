import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/aps/auth";
import { configProblems, env } from "@/lib/env";
import { closeoutProject, closeoutRecordId, collectCloseoutSources } from "@/lib/closeoutEngine";
import { Card, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";

export const dynamic = "force-dynamic";
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
function sourceLink(row: Record<string, unknown>): string | null {
  const raw = object(object(row.links).webView).href;
  if (typeof raw !== "string") return null;
  try { const url = new URL(raw); return url.protocol === "https:" && (url.hostname === "autodesk.com" || url.hostname.endsWith(".autodesk.com")) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export default async function CloseoutEvidencePage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems(); if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession(); if (!session) return <SignInRequired />;
  const { projectId } = await params;
  const project = closeoutProject(projectId); if (!project) notFound();
  const query = await searchParams;
  const domain = typeof query.domain === "string" ? query.domain : "";
  const recordId = typeof query.record === "string" ? query.record : null;
  const sources = collectCloseoutSources(project.id);
  const source = sources.find((s) => s.domain === domain); if (!source) notFound();
  const rows = recordId ? source.rows.filter((r) => closeoutRecordId(source.domain, r) === recordId) : source.rows.slice(0, 50);
  const connections = sources.find((s) => s.domain === "relationships");
  const related = recordId ? connections?.rows.filter((row) => Array.isArray(row.entities) && row.entities.some((entity) => String(object(entity).id) === recordId)).slice(0, 100) ?? [] : [];
  return <div className="space-y-5">
    <Link href={`/closeout/${encodeURIComponent(project.id)}`} className="text-xs text-adsk-link hover:underline">← {project.name} closeout</Link>
    <h1 className="font-legend text-2xl capitalize">{domain} evidence</h1>
    <Card title="Source record" subtitle={env.demoMode ? "Sample data · fictional closeout evidence" : `Latest local evidence collected ${formatDateTime(source.collectedAt)}. Source: ${source.kind}.`}>
      <p className="text-xs text-adsk-gray">{env.demoMode ? "Coverage: synthetic example" : `Revision: ${source.revision ?? "Unknown"} · Coverage: ${source.coverage}`} · Complete: {source.complete ? "Yes" : "No"}</p>
      {!env.demoMode && source.note && <p role="note" className="mt-2 text-sm">{source.note}</p>}
      {!rows.length ? <p className="mt-3 text-sm">{recordId ? `Record ${recordId} is absent from this source. This may be the missing deliverable identified by the assessment.` : "No records in this source."}</p> :
        <div className="mt-3 space-y-4">{rows.map((row, index) => { const href = !env.demoMode && source.kind === "live-aps" ? sourceLink(row) : null;
          return <article key={index} className="rounded border border-adsk-lightgray p-3">
            <h2 className="font-medium">{String(row.name ?? row.title ?? row.id ?? "Record")}</h2>
            <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">{["id", "version_id", "version_number", "folder_path", "status", "approval_status", "category", "location", "createdAt", "updatedAt", "document_count", "recipient_count"].filter((key) => row[key] != null).map((key) =>
              <div key={key}><dt className="text-adsk-gray">{key.replaceAll("_", " ")}</dt><dd className="break-all">{String(row[key])}</dd></div>)}</dl>
            {href && <a href={href} rel="noreferrer" target="_blank" className="mt-3 inline-block text-xs text-adsk-link hover:underline">Open Autodesk source record →</a>}
            <details className="mt-3 text-xs"><summary className="cursor-pointer text-adsk-gray">Raw record and metadata</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-adsk-offwhite p-3">{JSON.stringify(row, null, 2)}</pre></details>
          </article>; })}</div>}
      {!recordId && source.rows.length > 50 && <p className="mt-3 text-xs text-adsk-gray">Showing 50 of {source.rowCount} source records. Open an exception to inspect its exact record.</p>}
    </Card>
    {recordId && <Card title="Relationships and linked evidence" subtitle={env.demoMode ? "Fictional links between sample project records." : "Relationships describe only domains represented by Autodesk’s relationship service."}>
      {!connections?.complete && <p className="text-sm">Relationship coverage is incomplete or unavailable.</p>}
      {related.length ? <ul className="space-y-2 text-xs">{related.map((row, index) => <li key={index} className="rounded border p-3"><pre className="whitespace-pre-wrap break-all">{JSON.stringify(row, null, 2)}</pre></li>)}</ul>
        : <p className="text-sm text-adsk-gray">No matching relationships are recorded in the available evidence.</p>}
    </Card>}
  </div>;
}
