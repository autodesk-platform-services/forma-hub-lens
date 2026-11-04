import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { ApsError } from "@/lib/aps/client";
import { cachedProjects } from "@/lib/aps/admin";
import { fetchCompanies } from "@/lib/aps/hubAdmin";
import { permissionSubjectIdentities, type SubjectIdentity } from "@/lib/entityProfiles";
import { configProblems, env } from "@/lib/env";
import { demoChildFolders, demoFolderDetails, demoFolderPermissions, demoTopFolders } from "@/lib/demoPermissions";
import {
  childFolders,
  diffPermissionAssignments,
  folderDetails,
  folderPermissions,
  topFolders,
  type DocsFolder,
  type FolderPermission,
} from "@/lib/permissions";
import { Card, EmptyState, Pill } from "@/components/ui";
import { CopyIdButton } from "@/components/CopyIdButton";
import { SetupRequired, SignInRequired } from "@/components/Gate";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function folderHref(projectId: string, folderId: string, compareProjectId = "", compareFolderId = ""): string {
  const query = new URLSearchParams({ project: projectId, folder: folderId });
  if (compareProjectId) query.set("compareProject", compareProjectId);
  if (compareFolderId) query.set("compareFolder", compareFolderId);
  return `/permissions?${query.toString()}`;
}

function comparisonHref(projectId: string, folderId: string, compareProjectId: string, compareFolderId: string): string {
  return folderHref(projectId, folderId, compareProjectId, compareFolderId);
}

function actionSetsText(sets: string[][]): string {
  if (!sets.length) return "—";
  return sets.map((actions) => actions.length ? actions.join(", ") : "(no actions)").join(" | ");
}

function failure(error: unknown): string {
  if (error instanceof ApsError) {
    if (error.status === 401 || error.status === 403) {
      return "Autodesk did not grant this account access to the requested Docs folder.";
    }
    if (error.status === 404) return "Autodesk could not find this Docs folder.";
    return `Autodesk returned ${error.status} for this request.`;
  }
  return error instanceof Error ? error.message : "Could not load folder data.";
}

