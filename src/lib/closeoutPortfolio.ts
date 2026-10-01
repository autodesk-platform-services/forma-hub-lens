import "server-only";

import { createHash } from "node:crypto";
import { cachedProjects, type CachedProject } from "./aps/admin";
import { getTrustedTableSource, listTables, recentUploads, type DatasetTable } from "./dataset";
import { getDb } from "./db";
import { CLOSEOUT_SOURCE_TABLES, type CloseoutAssessment } from "./closeoutEngine";
import { closeoutAttestations, listCloseoutAssignments, listCloseoutAssessments,
  listCloseoutProfiles, listExpectedDeliverables, selectedCloseoutRecords,
  type CloseoutAssignment, type CloseoutProfile, type StoredAssessment } from "./closeoutStore";

export type CloseoutPortfolioRow = {
  project: CachedProject;
  assignment: CloseoutAssignment | undefined;
  latest: StoredAssessment | null;
  stale: boolean;
};
export type CloseoutPortfolioStatus = {
  rows: CloseoutPortfolioRow[];
  counts: { assigned: number; ready: number; blockers: number; unknown: number; unassessed: number };
  totalProjects: number;
};
const stable = (items: unknown[]) => JSON.stringify(items);
const sortAttestations = (items: ReturnType<typeof closeoutAttestations>) =>
  [...items].sort((a, b) => `${a.domain}:${a.sourceRevision}`.localeCompare(`${b.domain}:${b.sourceRevision}`));

/** Reconcile saved assessment status with current local revisions; never display stale Ready as current. */
export function closeoutPortfolioStatus(): CloseoutPortfolioStatus {
  const projects = cachedProjects();
  const profiles = new Map(listCloseoutProfiles().map((profile) => [profile.id, profile]));
  const assignments = new Map(listCloseoutAssignments().map((item) => [item.projectId, item]));
  const tables = new Map(listTables().map((table) => [table.name, table]));
  const uploads = recentUploads(100_000).sort((a, b) => a.uploadedAt - b.uploadedAt);
  const revisions = new Map<string, string | null>();
  const currentRevision = (table: DatasetTable): string | null => {
    if (revisions.has(table.name)) return revisions.get(table.name) ?? null;
    const trusted = getTrustedTableSource(table.name);
    const upload = uploads.find((candidate) => candidate.uploadedAt >= table.uploadedAt);
    const revision = trusted ? `aps-job:${trusted.uploadId}:${table.name}:${table.uploadedAt}` :
      upload ? `zip:${upload.id}:${table.name}:${table.uploadedAt}` : null;
    revisions.set(table.name, revision);
    return revision;
  };
  const rows = projects.map((project) => {
    const assignment = assignments.get(project.id.toLowerCase());
    const latest = listCloseoutAssessments(project.id, 1)[0] ?? null;
    if (!latest) return { project, assignment, latest, stale: false };
    const profile: CloseoutProfile | undefined = assignment ? profiles.get(assignment.profileId) : undefined;
    let stale = true;
    try {
      const saved = JSON.parse(latest.result) as CloseoutAssessment;
      const live = getDb().prepare(`SELECT id FROM closeout_live_snapshots WHERE project_id = ?
        ORDER BY collected_at DESC, rowid DESC LIMIT 1`)
        .get(project.id.toLowerCase()) as { id: string } | undefined;
      const projectRow = getDb().prepare("SELECT raw FROM projects WHERE lower(id) = ?")
        .get(project.id.toLowerCase()) as { raw: string } | undefined;
      const projectSourceHash = createHash("sha256").update(`${project.status ?? ""}|${projectRow?.raw ?? ""}`).digest("hex");
      const sourceChanged = saved.sources.some((source) => {
        if (source.kind === "live-aps") return source.revision !== `live:${live?.id ?? "missing"}:${source.domain}`;
        if (source.kind === "missing") return CLOSEOUT_SOURCE_TABLES[source.domain].some((name) => tables.has(name));
        if (!source.table) return true;
        const table = tables.get(source.table);
        const candidates = CLOSEOUT_SOURCE_TABLES[source.domain].filter((name) => tables.has(name));
        return candidates.length !== 1 || !table || source.revision !== currentRevision(table);
      });
      stale = !assignment || !profile || latest.profileId !== profile.id ||
        saved.assignmentAssignedAt !== assignment.assignedAt ||
        saved.liveSnapshotId !== (live?.id ?? null) ||
        saved.projectSourceHash !== projectSourceHash ||
        stable([saved.profile]) !== stable([profile]) ||
        stable(saved.expectedDeliverables) !== stable(listExpectedDeliverables(profile.id, project.id)) ||
        stable(saved.selections) !== stable(selectedCloseoutRecords(project.id)) ||
        stable(sortAttestations(saved.attestations ?? [])) !== stable(sortAttestations(closeoutAttestations(project.id))) ||
        sourceChanged;
    } catch { stale = true; }
    return { project, assignment, latest, stale };
  });
  return {
    rows, totalProjects: projects.length,
    counts: {
      assigned: rows.filter((row) => !!row.assignment).length,
      ready: rows.filter((row) => row.latest?.status === "ready" && !row.stale).length,
      blockers: rows.filter((row) => row.latest?.status === "blockers" && !row.stale).length,
      unknown: rows.filter((row) => !!row.latest && (row.latest.status === "unknown" || row.stale)).length,
      unassessed: rows.filter((row) => !row.latest).length,
    },
  };
}
