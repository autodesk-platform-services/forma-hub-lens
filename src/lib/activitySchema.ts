/**
 * Schema heuristics for Data Connector activity CSVs.
 *
 * Autodesk versions the activity CSV schemas independently per service, and the
 * authoritative column list ships as a README inside each extract rather than in
 * the public docs. So rather than hard-coding a schema, this maps whatever
 * columns arrive onto a small canonical shape; the ingester keeps the untouched
 * row as JSON alongside. Anything unmapped is recorded in `column_report` and
 * shown in the UI, so a wrong guess is visible rather than silent.
 *
 * Pure functions only — no I/O, no secrets, so they can be tested directly.
 */

export type Canonical =
  | "occurred_at"
  | "project_id"
  | "actor_id"
  | "actor_name"
  | "actor_email"
  | "service"
  | "action"
  | "target_type"
  | "target_name";

/** Candidate column names per canonical field, highest priority first. */
export const COLUMN_CANDIDATES: Record<Canonical, string[]> = {
  occurred_at: [
    "eventtime",
    "occurredat",
    "activitytime",
    "activitydate",
    "performedat",
    "timestamp",
    "createdat",
    "created",
    "eventdate",
    "date",
    "time",
    "updatedat",
  ],
  project_id: ["projectid", "bim360projectid", "accprojectid", "containerid", "project"],
  actor_id: [
    "userid",
    "actorid",
    "autodeskid",
    "performedbyid",
    "createdby",
    "userautodeskid",
    "oxygenid",
  ],
  actor_name: [
    "username",
    "actorname",
    "performedby",
    "createdbyname",
    "userfullname",
    "fullname",
    "displayname",
    "user",
  ],
  actor_email: ["useremail", "actoremail", "email", "createdbyemail", "performedbyemail"],
  service: ["service", "servicename", "module", "application", "source", "tool", "product"],
  action: [
    "verb",
    "action",
    "activitytype",
    "eventtype",
    "activity",
    "operation",
    "event",
    "actiontype",
  ],
  target_type: [
    "objecttype",
    "entitytype",
    "resourcetype",
    "targettype",
    "itemtype",
    "documenttype",
    "type",
  ],
  target_name: [
    "objectname",
    "entityname",
    "resourcename",
    "targetname",
    "itemname",
    "documentname",
    "filename",
    "title",
    "name",
  ],
};

const ID_CANDIDATES = ["activityid", "eventid", "id", "auditid", "logid"];

export type Mapping = Partial<Record<Canonical, string>> & { idColumn?: string };

function normalise(column: string): string {
  return column.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function mapColumns(headers: string[]): Mapping {
  const byNormal = new Map<string, string>();
  for (const header of headers) {
    const key = normalise(header);
    if (!byNormal.has(key)) byNormal.set(key, header);
  }

  const mapping: Mapping = {};
  const claimed = new Set<string>();

  for (const [canonical, candidates] of Object.entries(COLUMN_CANDIDATES) as Array<
    [Canonical, string[]]
  >) {
    for (const candidate of candidates) {
      const header = byNormal.get(candidate);
      if (header && !claimed.has(header)) {
        mapping[canonical] = header;
        claimed.add(header);
        break;
      }
    }
  }

  for (const candidate of ID_CANDIDATES) {
    const header = byNormal.get(candidate);
    if (header) {
      mapping.idColumn = header;
      break;
    }
  }

  return mapping;
}

/** `activities_docs_activities.csv` -> `docs`. Used when no service column exists. */
export function serviceFromFileName(fileName: string): string | null {
  const stem = fileName.replace(/\.csv$/i, "");
  const match = stem.match(/^activities[_-](.+?)(?:[_-]activities)?$/i);
  return match?.[1] ? match[1].toLowerCase() : null;
}

const EPOCH_SECONDS_CUTOFF = 100_000_000_000; // anything smaller is seconds, not ms

export function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    const ms = numeric < EPOCH_SECONDS_CUTOFF ? numeric * 1000 : numeric;
    return Number.isFinite(ms) ? ms : null;
  }

  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  if (hasZone) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // No zone: "2024-06-01 12:03:04" or "2024-06-01T12:03:04" — Data Connector
  // emits UTC, so pin it rather than letting the host timezone shift it.
  const parsed = Date.parse(trimmed.replace(" ", "T") + "Z");
  if (Number.isFinite(parsed)) return parsed;

  const fallback = Date.parse(trimmed);
  return Number.isFinite(fallback) ? fallback : null;
}

export function isActivityFile(name: string): boolean {
  return /^activities.*\.csv$/i.test(name);
}
