import "server-only";

import { cachedProjects, type CachedProject } from "./aps/admin";
import { getDb } from "./db";
import { getTable, resolveColumn, type DatasetTable } from "./dataset";
import { projectActivity, type ProjectActivityRow } from "./queries";

const DAY = 86_400_000;

export type ActivityTrend = {
  available: boolean;
  current: number | null;
  previous: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  reason: string;
};

export type WorkflowBacklog = {
  key: "issues" | "rfis" | "submittals";
  label: string;
  observedOpen: number | null;
  unrecognizedStatuses: number;
  uploadedAt: number | null;
  caveat: string | null;
};

export type ProjectActivityCoverage = {
  earliestWindow: string | null;
  latestWindow: string | null;
  latestIngestedAt: number | null;
  windowCount: number;
  scopeKnown: boolean;
};

export type PortfolioSource = {
  projectSyncedAt: number | null;
  activityIngestedAt: number | null;
  activityWindowStart: string | null;
  activityWindowEnd: string | null;
  activityJobs: number;
};

export type ProjectEvidence = {
  project: CachedProject;
  activity: ProjectActivityRow | null;
  endDate: string | null;
  lastObservedEventAt: number | null;
  daysSinceObservedEvent: number | null;
  observedServices: string[];
  activityCoverage: ProjectActivityCoverage;
  trend: ActivityTrend;
  workflowBacklog: WorkflowBacklog[];
  warnings: string[];
};

export type GovernanceRule =
  | "missing-job-number"
  | "past-end-date"
  | "large-membership"
  | "quiet-project"
  | "no-project-members";

export type GovernanceFinding = {
  key: string;
  rule: GovernanceRule;
  label: string;
  projectId: string;
  projectName: string;
  explanation: string;
  evidence: string[];
};

export type GovernanceSettings = {
  quietDays: number;
  largeMembership: number;
};

export function normalizeSettings(input: Partial<GovernanceSettings>): GovernanceSettings {
  const quietDays = Math.floor(Number(input.quietDays));
  const largeMembership = Math.floor(Number(input.largeMembership));
  return {
    quietDays: Number.isFinite(quietDays) ? Math.min(365, Math.max(7, quietDays)) : 90,
    largeMembership: Number.isFinite(largeMembership)
      ? Math.min(10_000, Math.max(10, largeMembership))
      : 100,
  };
}

function parsedEndDate(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value = (JSON.parse(raw) as { endDate?: unknown }).endDate;
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

type ExtractWindow = { start: number; end: number; ingestedAt: number };
type ActivityJob = {
  created_at: string | null;
  started_at: string | null;
  start_date: string | null;
  end_date: string | null;
  ingested_at: number;
  request_id: string | null;
  service_groups: string | null;
  activity_rows: number;
};
type RequestScope = {
  projectId?: unknown;
  projectIdList?: unknown;
  projectStatus?: unknown;
};

function dayStart(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const ms = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function requestProjectIds(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === "string").map((id) => id.toLowerCase());
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return requestProjectIds(parsed);
  } catch { /* comma-separated APS values are also accepted */ }
  return value.split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
}

function projectIncluded(scope: RequestScope | undefined, project: CachedProject, job: ActivityJob): boolean {
  // An old job without its request definition does not establish that this
  // project was included, even when the extract contains no events for it.
  if (!scope) return false;
  const ids = requestProjectIds(scope.projectIdList);
  if (ids?.length) return ids.includes(project.id.toLowerCase());
  if (typeof scope.projectId === "string" && scope.projectId) {
    return scope.projectId.toLowerCase() === project.id.toLowerCase();
  }
  const status = typeof scope.projectStatus === "string" ? scope.projectStatus.toLowerCase() : null;
  if (status !== "all" && status !== "active" && status !== "archived") return false;
  if (status !== "all" && status !== project.status?.toLowerCase()) return false;
  // A hub-wide request describes the projects that existed when its job ran.
  // A later-created project cannot inherit that historical extract window.
  const createdAt = Date.parse(project.createdAt ?? "");
  const jobBeganAt = Date.parse(job.created_at ?? job.started_at ?? "");
  return Number.isFinite(createdAt) && Number.isFinite(jobBeganAt) && createdAt <= jobBeganAt;
}

