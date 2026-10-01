import "server-only";

import { fetchProjects } from "./aps/admin";
import type { Session } from "./aps/auth";

/** Compare names consistently before sending asynchronous project-create jobs. */
export function normalizedProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Fetch the entire current APS inventory. A stale local sync must never be
 * treated as proof that a name is available at execution time.
 */
export async function fetchLiveProjectNames(session: Session): Promise<Set<string>> {
  const projects = await fetchProjects(session);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const project of projects) {
    if (typeof project.id !== "string" || !project.id.trim() || ids.has(project.id) ||
      typeof project.name !== "string" || !normalizedProjectName(project.name)) {
      throw new Error("Autodesk returned an incomplete or duplicate project list.");
    }
    ids.add(project.id);
    names.add(normalizedProjectName(project.name));
  }
  return names;
}
