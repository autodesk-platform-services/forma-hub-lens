import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/aps/auth";
import { configProblems, env } from "@/lib/env";
import { assessCloseoutProject, closeoutProject, closeoutRecordId, closeoutVersionId,
  collectCloseoutSources, type CloseoutAssessment } from "@/lib/closeoutEngine";
import { CLOSEOUT_DOMAINS, getCloseoutAssignment, listCloseoutAssessments,
  listCloseoutPackages, listCloseoutProfiles, listExpectedDeliverables } from "@/lib/closeoutStore";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { Card } from "@/components/ui";
import { DeliverableEditor } from "../DeliverableEditor";
import { addDeliverableAction, assignProfileAction, assessProjectAction, attestSourceAction,
  buildPackageAction, clearSelectionAction, refreshEvidenceAction, selectRecordAction } from "../actions";

export const dynamic = "force-dynamic";
const date = (value: number | null) => value ? new Date(value).toLocaleString() : "—";
const statusStyle = (status: string) => status === "ready" ? "bg-green-50 text-green-900" :
  status === "blockers" ? "bg-amber-50 text-amber-900" : "bg-gray-100 text-gray-800";

export default async function CloseoutProjectPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const { projectId } = await params;
  const project = closeoutProject(projectId);
  if (!project) notFound();
  const paramsValue = await searchParams;
  const fileId = typeof paramsValue.fileId === "string" ? paramsValue.fileId.trim().slice(0, 300) : "";
  const admin = session.hubRole === "hub_admin";
  const assigned = getCloseoutAssignment(project.id);
  const profiles = listCloseoutProfiles();
  const assignedProfile = profiles.find((item) => item.id === assigned?.profileId);
  const expected = assignedProfile ? listExpectedDeliverables(assignedProfile.id, project.id) : [];
  const sources = collectCloseoutSources(project.id);
  let assessment: CloseoutAssessment | null = null;
  let assessmentError: string | null = null;
  try { assessment = assessCloseoutProject(project.id); }
  catch (error) { assessmentError = error instanceof Error ? error.message : "Assessment could not be calculated."; }
  const prior = listCloseoutAssessments(project.id, 10);
  const packages = listCloseoutPackages(project.id, 10);
  const fileSource = sources.find((source) => source.domain === "files");
  const fileCandidates = fileSource?.rows.filter((row) => closeoutRecordId("files", row) && closeoutVersionId(row) &&
    (!fileId || closeoutRecordId("files", row) === fileId)).slice(0, 75) ?? [];
  const notice = typeof paramsValue.notice === "string" ? paramsValue.notice : null;
  const error = typeof paramsValue.error === "string" ? paramsValue.error : null;
  return <div className="space-y-6">
    <header><Link href="/closeout" className="text-xs text-adsk-link">← Closeout portfolio</Link>
      <h1 className="mt-2 font-legend text-2xl">{project.name}</h1>
      <p className="mt-1 text-xs text-adsk-gray">{project.id} · {project.status ?? "status unavailable"}</p>
      <p className="mt-2 max-w-3xl text-sm text-adsk-gray">{env.demoMode
        ? "Explore a closeout assessment using fictional documents, assets and work records. This sample is not an Autodesk project or an accepted handover."
        : "The current assessment is recalculated from the latest local evidence. Saved assessments and packages preserve what was reviewed at the time."}</p>
    </header>
    {notice && <p role="status" className="rounded bg-green-50 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm">{error}</p>}
    {assessmentError && <p role="alert" className="rounded bg-red-50 p-3 text-sm">{assessmentError}</p>}
    <Card title="1. Assign turnover profile">
      <p className="text-sm">Current: <strong>{assignedProfile?.name ?? "Unassigned"}</strong></p>
      {admin && <form action={assignProfileAction} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="projectId" value={project.id} />
        <label>Profile<select required name="profileId" defaultValue={assigned?.profileId ?? ""} className="mt-1 block rounded border p-2"><option value="" disabled>Choose profile</option>{profiles.map((profile) =>
          <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <button disabled={!profiles.length} className="rounded bg-adsk-black px-4 py-2 text-white disabled:opacity-40">Assign profile</button>
        <Link href="/closeout/profiles" className="text-adsk-link hover:underline">Manage profiles and deliverables</Link>
      </form>}
      {!admin && <p className="mt-2 text-xs text-adsk-gray">{env.demoMode ? "The sample profile and evidence are read-only." : "Hub Admin access is required to change assignments."}</p>}
    </Card>
    {assignedProfile && <Card title="Expected deliverables register">
      <p className="text-sm text-adsk-gray">Record what the client expects before the source record exists. Use an exact source ID when available, or a name pattern and exact folder. Unmatched expectations stay visible as exceptions.</p>
      {expected.length ? <ul className="mt-3 space-y-1 text-sm">{expected.map((item) => <li key={item.id} className="border-b pb-1">
        <strong>{item.label}</strong> · {item.domain} · {item.projectId ? "project" : "profile"} requirement · ID {item.externalId || "pending"} · pattern {item.namePattern || "—"} · folder {item.folderPath || "—"}
        {item.externalId && <Link className="ml-2 text-adsk-link hover:underline" href={`/closeout/${encodeURIComponent(project.id)}/evidence?domain=${item.domain}&record=${encodeURIComponent(item.externalId)}`}>Inspect evidence →</Link>}
        {admin && <DeliverableEditor item={item} />}
      </li>)}</ul> : <p className="mt-3 text-sm text-adsk-gray">No expected deliverables registered. Readiness stays Unknown.</p>}
      {admin && <form action={addDeliverableAction} className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <input type="hidden" name="profileId" value={assignedProfile.id} /><input type="hidden" name="projectId" value={project.id} />
        <label>Deliverable label<input required name="label" maxLength={160} className="mt-1 block w-full rounded border p-2" /></label>
        <label>Domain<select name="domain" className="mt-1 block w-full rounded border p-2">{assignedProfile.requiredDomains.map((domain) => <option key={domain}>{domain}</option>)}</select></label>
        <label>Exact source record ID, if known<input name="externalId" maxLength={200} className="mt-1 block w-full rounded border p-2" /></label>
        <label>Expected name pattern<input name="namePattern" maxLength={160} className="mt-1 block w-full rounded border p-2" /></label>
        <label>Exact folder path<input name="folderPath" maxLength={300} className="mt-1 block w-full rounded border p-2" /></label>
        <label>Required metadata fields<input name="requiredMetadata" className="mt-1 block w-full rounded border p-2" placeholder="barcode, category_id" /></label>
        <button className="w-fit rounded border px-4 py-2">Add project deliverable</button>
      </form>}
    </Card>}
    <Card title="2. Collect and verify source evidence">
      <p className="text-sm text-adsk-gray">{env.demoMode ? "These sources are fictional examples stored in the demo database. No project evidence is fetched from Autodesk." : "Authenticated APS scans are project scoped. CSV uploads need an explicit Hub Admin statement that the current revision covers this project. Missing, partial, truncated, or mixed evidence stays Unknown."}</p>
      {admin && <form action={refreshEvidenceAction} className="mt-3"><input type="hidden" name="projectId" value={project.id} />
        <button className="rounded bg-adsk-black px-4 py-2 text-sm text-white">Refresh project evidence from APS</button></form>}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Domain</th><th>Source</th><th>Rows</th><th>Coverage</th><th>Collected</th><th>Detail</th></tr></thead><tbody>
        {sources.filter((source) => assigned ? assessment?.profile.requiredDomains.includes(source.domain) ||
          (assessment?.profile.requiredDomains.includes("files") && source.domain === "reviews") : CLOSEOUT_DOMAINS.includes(source.domain)).map((source) =>
          <tr key={source.domain} className="border-b align-top"><td className="py-2 capitalize">{source.domain}</td>
            <td>{env.demoMode ? "Sample data" : source.kind}{source.table ? ` · ${source.table}` : ""}{!source.complete && <span className="block text-amber-800">Incomplete</span>}</td>
            <td>{source.rowCount}</td><td>{env.demoMode ? "Synthetic example" : source.coverage}</td><td>{date(source.collectedAt)}</td><td className="max-w-xs text-xs text-adsk-gray">{env.demoMode ? "Fictional source records; not verified APS evidence." : source.note ?? "—"}
              {admin && source.kind === "user-zip" && source.complete && source.revision && source.coverage !== "attested-upload" &&
                <form action={attestSourceAction} className="mt-2 space-y-1">
                  <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="domain" value={source.domain} />
                  <input type="hidden" name="revision" value={source.revision} />
                  <label>Project coverage note<input required name="note" maxLength={600} placeholder="Confirmed project and extract scope" className="mt-1 block w-full rounded border p-1" /></label>
                  <button className="rounded border px-2 py-1 text-xs">Attest this CSV revision</button>
                </form>}
            </td></tr>)}</tbody></table></div>
    </Card>
    {assigned && <Card title="3. Select final record documents">
      <p className="text-sm text-adsk-gray">{env.demoMode ? "This sample selection illustrates an exact document version and its approval evidence. It contains fictional file metadata and no downloaded Autodesk document." : "Each choice pins an exact Files item, current version, and evidence revision. A binary enters the package only through authenticated APS retrieval of that version. Its approval must be linked to that exact version in Reviews."}</p>
      {assessment?.selections.filter((selection) => selection.domain === "files").length ?
        <ul className="mt-3 space-y-1 text-sm">{assessment.selections.filter((selection) => selection.domain === "files").map((selection) =>
          <li key={selection.id} className="border-b pb-1"><strong>{selection.name}</strong> · item <code>{selection.externalId}</code> · version <code className="break-all">{selection.versionId ?? "missing"}</code>
            {admin && <form action={clearSelectionAction} className="inline-block pl-2"><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="externalId" value={selection.externalId} />
              <button className="text-xs text-red-700 hover:underline">Clear selection</button></form>}</li>)}</ul> :
        <p className="mt-3 text-sm text-adsk-gray">No final record documents selected.</p>}
      {admin && assessment && (assessment.profile.requiredDomains.includes("files") ||
        assessment.profile.rules.files.length > 0 ||
        assessment.profile.rules.assets.some((rule) => rule.requireDocumentRelationship) ||
        assessment.profile.rules.relationships.some((rule) => rule.fromDomain === "files" || rule.toDomain === "files")) && <div className="mt-4">
        <h3 className="font-medium">Current Files candidates</h3>
        <form method="get" className="mt-2 flex flex-wrap items-end gap-2 text-xs">
          <label>Find exact Files item ID<input name="fileId" defaultValue={fileId} maxLength={300} className="mt-1 block min-w-72 rounded border p-2" placeholder="Paste an exact Autodesk item ID" /></label>
          <button className="rounded border px-3 py-2">Find file</button>
          {fileId && <Link href={`/closeout/${encodeURIComponent(project.id)}`} className="pb-2 text-adsk-link hover:underline">Clear search</Link>}
        </form>
        {!fileSource?.complete ? <p className="text-xs text-adsk-gray">Collect a complete Files source before selecting.</p> :
          fileCandidates.length ? <div className="mt-2 max-h-80 overflow-y-auto rounded border"><ul className="divide-y text-sm">
            {fileCandidates.map((row) => { const id = closeoutRecordId("files", row); const version = closeoutVersionId(row); return <li key={`${id}:${version}`} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <span><strong>{String(row.name ?? id)}</strong><span className="block break-all text-xs text-adsk-gray">item {id} · version {version}</span><Link className="text-xs text-adsk-link hover:underline" href={`/closeout/${encodeURIComponent(project.id)}/evidence?domain=files&record=${encodeURIComponent(id)}`}>Inspect evidence →</Link></span>
              <form action={selectRecordAction}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="domain" value="files" />
                <input type="hidden" name="externalId" value={id} /><input type="hidden" name="versionId" value={version} />
                <button className="rounded border px-2 py-1 text-xs">Select final version</button></form>
            </li>; })}
          </ul></div> : <p className="text-xs text-adsk-gray">{fileId ? "No current version matches that exact Files item ID." : "No versioned file candidates in this source."}</p>}
        {!fileId && fileSource && fileSource.rowCount > fileCandidates.length && <p className="mt-2 text-xs text-adsk-gray">Showing the first 75 of {fileSource.rowCount} source rows. Search by exact item ID to select another file.</p>}
      </div>}
    </Card>}
    <Card title="4. Assess and resolve exceptions">
      {!assigned ? <p className="text-sm text-adsk-gray">Assign a profile to calculate readiness.</p> : assessment ? <>
        <div className={`inline-block rounded px-3 py-1 text-sm font-semibold ${statusStyle(assessment.status)}`}>Current: {assessment.status}</div>
        <p className="mt-2 text-sm">{assessment.totals.blockers} blockers · {assessment.totals.unknown} unknown · {assessment.totals.records} project records examined · CSV lineage {assessment.snapshotLineage}</p>
        <p className="mt-1 text-xs text-adsk-gray">Ready requires all required domains, source coverage, registered deliverables, metadata, final selections, and exact file approval evidence to pass.</p>
        {admin && <form action={assessProjectAction} className="mt-3"><input type="hidden" name="projectId" value={project.id} /><button className="rounded border px-3 py-2 text-sm">Save this assessment</button></form>}
        <div className="mt-4 space-y-2">{CLOSEOUT_DOMAINS.map((domain) => {
          const matches = assessment.findings.filter((finding) => finding.domain === domain);
          if (!matches.length) return null;
          return <details key={domain} className="rounded border p-3" open={matches.length < 5}><summary className="cursor-pointer font-medium capitalize">{domain} · {matches.length} findings</summary>
            <ul className="mt-2 space-y-2 text-sm">{matches.map((finding) => <li key={finding.id} className="border-t pt-2"><strong>{finding.kind}: {finding.title}</strong>
              <p>{finding.detail}</p><p className="break-all text-xs text-adsk-gray">Record {finding.recordId ?? "—"} · evidence {finding.evidence}</p>
              <Link className="text-xs text-adsk-link hover:underline" href={`/closeout/${encodeURIComponent(project.id)}/evidence?domain=${domain}${finding.recordId ? `&record=${encodeURIComponent(finding.recordId)}` : ""}`}>Inspect source evidence →</Link></li>)}</ul></details>;
        })}
          {assessment.findings.filter((finding) => finding.domain === "portfolio").map((finding) => <p key={finding.id} className="rounded border p-3 text-sm"><strong>{finding.kind}: {finding.title}</strong><br />{finding.detail}</p>)}
          {assessment.findingOverflow > 0 && <p className="text-sm text-amber-800">{assessment.findingOverflow} more findings are counted but omitted from this screen. Readiness stays nonready.</p>}
        </div>
      </> : <p className="text-sm text-adsk-gray">The assessment is unavailable.</p>}
    </Card>
    <Card title="5. Build package and review history">
      <p className="text-sm text-adsk-gray">{env.demoMode ? "Live Lens can assemble a handover manifest, inventory, exception register and validated file versions. Package generation and Autodesk downloads are disabled in this demo." : "The ZIP contains manifest.json, a CSV and HTML inventory, exception register, and any exact APS file versions that passed download and integrity checks. Missing binaries remain explicit exceptions."}</p>
      {admin && assigned && <form action={buildPackageAction} className="mt-3"><input type="hidden" name="projectId" value={project.id} />
        <button className="rounded bg-adsk-black px-4 py-2 text-sm text-white">Build immutable package</button></form>}
      <h3 className="mt-5 font-medium">Packages</h3>
      {packages.length ? <ul className="mt-2 space-y-1 text-sm">{packages.map((pkg) => <li key={pkg.id}>
        <Link href={`/closeout/packages/${pkg.id}`} className="text-adsk-link hover:underline">{date(pkg.createdAt)} · {pkg.status} · {pkg.id}</Link></li>)}</ul> : <p className="text-sm text-adsk-gray">No packages yet.</p>}
      <h3 className="mt-5 font-medium">Saved assessments</h3>
      {prior.length ? <ul className="mt-2 space-y-1 text-sm">{prior.map((item) => <li key={item.id}>{date(item.createdAt)} · {item.status} · {item.actor}</li>)}</ul> :
        <p className="text-sm text-adsk-gray">No saved assessments yet.</p>}
    </Card>
  </div>;
}
