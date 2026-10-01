import "server-only";

import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { Session } from "./aps/auth";
import type { ImportUser, NewProject } from "./aps/hubAdmin";
import type { CompanyChange } from "./organizationModel";

export const PLAN_TTL_MS = 10 * 60_000;

export type PlanKind = "add_members" | "remove_members" | "create_projects" | "archive_projects" | "create_company" | "update_company";
export type PlanSkip = { key: string; label: string; reason: string };

export type AdminPlan =
  | {
      kind: "add_members";
      targets: Array<{ projectId: string; users: ImportUser[] }>;
      suppressEmails: boolean;
      roleSourceUploadedAt?: number;
      skips: PlanSkip[];
    }
  | {
      kind: "remove_members";
      targets: Array<{ projectId: string; userId: string; email: string }>;
      skips: PlanSkip[];
    }
  | { kind: "create_projects"; targets: NewProject[]; skips: PlanSkip[] }
  | { kind: "archive_projects"; targets: Array<{ projectId: string; name: string }>; skips: PlanSkip[] }
  | { kind: "create_company" | "update_company"; targets: CompanyChange[]; skips: PlanSkip[] };

export type PlanPreview = {
  id: string;
  kind: PlanKind;
  planned: number;
  skipped: number;
  summary: string;
  details: string[];
  expiresAt: number;
};

function targetCount(plan: AdminPlan): number {
  return plan.kind === "add_members"
    ? plan.targets.reduce((sum, target) => sum + target.users.length, 0)
    : plan.targets.length;
}