function loadActivityJobs(): { jobs: ActivityJob[]; requests: Map<string, RequestScope> } {
  const db = getDb();
  const jobs = db.prepare(
    `SELECT created_at, started_at, start_date, end_date, ingested_at, request_id, service_groups, activity_rows
     FROM extract_jobs WHERE ingested_at IS NOT NULL AND ingest_error IS NULL`,
  ).all() as ActivityJob[];
  const requests = new Map<string, RequestScope>();
  const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'data_connector_requests'").get();
  if (tableExists) {
    for (const row of db.prepare("SELECT id, raw FROM data_connector_requests").all() as Array<{ id: string; raw: string }>) {
      try { requests.set(row.id, JSON.parse(row.raw) as RequestScope); } catch { /* unknown scope */ }
    }
  }
  return { jobs, requests };
}

function windowsForProject(
  project: CachedProject,
  source: ReturnType<typeof loadActivityJobs>,
): ExtractWindow[] {
  const windows: ExtractWindow[] = [];
  for (const job of source.jobs) {
    const groups = job.service_groups?.split(",").map((group) => group.trim()) ?? [];
    if (!groups.includes("activities") && Number(job.activity_rows) === 0) continue;
    const start = dayStart(job.start_date);
    const end = dayStart(job.end_date);
    if (start === null || end === null || end < start) continue;
    if (!projectIncluded(source.requests.get(job.request_id ?? ""), project, job)) continue;
    windows.push({ start, end: end + DAY - 1, ingestedAt: Number(job.ingested_at) });
  }
  return windows.sort((a, b) => a.start - b.start || a.end - b.end);
}

function coversRange(windows: ExtractWindow[], start: number, end: number): boolean {
  let coveredThrough = start - 1;
  for (const window of windows) {
    if (window.end < start) continue;
    if (window.start > coveredThrough + 1) break;
    coveredThrough = Math.max(coveredThrough, window.end);
    if (coveredThrough >= end) return true;
  }
  return false;
}

function activityTrend(projectId: string, windows: ExtractWindow[]): ActivityTrend {
  if (!windows.length) return { available: false, current: null, previous: null, periodStart: null, periodEnd: null, reason: "Project-scoped extract windows are unavailable." };
  const end = Math.max(...windows.map((window) => window.end));
  const start = end - 28 * DAY + 1;
  if (!coversRange(windows, start, end)) {
    return { available: false, current: null, previous: null, periodStart: null, periodEnd: null, reason: "The latest 28-day extract window has gaps; a trend would be misleading." };
  }
  const mid = start + 14 * DAY;
  const counts = getDb().prepare(
    `SELECT SUM(CASE WHEN occurred_ms >= ? THEN 1 ELSE 0 END) AS current,
            SUM(CASE WHEN occurred_ms < ? THEN 1 ELSE 0 END) AS previous
     FROM activities WHERE lower(project_id) = ? AND occurred_ms >= ? AND occurred_ms <= ?`,
  ).get(mid, mid, projectId.toLowerCase(), start, end) as { current: number | null; previous: number | null };
  return {
    available: true,
    current: Number(counts.current ?? 0),
    previous: Number(counts.previous ?? 0),
    periodStart: new Date(start).toISOString().slice(0, 10),
    periodEnd: new Date(end).toISOString().slice(0, 10),
    reason: "Two consecutive 14-day periods within known project extract coverage.",
  };
}

type WorkflowDefinition = {
  key: WorkflowBacklog["key"];
  label: string;
  table: string;
  statusColumn: string;
  openStatuses: string[];
  recognizedStatuses: string[];
};

