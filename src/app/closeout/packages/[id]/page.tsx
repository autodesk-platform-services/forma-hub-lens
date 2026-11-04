import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { closeoutProject } from "@/lib/closeoutEngine";
import { type CloseoutManifest } from "@/lib/closeoutPackage";
import { getCloseoutAcceptance, getCloseoutPackage } from "@/lib/closeoutStore";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { Card } from "@/components/ui";
import { CheckboxGroup } from "@/components/CheckboxGroup";
import { acceptPackageAction } from "../../actions";

export const dynamic = "force-dynamic";
const date = (value: number) => new Date(value).toLocaleString();

export default async function CloseoutPackagePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const { id } = await params;
  const record = getCloseoutPackage(id);
  if (!record || !closeoutProject(record.projectId)) notFound();
  const manifest = JSON.parse(record.manifest) as CloseoutManifest;
  const acceptance = getCloseoutAcceptance(id);
  const query = await searchParams;
  const notice = typeof query.notice === "string" ? query.notice : null;
  const error = typeof query.error === "string" ? query.error : null;
  const canAccept = session.hubRole === "hub_admin" && !acceptance && !manifest.exceptionOverflow;
  return <div className="space-y-6">
    <header><Link href={`/closeout/${encodeURIComponent(record.projectId)}`} className="text-xs text-adsk-link hover:underline">← Project closeout</Link>
      <h1 className="mt-2 font-legend text-2xl">Handover package</h1>
      <p className="mt-1 text-sm text-adsk-gray">Project {record.projectId} · built {date(record.createdAt)} · {record.status}</p>
      <p className="mt-2 max-w-3xl text-sm">This package is an immutable local snapshot. Review its source inventories, included exact file versions, and every outstanding exception before recording local acceptance.</p>
    </header>
    {notice && <p role="status" className="rounded bg-green-50 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm">{error}</p>}
    <Card title="Package and assessment">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-adsk-gray">Assessment</dt><dd className="font-medium capitalize">{manifest.assessment.status}</dd></div>
        <div><dt className="text-adsk-gray">Package outcome</dt><dd className="font-medium capitalize">{record.status}</dd></div>
        <div><dt className="text-adsk-gray">Exception count</dt><dd className="font-medium">{manifest.exceptions.length + manifest.exceptionOverflow}</dd></div>
        <div><dt className="text-adsk-gray">Included files</dt><dd className="font-medium">{manifest.files.filter((file) => file.outcome === "included").length} of {manifest.files.length} selected</dd></div>
        <div><dt className="text-adsk-gray">Built by</dt><dd className="break-all">{record.actor}</dd></div>
        <div><dt className="text-adsk-gray">Size</dt><dd>{record.byteSize.toLocaleString()} bytes</dd></div>
        <div><dt className="text-adsk-gray">SHA-256</dt><dd className="break-all font-mono text-xs">{record.sha256}</dd></div>
      </dl>
      <a href={`/closeout/packages/${encodeURIComponent(record.id)}/download`} className="mt-4 inline-block rounded bg-adsk-black px-4 py-2 text-sm text-white">Download verified ZIP</a>
      <p className="mt-3 text-xs text-adsk-gray">{manifest.statement}</p>
    </Card>
    <Card title="Evidence and record documents">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th>Domain</th><th>Source and revision</th><th>Rows</th><th>Inventory</th><th>Detail</th></tr></thead><tbody>
        {(manifest.evidence ?? []).map((item) => { const source = manifest.assessment.sources.find((candidate) => candidate.domain === item.domain);
          return <tr key={item.domain} className="border-b"><td className="py-2 capitalize">{item.domain}</td>
            <td className="break-all text-xs">{source?.kind ?? "missing"} · {source?.revision ?? "no revision"} · {source?.coverage ?? "unverified"}</td><td>{item.rowCount}</td>
            <td>{item.archivePath ?? "Omitted"}</td><td>{item.reason ?? (item.complete ? `${item.redactedFields} sensitive field(s) redacted` : "Partial source; see exceptions")}</td></tr>; })}
      </tbody></table></div>
      <h2 className="mt-5 font-medium">Pinned files</h2>
      {manifest.files.length ? <ul className="mt-2 space-y-2 text-sm">{manifest.files.map((file) => <li key={file.selectionId} className="rounded border p-3">
        <strong>{file.displayName}</strong> · {file.outcome}<span className="block break-all text-xs text-adsk-gray">Item {file.sourceId} · version {file.versionId} · {file.archivePath ?? file.reason ?? "No package path"} · SHA-256 {file.sha256 ?? "unavailable"}</span>
      </li>)}</ul> : <p className="mt-2 text-sm text-adsk-gray">No final record file was selected.</p>}
      {manifest.assetHandover && <p className="mt-4 text-sm">Asset handover: {manifest.assetHandover.assets} assets, {manifest.assetHandover.links} links, {manifest.assetHandover.unknowns} unresolved references. Open <code>assets/inventory.html</code> or <code>assets/index.json</code> in the ZIP for the full index.</p>}
    </Card>
    <Card title="Outstanding exceptions and local acceptance">
      {acceptance ? <div className="text-sm"><p className="font-medium">Accepted locally by {acceptance.actor} on {date(acceptance.acceptedAt)}.</p>
        <p className="mt-1">{acceptance.note}</p><p className="mt-2 text-xs text-adsk-gray">This record is a local sign-off; it does not submit to Autodesk or the client.</p></div> :
        <p className="text-sm text-adsk-gray">The project may be accepted with exceptions only when every listed exception is explicitly acknowledged. This remains a local record.</p>}
      {manifest.exceptionOverflow > 0 && <p role="alert" className="mt-3 rounded bg-amber-50 p-3 text-sm">{manifest.exceptionOverflow} findings exceeded the review limit. Acceptance is unavailable until the package is rebuilt with a complete, reviewable exception list.</p>}
      {!canAccept && manifest.exceptions.length > 0 && <div className="mt-3 space-y-2">
        {manifest.exceptions.map((finding) => <div key={finding.id} className="rounded border p-3 text-sm">
          <strong>{finding.domain}: {finding.title}</strong><p className="mt-1">{finding.detail}</p>
          <p className="mt-1 break-all text-xs text-adsk-gray">{finding.kind} · {finding.code} · record {finding.recordId ?? "—"} · evidence {finding.evidence} · finding {finding.id}</p>
        </div>)}
      </div>}
      {canAccept ? <form action={acceptPackageAction} className="mt-4 space-y-4 text-sm"><input type="hidden" name="packageId" value={record.id} />
        {manifest.exceptions.length > 0 && <fieldset className="max-h-96 space-y-2 overflow-y-auto rounded border p-3"><legend className="font-medium">Acknowledge each outstanding exception</legend><CheckboxGroup name="acknowledgedException" selectAllLabel="Acknowledge all listed exceptions">
          {manifest.exceptions.map((finding) => <label key={finding.id} className="flex gap-2 border-b pb-2"><input required type="checkbox" name="acknowledgedException" value={finding.id} className="mt-1" />
            <span><strong>{finding.domain}: {finding.title}</strong><span className="block text-xs text-adsk-gray">{finding.kind} · {finding.code} · record {finding.recordId ?? "—"} · {finding.detail} · evidence {finding.evidence} · finding {finding.id}</span></span></label>)}
        </CheckboxGroup></fieldset>}
        <label className="block">Acceptance note<input required name="note" maxLength={1000} className="mt-1 block w-full rounded border p-2" placeholder="Record client or internal sign-off context" /></label>
        <button className="rounded bg-adsk-black px-4 py-2 text-white">Record local acceptance</button>
      </form> : !acceptance && session.hubRole !== "hub_admin" ? <p className="mt-3 text-sm text-adsk-gray">Hub Admin access is required to record local acceptance.</p> : null}
    </Card>
  </div>;
}
