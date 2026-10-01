import "server-only";

import { env } from "./env";
import type { Session } from "./aps/auth";
import { apsFetch } from "./aps/client";

/**
 * Read-only Docs folder permission explorer.
 *
 * Data Management IDs have a `b.` prefix; Forma Admin IDs do not. The Docs
 * permission API uses the latter. These are assignment records returned by
 * Autodesk, not a computed effective-access decision for a particular user.
 */

export type DocsFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type FolderPermission = {
  subjectId: string;
  subjectType: string;
  actions: string[];
  inherited: boolean | null;
  comparable: boolean;
  parseIssue: string | null;
  raw: Record<string, unknown>;
};

export type PermissionDifference = {
  subjectType: string;
  subjectId: string;
  kind: "only-left" | "only-right" | "changed" | "ambiguous";
  leftActionSets: string[][];
  rightActionSets: string[][];
};

export type PermissionAssignmentDiff = {
  differences: PermissionDifference[];
  unchangedSubjects: number;
  skippedLeft: number;
  skippedRight: number;
};

type JsonApiFolder = {
  type?: unknown;
  id?: unknown;
  attributes?: { name?: unknown; displayName?: unknown };
  relationships?: { parent?: { data?: { id?: unknown } } };
};

type FolderResponse = {
  data?: JsonApiFolder[];
  links?: { next?: string | { href?: string } | null };
};

function dmId(id: string): string {
  return id.startsWith("b.") ? id : `b.${id}`;
}

function folderOf(value: JsonApiFolder): DocsFolder | null {
  if (value.type !== "folders" || typeof value.id !== "string") return null;
  const name = value.attributes?.displayName ?? value.attributes?.name;
  return {
    id: value.id,
    name: typeof name === "string" && name.trim() ? name : value.id,
    parentId: typeof value.relationships?.parent?.data?.id === "string"
      ? value.relationships.parent.data.id
      : null,
  };
}

function parseFolderResponse(body: FolderResponse): DocsFolder[] {
  if (!Array.isArray(body.data)) throw new Error("Autodesk returned an unreadable folder list.");
  return body.data.map(folderOf).filter((folder): folder is DocsFolder => folder !== null);
}

/** Highest folders visible to the signed-in user in this project. */
export async function topFolders(session: Session, projectId: string): Promise<DocsFolder[]> {
  const project = encodeURIComponent(dmId(projectId));
  const hub = encodeURIComponent(dmId(env.hubId));
  const body = await apsFetch<FolderResponse>(
    session,
    `/project/v1/hubs/${hub}/projects/${project}/topFolders`,
  );
  return parseFolderResponse(body);
}

/** Name and parent of one folder, used to navigate back up the tree. */
export async function folderDetails(
  session: Session,
  projectId: string,
  folderId: string,
): Promise<DocsFolder> {
  const project = encodeURIComponent(dmId(projectId));
  const folder = encodeURIComponent(folderId);
  const body = await apsFetch<{ data?: JsonApiFolder }>(
    session,
    `/data/v1/projects/${project}/folders/${folder}`,
  );
  const result = body.data && folderOf(body.data);
  if (!result) throw new Error("Autodesk returned an unreadable folder.");
  return result;
}