const WORKFLOWS: WorkflowDefinition[] = [
  { key: "issues", label: "Issues", table: "issues_issues", statusColumn: "status", openStatuses: ["open", "in_progress", "in_review", "answered"], recognizedStatuses: ["open", "in_progress", "in_review", "answered", "closed", "void", "draft"] },
  { key: "rfis", label: "RFIs", table: "rfis_rfis", statusColumn: "status", openStatuses: ["open", "submitted", "answered"], recognizedStatuses: ["open", "submitted", "answered", "draft", "closed", "void"] },
  { key: "submittals", label: "Submittals", table: "submittalsacc_items", statusColumn: "status_value", openStatuses: ["open", "in review", "submitted"], recognizedStatuses: ["open", "in review", "submitted", "draft", "closed", "void"] },
];

function safeIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error("Invalid dataset identifier");
  return `"${value}"`;
}

function workflowProjectColumn(table: DatasetTable): string | undefined {
  return resolveColumn(table, "bim360_project_id") ?? resolveColumn(table, "project_id");
}

function workflowSnapshot(definition: WorkflowDefinition, table: DatasetTable | undefined): Map<string, WorkflowBacklog> | null {
  if (!table) return null;
  const projectColumn = workflowProjectColumn(table);
  const statusColumn = resolveColumn(table, definition.statusColumn);
  if (!projectColumn || !statusColumn) return null;
  const rows = getDb().prepare(
    `SELECT lower(trim(${safeIdentifier(projectColumn)})) AS project_id,
            lower(trim(${safeIdentifier(statusColumn)})) AS status, COUNT(*) AS n
     FROM ${safeIdentifier(table.sqlName)}
     WHERE ${safeIdentifier(projectColumn)} IS NOT NULL
     GROUP BY project_id, status`,
  ).all() as Array<{ project_id: string; status: string | null; n: number }>;
  const map = new Map<string, WorkflowBacklog>();
  for (const row of rows) {
    const id = row.project_id;
    const current = map.get(id) ?? {
      key: definition.key, label: definition.label, observedOpen: 0,
      unrecognizedStatuses: 0, uploadedAt: table.uploadedAt,
      caveat: table.truncated ? "The uploaded table was truncated; counts may be incomplete." : null,
    };
    if (row.status && definition.openStatuses.includes(row.status)) current.observedOpen! += Number(row.n);
    if (!row.status || !definition.recognizedStatuses.includes(row.status)) current.unrecognizedStatuses += Number(row.n);
    map.set(id, current);
  }
  return map;
}

export function portfolioSource(): PortfolioSource {
  const db = getDb();
  const projectRow = db.prepare("SELECT MAX(synced_at) AS latest FROM projects")
    .get() as { latest: number | null };
  const activityRow = db.prepare(
    `SELECT MAX(ingested_at) AS latest, MIN(start_date) AS window_start,
            MAX(end_date) AS window_end, COUNT(*) AS jobs
     FROM extract_jobs
     WHERE ingested_at IS NOT NULL
       AND (activity_rows > 0 OR ',' || COALESCE(service_groups, '') || ',' LIKE '%,activities,%')`,
  ).get() as { latest: number | null; window_start: string | null; window_end: string | null; jobs: number };
  return {
    projectSyncedAt: projectRow.latest === null ? null : Number(projectRow.latest),
    activityIngestedAt: activityRow.latest === null ? null : Number(activityRow.latest),
    activityWindowStart: activityRow.window_start,
    activityWindowEnd: activityRow.window_end,
    activityJobs: Number(activityRow.jobs),
  };
}

