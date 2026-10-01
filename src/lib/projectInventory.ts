import type { ProjectActivityRow } from "./queries";

export const PROJECT_SORTS = [
  { key: "name", label: "Project name · A–Z" },
  { key: "status", label: "Project status · A–Z" },
  { key: "members", label: "Project members · most first" },
  { key: "fewest_members", label: "Project members · fewest first" },
  { key: "recent", label: "Last observed activity · newest first" },
  { key: "oldest_activity", label: "Last observed activity · oldest first" },
  { key: "no_activity", label: "No observed activity · first" },
  { key: "events", label: "Activity events · most first" },
  { key: "actors", label: "Active people (observed) · most first" },
  { key: "services", label: "Observed services · most first" },
  { key: "sheets", label: "Sheet count · most first" },
] as const;

export type ProjectSort = typeof PROJECT_SORTS[number]["key"];

export function projectSort(value: unknown): ProjectSort {
  return typeof value === "string" && PROJECT_SORTS.some((sort) => sort.key === value)
    ? value as ProjectSort : "name";
}

function numeric(a: number | null, b: number | null, ascending = false): number {
  // Unknown membership/coverage is never treated as zero or as evidence of inactivity.
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
}

function serviceCount(services: string | null): number {
  return new Set((services ?? "").split(",").map((value) => value.trim()).filter(Boolean)).size;
}

export function sortProjectInventory(rows: ProjectActivityRow[], sort: ProjectSort): ProjectActivityRow[] {
  return [...rows].sort((a, b) => {
    let order = 0;
    switch (sort) {
      case "status":
        order = a.status === null ? (b.status === null ? 0 : 1)
          : b.status === null ? -1 : a.status.localeCompare(b.status);
        break;
      case "members": order = numeric(a.memberCount, b.memberCount); break;
      case "fewest_members": order = numeric(a.memberCount, b.memberCount, true); break;
      case "recent": order = numeric(a.lastEventMs, b.lastEventMs); break;
      case "oldest_activity": order = numeric(a.lastEventMs, b.lastEventMs, true); break;
      case "no_activity": order = Number(b.events === 0) - Number(a.events === 0); break;
      case "events": order = b.events - a.events; break;
      case "actors": order = b.actors - a.actors; break;
      case "services": order = serviceCount(b.services) - serviceCount(a.services); break;
      case "sheets": order = numeric(a.sheetCount, b.sheetCount); break;
    }
    return order || a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId);
  });
}