/** Immediate child folders only. Files are excluded from this explorer. */
export async function childFolders(
  session: Session,
  projectId: string,
  folderId: string,
): Promise<DocsFolder[]> {
  const project = encodeURIComponent(dmId(projectId));
  const folder = encodeURIComponent(folderId);
  const basePath = `/data/v1/projects/${project}/folders/${folder}/contents`;
  const seen = new Set<string>();
  const folders: DocsFolder[] = [];
  let path: string | null = basePath;

  // Data Management may paginate folder contents. Follow only same-origin links
  // for this exact collection, avoiding a token-bearing fetch to another host.
  for (let page = 0; path && page < 30; page++) {
    if (seen.has(path)) throw new Error("Autodesk repeated a folder page link.");
    seen.add(path);
    const body: FolderResponse = await apsFetch<FolderResponse>(session, path);
    folders.push(...parseFolderResponse(body));
    const next = typeof body.links?.next === "string"
      ? body.links.next
      : body.links?.next?.href;
    if (!next) return folders;
    const url: URL = new URL(next, `https://developer.api.autodesk.com${path}`);
    if (
      url.origin !== "https://developer.api.autodesk.com" ||
      decodeURIComponent(url.pathname) !== decodeURIComponent(basePath)
    ) {
      throw new Error("Autodesk returned an unexpected folder page link.");
    }
    path = `${url.pathname}${url.search}`;
  }
  throw new Error("Folder listing exceeded the page limit. Narrow to a child folder.");
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Parse only assignments explicitly returned by Autodesk. */
export function parseFolderPermissions(body: unknown): FolderPermission[] {
  const wrapper = object(body);
  const entries = Array.isArray(body)
    ? body
    : Array.isArray(wrapper?.results)
      ? wrapper.results
      : Array.isArray(wrapper?.data)
        ? wrapper.data
        : Array.isArray(wrapper?.permissions)
          ? wrapper.permissions
          : null;
  if (!entries) throw new Error("Autodesk returned a permissions response Lens could not parse.");

  return entries.map((value) => {
    const raw = object(value);
    if (!raw) throw new Error("Autodesk returned an unreadable permission entry.");
    const attributes = object(raw.attributes);
    const fields = { ...raw, ...attributes };
    const subjectId = typeof fields.subjectId === "string" ? fields.subjectId.trim() : "";
    const subjectType = typeof fields.subjectType === "string" ? fields.subjectType.trim() : "";
    const validActions = Array.isArray(fields.actions) &&
      fields.actions.every((action) => typeof action === "string" && action.trim().length > 0);
    const parseIssue = !subjectType || !subjectId
      ? "Missing subject type or ID."
      : !validActions ? "Actions are missing or unreadable." : null;
    return {
      subjectId: subjectId || "—",
      subjectType: subjectType || "Unknown",
      actions: validActions ? (fields.actions as string[]).map((action) => action.trim()) : [],
      inherited: typeof fields.inherited === "boolean" ? fields.inherited : null,
      comparable: parseIssue === null,
      parseIssue,
      raw,
    };
  });
}

function canonicalActions(actions: string[]): string[] {
  return [...new Set(actions.map((action) => action.trim()))].sort((a, b) => a.localeCompare(b));
}

function assignmentsBySubject(rows: FolderPermission[]): Map<string, {
  subjectType: string;
  subjectId: string;
  actionSets: string[][];
}> {
  const grouped = new Map<string, { subjectType: string; subjectId: string; actionSets: string[][] }>();
  for (const row of rows) {
    if (!row.comparable) continue;
    const key = `${row.subjectType}\u0000${row.subjectId}`;
    const entry = grouped.get(key) ?? { subjectType: row.subjectType, subjectId: row.subjectId, actionSets: [] };
    entry.actionSets.push(canonicalActions(row.actions));
    grouped.set(key, entry);
  }
  return grouped;
}

/** Compares returned assignment records. It does not compute effective access. */
export function diffPermissionAssignments(
  left: FolderPermission[],
  right: FolderPermission[],
): PermissionAssignmentDiff {
  const leftBySubject = assignmentsBySubject(left);
  const rightBySubject = assignmentsBySubject(right);
  const keys = new Set([...leftBySubject.keys(), ...rightBySubject.keys()]);
  const differences: PermissionDifference[] = [];
  let unchangedSubjects = 0;
  for (const key of keys) {
    const before = leftBySubject.get(key);
    const after = rightBySubject.get(key);
    const leftActionSets = before?.actionSets ?? [];
    const rightActionSets = after?.actionSets ?? [];
    const subject = before ?? after!;
    if (!before || !after) {
      differences.push({ subjectType: subject.subjectType, subjectId: subject.subjectId,
        kind: before ? "only-left" : "only-right", leftActionSets, rightActionSets });
      continue;
    }
    // One record per subject gives a clear action change. Multiple records can
    // be direct/inherited or API-specific variants; expose them as ambiguous.
    if (leftActionSets.length !== 1 || rightActionSets.length !== 1) {
      const signature = (sets: string[][]) => sets.map((actions) => JSON.stringify(actions)).sort().join("\u0000");
      if (signature(leftActionSets) === signature(rightActionSets)) unchangedSubjects++;
      else differences.push({ subjectType: subject.subjectType, subjectId: subject.subjectId,
        kind: "ambiguous", leftActionSets, rightActionSets });
      continue;
    }
    if (JSON.stringify(leftActionSets[0]) === JSON.stringify(rightActionSets[0])) unchangedSubjects++;
    else differences.push({ subjectType: subject.subjectType, subjectId: subject.subjectId,
      kind: "changed", leftActionSets, rightActionSets });
  }
  differences.sort((a, b) => a.subjectType.localeCompare(b.subjectType) || a.subjectId.localeCompare(b.subjectId));
  return {
    differences,
    unchangedSubjects,
    skippedLeft: left.filter((row) => !row.comparable).length,
    skippedRight: right.filter((row) => !row.comparable).length,
  };
}

/** Read Autodesk's permission assignments for one Docs folder. */
export async function folderPermissions(
  session: Session,
  projectId: string,
  folderId: string,
): Promise<FolderPermission[]> {
  const project = encodeURIComponent(projectId.replace(/^b\./, ""));
  const folder = encodeURIComponent(folderId);
  const body = await apsFetch<unknown>(
    session,
    `/bim360/docs/v1/projects/${project}/folders/${folder}/permissions`,
  );
  return parseFolderPermissions(body);
}