export function projectEvidence(now = Date.now()): ProjectEvidence[] {
  const projects = cachedProjects();
  const activity = new Map(projectActivity({}).map((row) => [row.projectId.toLowerCase(), row]));
  const raw = new Map((getDb().prepare("SELECT id, raw FROM projects").all() as Array<{ id: string; raw: string }>).map((row) => [row.id.toLowerCase(), row.raw]));
  const source = portfolioSource();
  const activityJobs = loadActivityJobs();
  const workflow = new Map(WORKFLOWS.map((definition) => {
    const table = getTable(definition.table);
    return [definition.key, { table, snapshot: workflowSnapshot(definition, table) }] as const;
  }));
  return projects.map((project) => {
    const stats = activity.get(project.id.toLowerCase()) ?? null;
    const windows = windowsForProject(project, activityJobs);
    const latestWindow = windows.length ? Math.max(...windows.map((window) => window.end)) : null;
    const earliestWindow = windows.length ? Math.min(...windows.map((window) => window.start)) : null;
    const latestIngestedAt = windows.length ? Math.max(...windows.map((window) => window.ingestedAt)) : null;
    const workflowBacklog = WORKFLOWS.map((definition): WorkflowBacklog => {
      const { snapshot, table } = workflow.get(definition.key)!;
      if (!snapshot || !table) return {
        key: definition.key, label: definition.label, observedOpen: null,
        unrecognizedStatuses: 0, uploadedAt: table?.uploadedAt ?? null,
        caveat: "No project-joinable status table is loaded.",
      };
      return snapshot.get(project.id.toLowerCase()) ?? {
        key: definition.key, label: definition.label, observedOpen: null,
        unrecognizedStatuses: 0, uploadedAt: table.uploadedAt,
        caveat: "No rows for this project are in the uploaded table; project coverage is unverified."
          + (table.truncated ? " The table was also truncated." : ""),
      };
    });
    const warnings: string[] = [];
    if (!source.activityIngestedAt) warnings.push("No activity extract has been ingested.");
    if (!windows.length && source.activityIngestedAt) warnings.push("Project inclusion and date coverage are not established by the stored extract definitions.");
    if (latestIngestedAt && now - latestIngestedAt > 7 * DAY) {
      warnings.push("The latest known project activity extract was ingested more than 7 days ago.");
    }
    if (now - project.syncedAt > 7 * DAY) {
      warnings.push("Project administration data was synced more than 7 days ago.");
    }
    for (const item of workflowBacklog) {
      if (item.uploadedAt && now - item.uploadedAt > 14 * DAY) warnings.push(`${item.label} snapshot is more than 14 days old.`);
      if (item.unrecognizedStatuses > 0) warnings.push(`${item.label} contains ${item.unrecognizedStatuses} item(s) with unrecognized statuses.`);
    }
    const lastObservedEventAt = stats?.lastEventMs ?? null;
    return {
      project,
      activity: stats,
      endDate: parsedEndDate(raw.get(project.id.toLowerCase()) ?? null),
      lastObservedEventAt,
      daysSinceObservedEvent: lastObservedEventAt === null
        ? null
        : Math.max(0, Math.floor((now - lastObservedEventAt) / DAY)),
      observedServices: stats?.services?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
      activityCoverage: {
        earliestWindow: earliestWindow === null ? null : new Date(earliestWindow).toISOString().slice(0, 10),
        latestWindow: latestWindow === null ? null : new Date(latestWindow).toISOString().slice(0, 10),
        latestIngestedAt,
        windowCount: windows.length,
        scopeKnown: windows.length > 0,
      },
      trend: activityTrend(project.id, windows),
      workflowBacklog,
      warnings,
    };
  });
}