/** Save the server-computed plan. Form fields are never replayed at execution. */
export function saveAdminPlan(
  session: Session,
  plan: AdminPlan,
  summary: string,
  details: string[],
): PlanPreview {
  const now = Date.now();
  const preview: PlanPreview = {
    id: randomUUID(),
    kind: plan.kind,
    planned: targetCount(plan),
    skipped: plan.skips.length,
    summary,
    details,
    expiresAt: now + PLAN_TTL_MS,
  };
  const db = getDb();
  db.prepare("DELETE FROM admin_operation_plans WHERE expires_at < ? AND claimed_at IS NULL")
    .run(now);
  db.prepare(
    `INSERT INTO admin_operation_plans
       (id, session_id, actor_user_id, actor_email, kind, payload, preview, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    preview.id,
    session.id,
    session.userId,
    session.userEmail?.trim().toLowerCase() ?? null,
    plan.kind,
    JSON.stringify(plan),
    JSON.stringify(preview),
    now,
    preview.expiresAt,
  );
  return preview;
}

export class InvalidAdminPlanError extends Error {
  constructor() {
    super("This preview expired, was already executed, or belongs to another session. Preview the changes again.");
    this.name = "InvalidAdminPlanError";
  }
}

/** Read a preview only for its originating signed-in session. */
export function readAdminPlan(
  session: Session,
  planId: string,
): { plan: AdminPlan; preview: PlanPreview } {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new InvalidAdminPlanError();
  const row = getDb().prepare(
    `SELECT session_id, actor_user_id, actor_email, payload, preview, expires_at
     FROM admin_operation_plans WHERE id = ?`,
  ).get(planId) as Record<string, string | number | null> | undefined;
  if (
    !row ||
    row.session_id !== session.id ||
    row.actor_user_id !== session.userId ||
    row.actor_email !== (session.userEmail?.trim().toLowerCase() ?? null) ||
    Number(row.expires_at) <= Date.now()
  ) throw new InvalidAdminPlanError();
  return {
    plan: JSON.parse(String(row.payload)) as AdminPlan,
    preview: JSON.parse(String(row.preview)) as PlanPreview,
  };
}

export function claimAdminPlan(
  session: Session,
  planId: string,
  expectedKind: PlanKind,
): { plan: AdminPlan; preview: PlanPreview; operationId: string } {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new InvalidAdminPlanError();
  const db = getDb();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      `SELECT session_id, actor_user_id, actor_email, kind, payload, preview, expires_at, claimed_at
       FROM admin_operation_plans WHERE id = ?`,
    ).get(planId) as Record<string, string | number | null> | undefined;
    if (
      !row ||
      row.session_id !== session.id ||
      row.actor_user_id !== session.userId ||
      row.actor_email !== (session.userEmail?.trim().toLowerCase() ?? null) ||
      row.kind !== expectedKind ||
      Number(row.expires_at) <= now ||
      row.claimed_at !== null
    ) {
      throw new InvalidAdminPlanError();
    }

    const plan = JSON.parse(String(row.payload)) as AdminPlan;
    const preview = JSON.parse(String(row.preview)) as PlanPreview;
    if (plan.kind !== expectedKind || preview.kind !== expectedKind || preview.id !== planId) {
      throw new InvalidAdminPlanError();
    }
    const operationId = randomUUID();
    db.prepare("UPDATE admin_operation_plans SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL")
      .run(now, planId);
    db.prepare(
      `INSERT INTO admin_operations
         (id, plan_id, actor_user_id, actor_email, kind, status, planned, started_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
    ).run(operationId, planId, session.userId, session.userEmail, expectedKind, preview.planned, now);
    db.exec("COMMIT");
    return { plan, preview, operationId };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type ItemStatus = "started" | "succeeded" | "submitted" | "skipped" | "failed";

/** Reserve an item before calling Autodesk; an interrupted call stays visible as started. */
export function startAdminItem(
  operationId: string,
  index: number,
  key: string,
  label: string,
): void {
  getDb().prepare(
    `INSERT INTO admin_operation_items
       (operation_id, item_index, item_key, label, status, started_at)
     VALUES (?, ?, ?, ?, 'started', ?)`,
  ).run(operationId, index, key, label, Date.now());
}

export function finishAdminItem(
  operationId: string,
  index: number,
  status: Exclude<ItemStatus, "started">,
  detail: string,
): void {
  getDb().prepare(
    `UPDATE admin_operation_items SET status = ?, detail = ?, finished_at = ?
     WHERE operation_id = ? AND item_index = ? AND status = 'started'`,
  ).run(status, detail.slice(0, 1200), Date.now(), operationId, index);
}

export function recordAdminSkip(
  operationId: string,
  index: number,
  skip: PlanSkip,
): void {
  startAdminItem(operationId, index, skip.key, skip.label);
  finishAdminItem(operationId, index, "skipped", skip.reason);
}

export function finishAdminOperation(operationId: string, summary: string): void {
  const rows = getDb().prepare(
    `SELECT status, COUNT(*) AS count FROM admin_operation_items
     WHERE operation_id = ? GROUP BY status`,
  ).all(operationId) as Array<{ status: string; count: number }>;
  const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const failed = counts.get("failed") ?? 0;
  const started = counts.get("started") ?? 0;
  const succeeded = counts.get("succeeded") ?? 0;
  const submitted = counts.get("submitted") ?? 0;
  const skipped = counts.get("skipped") ?? 0;
  const status = started > 0
    ? "incomplete"
    : failed > 0
      ? succeeded + submitted > 0 ? "partial" : "failed"
      : "complete";
  getDb().prepare(
    `UPDATE admin_operations
     SET status = ?, succeeded = ?, submitted = ?, skipped = ?, failed = ?,
         finished_at = ?, summary = ? WHERE id = ?`,
  ).run(status, succeeded, submitted, skipped, failed, Date.now(), summary.slice(0, 1200), operationId);
}

export type AdminOperation = {
  id: string;
  kind: PlanKind;
  actorEmail: string | null;
  status: string;
  planned: number;
  succeeded: number;
  submitted: number;
  skipped: number;
  failed: number;
  startedAt: number;
  finishedAt: number | null;
  summary: string | null;
};

export type AdminOperationItem = {
  index: number;
  key: string;
  label: string;
  status: ItemStatus;
  detail: string | null;
  startedAt: number;
  finishedAt: number | null;
};

function toOperation(row: Record<string, unknown>): AdminOperation {
  return {
    id: String(row.id),
    kind: String(row.kind) as PlanKind,
    actorEmail: row.actor_email == null ? null : String(row.actor_email),
    status: String(row.status),
    planned: Number(row.planned),
    succeeded: Number(row.succeeded),
    submitted: Number(row.submitted),
    skipped: Number(row.skipped),
    failed: Number(row.failed),
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    summary: row.summary == null ? null : String(row.summary),
  };
}

export function recentAdminOperations(limit = 50): AdminOperation[] {
  const rows = getDb().prepare(
    "SELECT * FROM admin_operations ORDER BY started_at DESC LIMIT ?",
  ).all(Math.min(Math.max(limit, 1), 200)) as Array<Record<string, unknown>>;
  return rows.map(toOperation);
}

export function adminOperation(id: string): AdminOperation | null {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = getDb().prepare("SELECT * FROM admin_operations WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? toOperation(row) : null;
}

export function adminOperationItems(id: string, limit = 500, offset = 0): AdminOperationItem[] {
  const rows = getDb().prepare(
    `SELECT item_index, item_key, label, status, detail, started_at, finished_at
     FROM admin_operation_items WHERE operation_id = ? ORDER BY item_index LIMIT ? OFFSET ?`,
  ).all(id, Math.min(Math.max(limit, 1), 2000), Math.max(0, offset)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    index: Number(row.item_index),
    key: String(row.item_key),
    label: String(row.label),
    status: String(row.status) as ItemStatus,
    detail: row.detail == null ? null : String(row.detail),
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
  }));
}

export function adminOperationItemCount(id: string): number {
  const row = getDb().prepare(
    "SELECT COUNT(*) AS count FROM admin_operation_items WHERE operation_id = ?",
  ).get(id) as { count: number };
  return Number(row.count);
}
