import "server-only";

import { listAccessMatrix, peopleSourceStatus, PEOPLE_PAGE_SIZE, type MatrixRow } from "./people";

const MAX_MEMBERSHIP_ROWS_PER_PERSON = 5_000;

export type AccessRecord = {
  membershipStatus: string | null;
  accessLevel: string | null;
  products: MatrixRow["products"];
  ambiguous: boolean;
};

export type ProjectComparison = {
  projectId: string;
  projectName: string | null;
  first: AccessRecord | null;
  second: AccessRecord | null;
  result: "same" | "different" | "unknown";
  differences: string[];
};

export type PersonAccessComparison =
  | { state: "unavailable"; reason: string }
  | {
      state: "ready";
      shared: ProjectComparison[];
      onlyFirst: ProjectComparison[];
      onlySecond: ProjectComparison[];
      warnings: string[];
      importedAt: number | null;
      coverageComplete: boolean;
    };

function rowsForUser(id: string): MatrixRow[] | null {
  const first = listAccessMatrix({ userId: id, page: 1 });
  if (first.total > MAX_MEMBERSHIP_ROWS_PER_PERSON) return null;
  const rows = [...first.rows];
  const pages = Math.ceil(first.total / PEOPLE_PAGE_SIZE);
  for (let page = 2; page <= pages; page++) {
    const next = listAccessMatrix({ userId: id, page });
    if (next.total !== first.total || next.page !== page) return null;
    rows.push(...next.rows);
  }
  return rows.length === first.total ? rows : null;
}

function byProject(rows: MatrixRow[]): { projects: Map<string, MatrixRow[]>; missingId: number } {
  const projects = new Map<string, MatrixRow[]>();
  let missingId = 0;
  for (const row of rows) {
    if (!row.projectId) {
      missingId++;
      continue;
    }
    projects.set(row.projectId, [...(projects.get(row.projectId) ?? []), row]);
  }
  return { projects, missingId };
}

function record(rows: MatrixRow[] | undefined): AccessRecord | null {
  if (!rows?.length) return null;
  if (rows.length > 1) {
    return { membershipStatus: null, accessLevel: null, products: null, ambiguous: true };
  }
  return {
    membershipStatus: rows[0].membershipStatus,
    accessLevel: rows[0].accessLevel,
    products: rows[0].products,
    ambiguous: false,
  };
}

function compareShared(first: AccessRecord, second: AccessRecord): Pick<ProjectComparison, "result" | "differences"> {
  if (first.ambiguous || second.ambiguous) return { result: "unknown", differences: [] };
  const differences: string[] = [];
  let unknown = false;
  for (const [label, firstValue, secondValue] of [
    ["Membership status", first.membershipStatus, second.membershipStatus],
    ["Access level", first.accessLevel, second.accessLevel],
  ] as const) {
    if (firstValue === null || secondValue === null) unknown = true;
    else if (firstValue !== secondValue) differences.push(label);
  }
  if (first.products === null || second.products === null) unknown = true;
  else {
    const firstKeys = new Set(first.products.map((product) => product.key));
    const secondKeys = new Set(second.products.map((product) => product.key));
    let productDifference = firstKeys.size !== secondKeys.size || [...firstKeys].some((key) => !secondKeys.has(key));
    for (const key of firstKeys) {
      if (!secondKeys.has(key)) continue;
      const firstAccess = [...new Set(first.products.filter((product) => product.key === key).map((product) => product.access))];
      const secondAccess = [...new Set(second.products.filter((product) => product.key === key).map((product) => product.access))];
      if (firstAccess.length !== 1 || secondAccess.length !== 1 || firstAccess[0] === null || secondAccess[0] === null) unknown = true;
      else if (firstAccess[0] !== secondAccess[0]) productDifference = true;
    }
    if (productDifference) differences.push("Products");
  }
  return { result: differences.length ? "different" : unknown ? "unknown" : "same", differences };
}

/** Compare only exact user and project IDs in the locally uploaded snapshot. */
export function comparePersonAccess(firstUserId: string, secondUserId: string): PersonAccessComparison {
  if (!firstUserId || !secondUserId || firstUserId === secondUserId || firstUserId.length > 200 || secondUserId.length > 200) {
    return { state: "unavailable", reason: "Choose two different source user IDs." };
  }
  const source = peopleSourceStatus();
  if (!source.matrixReady) {
    return { state: "unavailable", reason: "The uploaded admin_project_users.csv lacks usable user and project ID columns." };
  }
  const firstRows = rowsForUser(firstUserId);
  const secondRows = rowsForUser(secondUserId);
  if (!firstRows || !secondRows) {
    return { state: "unavailable", reason: "Membership data changed during comparison or exceeds the 5,000-row per-person display limit. Narrow the source data and retry." };
  }
  const first = byProject(firstRows);
  const second = byProject(secondRows);
  const allIds = [...new Set([...first.projects.keys(), ...second.projects.keys()])].sort((a, b) => a.localeCompare(b));
  const shared: ProjectComparison[] = [];
  const onlyFirst: ProjectComparison[] = [];
  const onlySecond: ProjectComparison[] = [];
  let ambiguous = 0;
  for (const projectId of allIds) {
    const firstRowsForProject = first.projects.get(projectId);
    const secondRowsForProject = second.projects.get(projectId);
    const firstAccess = record(firstRowsForProject);
    const secondAccess = record(secondRowsForProject);
    if (firstAccess?.ambiguous || secondAccess?.ambiguous) ambiguous++;
    const names = [...(firstRowsForProject ?? []), ...(secondRowsForProject ?? [])]
      .map((row) => row.projectName).filter((name): name is string => Boolean(name));
    const projectName = names.length && names.every((name) => name === names[0]) ? names[0] : null;
    const comparison = firstAccess && secondAccess
      ? compareShared(firstAccess, secondAccess)
      : { result: "unknown" as const, differences: [] };
    const item: ProjectComparison = {
      projectId, projectName, first: firstAccess, second: secondAccess, ...comparison,
    };
    if (firstAccess && secondAccess) shared.push(item);
    else if (firstAccess) onlyFirst.push(item);
    else onlySecond.push(item);
  }
  const membershipSource = source.sources.find((item) => item.name === "admin_project_users");
  const warnings = [...source.warnings];
  if (first.missingId || second.missingId) {
    warnings.push(`${first.missingId + second.missingId} membership row(s) lack a project ID and cannot be compared.`);
  }
  if (ambiguous) warnings.push(`${ambiguous} project(s) have duplicate membership rows; their access fields are treated as unknown.`);
  warnings.push("Role assignments and effective Docs folder permissions are not represented by this snapshot comparison.");
  return {
    state: "ready", shared, onlyFirst, onlySecond, warnings,
    importedAt: membershipSource?.uploadedAt ?? null,
    coverageComplete: !membershipSource?.truncated && first.missingId === 0 && second.missingId === 0,
  };
}