/** Review signals for an archive decision. A zero in an extract is not clearance. */
export function archiveAssessment(item: ProjectEvidence): { blockers: string[]; checks: string[] } {
  const blockers = item.workflowBacklog
    .filter((row) => row.observedOpen !== null && row.observedOpen > 0)
    .map((row) => `${row.observedOpen} observed open ${row.label.toLowerCase()}`);
  const checks: string[] = [];
  if (!item.activityCoverage.scopeKnown) checks.push("Activity coverage for this project is unverified.");
  if (item.project.memberCount && item.project.memberCount > 0) checks.push(`${item.project.memberCount} members remain on this project.`);
  for (const row of item.workflowBacklog) {
    if (row.observedOpen === null) checks.push(`${row.label} backlog is unavailable.`);
    else if (row.observedOpen === 0) checks.push(`Confirm ${row.label.toLowerCase()} in Forma; no open item was observed among the uploaded rows for this project.`);
    if (row.caveat) checks.push(`${row.label}: ${row.caveat}`);
    if (row.unrecognizedStatuses > 0) checks.push(`${row.label} has statuses outside the known open/closed set.`);
  }
  checks.push("Confirm contractual closeout and retention requirements in Forma.");
  return { blockers, checks };
}

export function governanceFindings(
  input: Partial<GovernanceSettings> = {},
  now = Date.now(),
): { source: PortfolioSource; findings: GovernanceFinding[] } {
  const settings = normalizeSettings(input);
  const source = portfolioSource();
  const activityJobs = loadActivityJobs();
  const findings: GovernanceFinding[] = [];
  const add = (evidence: ProjectEvidence, rule: GovernanceRule, label: string, explanation: string, details: string[]) => {
    findings.push({
      key: `${rule}:${evidence.project.id}`,
      rule,
      label,
      projectId: evidence.project.id,
      projectName: evidence.project.name,
      explanation,
      evidence: details,
    });
  };
  for (const item of projectEvidence(now)) {
    const project = item.project;
    if (project.status !== "active") continue;
    if (!project.jobNumber?.trim()) {
      add(item, "missing-job-number", "Missing job number", "The current project record has no job number.", ["Status: active"]);
    }
    if (item.endDate && Date.parse(item.endDate) < now) {
      add(item, "past-end-date", "Past stated end date", "The project remains active after its recorded end date.", [
        `End date: ${item.endDate.slice(0, 10)}`,
      ]);
    }
    if (project.memberCount !== null && project.memberCount >= settings.largeMembership) {
      add(item, "large-membership", "Large membership list", "Membership exceeds the selected review threshold.", [
        `Members: ${project.memberCount}`,
        `Threshold: ${settings.largeMembership}`,
      ]);
    }
    if (project.memberCount === 0) {
      add(item, "no-project-members", "No project members", "The current project record reports no members.", ["Members: 0"]);
    }
    if (item.activityCoverage.scopeKnown) {
      const projectWindows = windowsForProject(project, activityJobs);
      const cutoff = now - settings.quietDays * 86_400_000;
      const projectCreatedAt = Date.parse(project.createdAt ?? "");
      // Do not merge the min/max of disconnected jobs into assumed coverage.
      // A review rule needs an unbroken, project-scoped extraction period and
      // a project that existed throughout that period.
      if (Number.isFinite(projectCreatedAt) && projectCreatedAt <= cutoff &&
          item.activityCoverage.latestIngestedAt && now - item.activityCoverage.latestIngestedAt <= 14 * DAY &&
          coversRange(projectWindows, dayStart(new Date(cutoff).toISOString())!, dayStart(new Date(now).toISOString())! - 1) &&
          (item.lastObservedEventAt === null || item.lastObservedEventAt < cutoff)) {
        add(item, "quiet-project", "Possible quiet project",
          "No event was observed for this project during the relevant ingested activity window. Review extract coverage and project workflows before acting.", [
            item.lastObservedEventAt
              ? `Last observed event: ${new Date(item.lastObservedEventAt).toISOString().slice(0, 10)}`
              : "No event observed in loaded extracts",
            `Latest project extract window end: ${item.activityCoverage.latestWindow}`,
          ]);
      }
    }
  }
  findings.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.rule.localeCompare(b.rule));
  return { source, findings };
}