export default async function PermissionsPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;

  const session = await getSession();
  if (!session) return <SignInRequired />;

  const demoMode = env.demoMode;
  const projects = cachedProjects();
  const query = await searchParams;
  const projectId = first(query.project);
  const folderId = first(query.folder);
  const compareProjectId = first(query.compareProject);
  const compareFolderId = first(query.compareFolder);
  const project = projects.find((item) => item.id === projectId);
  const compareProject = projects.find((item) => item.id === compareProjectId);
  const validFolderId = folderId.length === 0 || /^[A-Za-z0-9:._-]{1,256}$/.test(folderId);
  const validCompareFolderId = compareFolderId.length === 0 || /^[A-Za-z0-9:._-]{1,256}$/.test(compareFolderId);

  let roots: DocsFolder[] = [];
  let rootError: string | null = null;
  let selected: DocsFolder | null = null;
  let children: DocsFolder[] = [];
  let permissions: FolderPermission[] = [];
  let folderError: string | null = null;
  let childrenError: string | null = null;
  let permissionsError: string | null = null;
  let compareRoots: DocsFolder[] = [];
  let compareSelected: DocsFolder | null = null;
  let compareChildren: DocsFolder[] = [];
  let comparePermissions: FolderPermission[] = [];
  let compareRootError: string | null = null;
  let compareFolderError: string | null = null;
  let compareChildrenError: string | null = null;
  let comparePermissionsError: string | null = null;

  if (project && demoMode) {
    roots = demoTopFolders(project.id);
    if (folderId && validFolderId) {
      selected = demoFolderDetails(project.id, folderId);
      if (selected) {
        children = demoChildFolders(project.id, folderId);
        permissions = demoFolderPermissions(project.id, folderId);
      } else folderError = "This sample folder is not in the selected project.";
    }
    if (compareProject && folderId && validFolderId) {
      compareRoots = demoTopFolders(compareProject.id);
      if (compareFolderId && validCompareFolderId) {
        compareSelected = demoFolderDetails(compareProject.id, compareFolderId);
        if (compareSelected) {
          compareChildren = demoChildFolders(compareProject.id, compareFolderId);
          comparePermissions = demoFolderPermissions(compareProject.id, compareFolderId);
        } else compareFolderError = "This sample folder is not in the comparison project.";
      }
    }
  } else if (project) {
    const sourceRequest = Promise.allSettled([
      topFolders(session, project.id),
      folderId && validFolderId ? folderDetails(session, project.id, folderId) : Promise.resolve(null),
      folderId && validFolderId ? childFolders(session, project.id, folderId) : Promise.resolve([]),
      folderId && validFolderId ? folderPermissions(session, project.id, folderId) : Promise.resolve([]),
    ]);
    const comparisonRequest = compareProject && folderId && validFolderId
      ? Promise.allSettled([
          topFolders(session, compareProject.id),
          compareFolderId && validCompareFolderId ? folderDetails(session, compareProject.id, compareFolderId) : Promise.resolve(null),
          compareFolderId && validCompareFolderId ? childFolders(session, compareProject.id, compareFolderId) : Promise.resolve([]),
          compareFolderId && validCompareFolderId ? folderPermissions(session, compareProject.id, compareFolderId) : Promise.resolve([]),
        ])
      : Promise.resolve(null);
    const [result, comparison] = await Promise.all([sourceRequest, comparisonRequest]);
    if (result[0].status === "fulfilled") roots = result[0].value;
    else rootError = failure(result[0].reason);
    if (result[1].status === "fulfilled") selected = result[1].value;
    else folderError = failure(result[1].reason);
    if (result[2].status === "fulfilled") children = result[2].value;
    else childrenError = failure(result[2].reason);
    if (result[3].status === "fulfilled") permissions = result[3].value;
    else permissionsError = failure(result[3].reason);
    if (comparison) {
      if (comparison[0].status === "fulfilled") compareRoots = comparison[0].value;
      else compareRootError = failure(comparison[0].reason);
      if (comparison[1].status === "fulfilled") compareSelected = comparison[1].value;
      else compareFolderError = failure(comparison[1].reason);
      if (comparison[2].status === "fulfilled") compareChildren = comparison[2].value;
      else compareChildrenError = failure(comparison[2].reason);
      if (comparison[3].status === "fulfilled") comparePermissions = comparison[3].value;
      else comparePermissionsError = failure(comparison[3].reason);
    }
  }
  const diff = project && compareProject && selected && compareSelected && folderId && validFolderId && compareFolderId && validCompareFolderId &&
    !permissionsError && !comparePermissionsError
    ? diffPermissionAssignments(permissions, comparePermissions) : null;
  const subjects = [...permissions, ...comparePermissions];
  const companySubjects = subjects.some((entry) => entry.subjectType.toLowerCase().includes("company"));
  const companies = !demoMode && companySubjects ? await fetchCompanies(session).catch(() => []) : [];
  const identities = permissionSubjectIdentities(subjects, companies);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Docs permissions</h1>
        <p className="mt-0.5 text-xs text-adsk-gray">
          {demoMode
            ? "Explore synthetic Docs folders and assignment records across sample projects. This does not calculate effective access or query Autodesk Docs."
            : "Inspect folder permission assignments across projects. Autodesk controls which folders your account can see."}
        </p>
      </div>

      <Card title="Choose a project">
        {projects.length === 0 ? (
          <EmptyState title={demoMode ? "No sample projects are available." : "No projects synced yet."}>
            <p>{demoMode ? "The demo owner can restore the synthetic data set." : <>Sync projects from the <Link href="/projects" className="text-adsk-link hover:underline">Projects</Link> tab first.</>}</p>
          </EmptyState>
        ) : (
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label htmlFor="permissions-project" className="block text-[11px] font-medium uppercase tracking-wide text-adsk-gray">
                Project
              </label>
              <select
                id="permissions-project"
                name="project"
                defaultValue={project?.id ?? ""}
                className="mt-1 w-full rounded border border-adsk-lightgray bg-adsk-offwhite px-2.5 py-1.5 text-xs text-adsk-black focus:border-adsk-yellow focus:outline-none"
              >
                <option value="">Select a project</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black hover:opacity-90">
              Open folders
            </button>
          </form>
        )}
      </Card>

      {projectId && !project && (
        <Card><EmptyState title={demoMode ? "Project not found in the sample hub." : "Project not found in the synced hub list."} /></Card>
      )}

      {project && (
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]">
          <Card title="Folders" subtitle={project.name}>
            <Link href={`/projects/${encodeURIComponent(project.id)}`} className="mb-3 inline-block text-xs text-adsk-link hover:underline">Open project profile →</Link>
            {rootError && <p role="alert" className="text-xs text-adsk-linkvisited">{rootError}</p>}
            {!rootError && roots.length === 0 && <p className="text-xs text-adsk-gray">{demoMode ? "No sample Docs folders are available for this project." : "No accessible Docs folders were returned."}</p>}
            <ul className="space-y-1">
              {roots.map((folder) => (
                <li key={folder.id}>
                  <Link
                    href={folderHref(project.id, folder.id, compareProjectId, compareFolderId)}
                    className={`block rounded px-2 py-1.5 text-xs hover:bg-adsk-offwhite ${folder.id === folderId ? "bg-adsk-yellow/20 font-medium text-adsk-black" : "text-adsk-black"}`}
                  >
                    {folder.name}
                  </Link>
                </li>
              ))}
            </ul>
            {selected && (
              <div className="mt-4 border-t border-adsk-lightgray pt-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-adsk-gray">Current folder</div>
                <div className="text-xs font-medium text-adsk-black">{selected.name}</div>
                {selected.parentId && (
                  <Link href={folderHref(project.id, selected.parentId, compareProjectId, compareFolderId)} className="mt-1 inline-block text-xs text-adsk-link hover:underline">
                    ← Parent folder
                  </Link>
                )}
              </div>
            )}
            {folderId && !validFolderId && <p role="alert" className="mt-3 text-xs text-adsk-linkvisited">Invalid folder ID.</p>}
            {folderError && <p role="alert" className="mt-3 text-xs text-adsk-linkvisited">{folderError}</p>}
            {folderId && validFolderId && (
              <div className="mt-4 border-t border-adsk-lightgray pt-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-adsk-gray">Subfolders</div>
                {childrenError ? (
                  <p role="alert" className="text-xs text-adsk-linkvisited">{childrenError}</p>
                ) : children.length === 0 ? (
                  <p className="text-xs text-adsk-gray">No subfolders returned.</p>
                ) : (
                  <ul className="space-y-1">
                    {children.map((folder) => (
                      <li key={folder.id}>
                        <Link href={folderHref(project.id, folder.id, compareProjectId, compareFolderId)} className="block rounded px-2 py-1.5 text-xs text-adsk-black hover:bg-adsk-offwhite">
                          {folder.name} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card
              title="Permission assignments"
              subtitle={selected ? `${selected.name} · ${permissions.length} returned` : "Select a folder to inspect"}
            >
              {!folderId || !validFolderId ? (
                <EmptyState title="Select a Docs folder on the left." />
              ) : permissionsError ? (
                <p role="alert" className="text-xs text-adsk-linkvisited">{permissionsError}</p>
              ) : permissions.length === 0 ? (
                <EmptyState title="No permission assignments returned for this folder." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
                      <tr className="border-b border-adsk-lightgray">
                        <th className="py-2 pr-3 font-medium">Subject</th>
                        <th className="py-2 pr-3 font-medium">Actions</th>
                        <th className="py-2 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {permissions.map((item, index) => (
                        <tr key={`${item.subjectType}:${item.subjectId}:${index}`} className="border-b border-adsk-offwhite align-top">
                          <td className="py-2 pr-3">
                            <Pill>{item.subjectType}</Pill>
                            <SubjectLabel subjectType={item.subjectType} identity={identities.get(`${item.subjectType}:${item.subjectId}`)} />
                            <div className="mt-1 break-all font-mono text-[10px] text-adsk-gray">{item.subjectId}<CopyIdButton value={item.subjectId} /></div>
                          </td>
                          <td className="py-2 pr-3 text-adsk-black">{item.actions.length ? item.actions.join(", ") : "—"}</td>
                          <td className="py-2 text-adsk-gray">
                            {item.inherited === true ? "Inherited" : item.inherited === false ? "Direct" : "Not specified"}
                            {item.parseIssue && <div className="mt-1 text-[10px] text-adsk-linkvisited">Excluded from diff: {item.parseIssue}</div>}
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[10px] text-adsk-link">{demoMode ? "Sample entry" : "API entry"}</summary>
                              <pre className="mt-1 max-w-[28rem] overflow-x-auto rounded bg-adsk-offwhite p-2 text-[10px] text-adsk-black">{JSON.stringify(item.raw, null, 2)}</pre>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            {folderId && validFolderId && <Card title="Compare folder assignments" subtitle="Select a second Docs folder in this project or another synced project">
              <form method="get" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="project" value={project.id} />
                <input type="hidden" name="folder" value={folderId} />
                <label htmlFor="permissions-compare-project" className="min-w-64 flex-1 text-[11px] font-medium uppercase tracking-wide text-adsk-gray">Comparison project
                  <select id="permissions-compare-project" name="compareProject" defaultValue={compareProject?.id ?? ""} className="mt-1 block w-full rounded border border-adsk-lightgray bg-adsk-offwhite px-2.5 py-1.5 text-xs text-adsk-black">
                    <option value="">Select a project</option>
                    {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <button type="submit" className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 text-xs font-medium text-adsk-black">Browse folders</button>
              </form>
              {compareProjectId && !compareProject && <p role="alert" className="mt-3 text-xs text-adsk-linkvisited">Comparison project is not in the synced hub list.</p>}
              {compareProject && <div className="mt-4 border-t border-adsk-lightgray pt-3">
                <p className="text-xs font-medium text-adsk-black">{compareProject.name}</p>
                {compareRootError && <p role="alert" className="mt-2 text-xs text-adsk-linkvisited">{compareRootError}</p>}
                {!compareRootError && compareRoots.length === 0 && <p className="mt-2 text-xs text-adsk-gray">{demoMode ? "No sample top folders are available." : "No accessible top folders were returned."}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {compareRoots.map((folder) => <Link key={folder.id} href={comparisonHref(project.id, folderId, compareProject.id, folder.id)} className={`rounded border border-adsk-lightgray px-2 py-1 text-xs hover:bg-adsk-offwhite ${folder.id === compareFolderId ? "bg-adsk-yellow/20 font-medium" : ""}`}>{folder.name}</Link>)}
                </div>
                {compareFolderId && !validCompareFolderId && <p role="alert" className="mt-2 text-xs text-adsk-linkvisited">Invalid comparison folder ID.</p>}
                {compareFolderError && <p role="alert" className="mt-2 text-xs text-adsk-linkvisited">{compareFolderError}</p>}
                {compareSelected && <div className="mt-3 rounded border border-adsk-lightgray p-3 text-xs">
                  <p className="font-medium text-adsk-black">Selected: {compareSelected.name}</p>
                  {compareSelected.parentId && <Link href={comparisonHref(project.id, folderId, compareProject.id, compareSelected.parentId)} className="mt-1 inline-block text-adsk-link hover:underline">← Parent folder</Link>}
                  <p className="mt-2 text-adsk-gray">Subfolders</p>
                  {compareChildrenError ? <p role="alert" className="text-adsk-linkvisited">{compareChildrenError}</p> : compareChildren.length ? <div className="mt-1 flex flex-wrap gap-1.5">{compareChildren.map((folder) => <Link key={folder.id} href={comparisonHref(project.id, folderId, compareProject.id, folder.id)} className="rounded border border-adsk-lightgray px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">{folder.name} →</Link>)}</div> : <p className="mt-1 text-adsk-gray">No subfolders returned.</p>}
                </div>}
                {comparePermissionsError && <p role="alert" className="mt-2 text-xs text-adsk-linkvisited">{comparePermissionsError}</p>}
              </div>}
              {diff && <div className="mt-4 border-t border-adsk-lightgray pt-3">
                <p className="text-xs text-adsk-gray">{diff.differences.length} assignment difference(s) · {diff.unchangedSubjects} unchanged subject(s) · {permissions.length} and {comparePermissions.length} records returned</p>
                {(diff.skippedLeft > 0 || diff.skippedRight > 0) && <p role="alert" className="mt-2 text-xs text-adsk-linkvisited">{diff.skippedLeft} source and {diff.skippedRight} comparison record(s) lacked usable subject IDs or actions and were excluded from this diff. Inspect their {demoMode ? "sample" : "API"} entries.</p>}
                {diff.differences.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wide text-adsk-gray"><tr className="border-b border-adsk-lightgray"><th className="py-2 pr-3 font-medium">Subject</th><th className="py-2 pr-3 font-medium">Source actions</th><th className="py-2 pr-3 font-medium">Comparison actions</th><th className="py-2 font-medium">Assignment difference</th></tr></thead>
                  <tbody>{diff.differences.map((row) => <tr key={`${row.subjectType}:${row.subjectId}`} className="border-b border-adsk-offwhite align-top">
                    <td className="py-2 pr-3"><Pill>{row.subjectType}</Pill><SubjectLabel subjectType={row.subjectType} identity={identities.get(`${row.subjectType}:${row.subjectId}`)} /><div className="mt-1 break-all font-mono text-[10px] text-adsk-gray">{row.subjectId}<CopyIdButton value={row.subjectId} /></div></td>
                    <td className="py-2 pr-3">{actionSetsText(row.leftActionSets)}</td>
                    <td className="py-2 pr-3">{actionSetsText(row.rightActionSets)}</td>
                    <td className="py-2">{row.kind === "only-left" ? "Only in source" : row.kind === "only-right" ? "Only in comparison" : row.kind === "changed" ? "Actions differ" : "Multiple records; inspect raw assignments"}</td>
                  </tr>)}</tbody>
                </table></div> : <p className="mt-3 text-xs text-adsk-gray">No comparable assignment differences were found.</p>}
                <p className="mt-3 text-xs text-adsk-gray">This compares returned subject type, subject ID, and action sets. Action order is ignored. It does not compare inheritance or calculate effective access; a person may receive permissions from a role, company, parent folder, or Project Admin status.</p>
              </div>}
            </Card>}
            <p className="text-xs leading-relaxed text-adsk-gray">
              {demoMode ? "These are synthetic assignment records for a sample folder." : "These are the assignments returned for a folder."} A person may also receive access through a role, company, parent folder, or Project Admin status. Lens does not calculate a person’s effective Docs access here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function SubjectLabel({ subjectType, identity }: { subjectType: string; identity: SubjectIdentity | undefined }) {
  if (!identity) {
    const type = subjectType.toLowerCase();
    const label = type.includes("user") ? "Unknown user" : type.includes("role") ? "Unknown role"
      : type.includes("company") ? "Unknown company" : "Unknown subject";
    return <div className="mt-1 font-medium text-adsk-gray">{label}</div>;
  }
  return <>
    {identity.href
      ? <Link href={identity.href} className="mt-1 block font-medium text-adsk-link hover:underline">{identity.name}</Link>
      : <div className="mt-1 font-medium text-adsk-black">{identity.name}</div>}
    {identity.detail && identity.detail !== identity.name && <div className="text-[11px] text-adsk-gray">{identity.detail}</div>}
  </>;
}
