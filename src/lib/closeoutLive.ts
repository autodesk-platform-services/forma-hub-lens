import "server-only";

import { randomUUID } from "node:crypto";
import type { Session } from "./aps/auth";
import { getDb } from "./db";
import { asCloseoutDomain, ensureCloseoutTables, type CloseoutDomain } from "./closeoutStore";

export type CloseoutLiveSource = {
  domain: CloseoutDomain;
  rows: Record<string, unknown>[];
  complete: boolean;
  error: string | null;
  collectedAt: number;
  source: "live-aps";
};
export type CloseoutLivePayload = {
  projectId: string;
  collectedAt: number;
  sources: Array<{
    domain: string;
    rows: Record<string, unknown>[];
    complete: boolean;
    error: string | null;
    collectedAt: number;
    source: "live-aps";
  }>;
};
export type StoredLiveSnapshot = {
  id: string;
  projectId: string;
  collectedAt: number;
  actor: string;
  sources: CloseoutLiveSource[];
};

const MAX_ROWS_PER_SOURCE = 10_000;
const MAX_SERIALIZED_BYTES = 32 * 1024 * 1024;

/** Store the exact project-scoped APS response separately from uploaded CSVs. */
export function ingestCloseoutProjectEvidence(
  session: Pick<Session, "userId" | "userEmail">,
  payload: CloseoutLivePayload,
): StoredLiveSnapshot {
  ensureCloseoutTables();
  const projectId = payload.projectId.trim().toLowerCase();
  if (!projectId || projectId.length > 200) throw new Error("Invalid closeout project ID.");
  const actor = (session.userId ?? session.userEmail ?? "").trim();
  if (!actor) throw new Error("A stable Autodesk identity is needed to save this evidence scan.");
  const seen = new Set<string>();
  const sources: CloseoutLiveSource[] = payload.sources.map((source) => {
    const domain = asCloseoutDomain(source.domain);
    if (seen.has(domain)) throw new Error("APS returned duplicate closeout domains.");
    seen.add(domain);
    if (source.source !== "live-aps") throw new Error("Only authenticated APS evidence can enter the live snapshot store.");
    const rows = Array.isArray(source.rows) ? source.rows.slice(0, MAX_ROWS_PER_SOURCE) : [];
    const mismatched = rows.some((row) => {
      const value = row.project_id ?? row.bim360_project_id;
      return typeof value !== "string" || value.toLowerCase() !== projectId;
    });
    const capped = Array.isArray(source.rows) && source.rows.length > MAX_ROWS_PER_SOURCE;
    return {
      domain, rows: mismatched ? [] : rows,
      complete: Boolean(source.complete) && !source.error && !mismatched && !capped,
      error: mismatched
        ? "A live row did not contain the requested project ID; this domain was rejected."
        : capped ? "The live source exceeded the local 10,000-row review limit."
          : source.error?.slice(0, 500) ?? null,
      collectedAt: Number.isFinite(source.collectedAt) ? source.collectedAt : payload.collectedAt,
      source: "live-aps" as const,
    };
  });
  const snapshot: StoredLiveSnapshot = {
    id: randomUUID(), projectId,
    collectedAt: Number.isFinite(payload.collectedAt) ? payload.collectedAt : Date.now(),
    actor: actor.slice(0, 300), sources,
  };
  const serialized = JSON.stringify(sources);
  if (Buffer.byteLength(serialized) > MAX_SERIALIZED_BYTES) {
    throw new Error("The APS evidence scan is too large to store safely. Narrow the project scope or use a smaller source.");
  }
  getDb().prepare(`INSERT INTO closeout_live_snapshots
    (id,project_id,collected_at,actor,payload) VALUES (?,?,?,?,?)`)
    .run(snapshot.id, snapshot.projectId, snapshot.collectedAt, snapshot.actor, serialized);
  return snapshot;
}

export function latestCloseoutLiveSnapshot(projectId: string): StoredLiveSnapshot | null {
  ensureCloseoutTables();
  const row = getDb().prepare(`SELECT * FROM closeout_live_snapshots WHERE project_id = ?
    ORDER BY collected_at DESC, rowid DESC LIMIT 1`).get(projectId.toLowerCase()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id), projectId: String(row.project_id), collectedAt: Number(row.collected_at),
    actor: String(row.actor), sources: JSON.parse(String(row.payload)) as CloseoutLiveSource[],
  };
}
