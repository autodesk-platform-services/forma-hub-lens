import { demoTableRows } from "./demoData";
import type { DocsFolder, FolderPermission } from "./permissions";

/** Synthetic folder assignments derived from the same sample project/member IDs as the demo. */
function folders(projectId: string): DocsFolder[] {
  const exists = demoTableRows("admin_projects").some((row) => row.id === projectId);
  if (!exists) return [];
  const root = `sample.${projectId}.root`;
  return [
    { id: root, name: "Project Files", parentId: null },
    { id: `sample.${projectId}.shared`, name: "Shared", parentId: root },
    { id: `sample.${projectId}.restricted`, name: "Restricted", parentId: root },
    { id: `sample.${projectId}.published`, name: "Published", parentId: root },
  ];
}

export function demoTopFolders(projectId: string): DocsFolder[] {
  return folders(projectId).slice(0, 1);
}

export function demoFolderDetails(projectId: string, folderId: string): DocsFolder | null {
  return folders(projectId).find((folder) => folder.id === folderId) ?? null;
}

export function demoChildFolders(projectId: string, folderId: string): DocsFolder[] {
  return folders(projectId).filter((folder) => folder.parentId === folderId);
}

export function demoFolderPermissions(projectId: string, folderId: string): FolderPermission[] {
  const folder = demoFolderDetails(projectId, folderId);
  if (!folder) return [];
  const variant = folder.id.split(".").at(-1);
  const members = new Map<string, { admin: boolean }>();
  for (const row of demoTableRows("admin_project_users")) {
    if (row.bim360_project_id !== projectId) continue;
    const id = String(row.user_id ?? "").trim();
    if (!id) continue;
    const prior = members.get(id);
    members.set(id, { admin: Boolean(prior?.admin || row.access_level === "admin") });
  }

  return [...members].sort(([a], [b]) => a.localeCompare(b)).flatMap(([subjectId, member], index) => {
    if (variant === "restricted" && !member.admin) return [];
    const actions = variant === "published" ? ["read"]
      : member.admin ? ["read", "write", "manage"]
      : variant === "shared" && index % 2 === 0 ? ["read", "write"]
      : ["read"];
    const raw = {
      source: "synthetic-demo",
      folderId,
      subjectType: "user",
      subjectId,
      actions,
      inherited: false,
    };
    return [{
      subjectType: "user", subjectId, actions, inherited: false,
      comparable: true, parseIssue: null, raw,
    }];
  });
}
