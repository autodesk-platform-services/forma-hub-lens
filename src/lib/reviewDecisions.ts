import "server-only";

import { getDb } from "./db";
import type { GovernanceRule } from "./governance";

const DAY = 86_400_000;
const RULES = new Set<GovernanceRule>([
  "missing-job-number",
  "past-end-date",
  "large-membership",
  "quiet-project",
  "no-project-members",
]);

export type GovernanceChoice = "acknowledged" | "ignored" | "snoozed";
export type LifecycleChoice = "keep-active" | "snoozed" | "prepare-archive";

export type ReviewDecision<Choice extends string> = {
  projectId: string;
  rule: string;
  choice: Choice;
  untilAt: number | null;
  updatedAt: number;
};

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS project_review_decisions (
      owner_key TEXT NOT NULL,
      area TEXT NOT NULL,
      project_id TEXT NOT NULL,
      rule TEXT NOT NULL,
      choice TEXT NOT NULL,
      until_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_key, area, project_id, rule)
    );
    CREATE INDEX IF NOT EXISTS project_review_decisions_owner
      ON project_review_decisions (owner_key, area, updated_at DESC);
  `);
}

function normalizedId(projectId: string): string {
  const id = projectId.trim().toLowerCase();
  if (!id || id.length > 200) throw new Error("Choose a valid project.");
  return id;
}

function checkedOwner(owner: string): string {
  if (!owner || owner.length > 300) throw new Error("A stable signed-in identity is required to save review decisions.");
  return owner;
}

function save(
  owner: string,
  area: "governance" | "lifecycle",
  projectId: string,
  rule: string,
  choice: GovernanceChoice | LifecycleChoice,
  untilAt: number | null,
  now: number,
): void {
  ensureTable();
  getDb().prepare(`
    INSERT INTO project_review_decisions
      (owner_key, area, project_id, rule, choice, until_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_key, area, project_id, rule) DO UPDATE SET
      choice = excluded.choice, until_at = excluded.until_at,
      updated_at = excluded.updated_at
  `).run(checkedOwner(owner), area, normalizedId(projectId), rule, choice, untilAt, now);
}

function remove(owner: string, area: "governance" | "lifecycle", projectId: string, rule: string): void {
  ensureTable();
  getDb().prepare(`DELETE FROM project_review_decisions
    WHERE owner_key = ? AND area = ? AND project_id = ? AND rule = ?`)
    .run(checkedOwner(owner), area, normalizedId(projectId), rule);
}

function list<Choice extends string>(
  owner: string,
  area: "governance" | "lifecycle",
  now: number,
): Array<ReviewDecision<Choice>> {
  ensureTable();
  const rows = getDb().prepare(`
    SELECT project_id, rule, choice, until_at, updated_at
    FROM project_review_decisions
    WHERE owner_key = ? AND area = ?
      AND (choice <> 'snoozed' OR until_at > ?)
    ORDER BY updated_at DESC
  `).all(checkedOwner(owner), area, now) as Array<{
    project_id: string; rule: string; choice: Choice;
    until_at: number | null; updated_at: number;
  }>;
  return rows.map((row) => ({
    projectId: row.project_id,
    rule: row.rule,
    choice: row.choice,
    untilAt: row.until_at === null ? null : Number(row.until_at),
    updatedAt: Number(row.updated_at),
  }));
}

export function setGovernanceDecision(
  owner: string,
  projectId: string,
  rule: GovernanceRule,
  choice: GovernanceChoice,
  now = Date.now(),
): void {
  if (!RULES.has(rule)) throw new Error("Choose a valid review rule.");
  if (!["acknowledged", "ignored", "snoozed"].includes(choice)) throw new Error("Choose a valid review action.");
  save(owner, "governance", projectId, rule, choice, choice === "snoozed" ? now + 30 * DAY : null, now);
}

export function clearGovernanceDecision(owner: string, projectId: string, rule: GovernanceRule): void {
  if (!RULES.has(rule)) throw new Error("Choose a valid review rule.");
  remove(owner, "governance", projectId, rule);
}

export function governanceDecisions(owner: string, now = Date.now()): Map<string, ReviewDecision<GovernanceChoice>> {
  return new Map(list<GovernanceChoice>(owner, "governance", now)
    .map((row) => [`${row.rule}:${row.projectId}`, row]));
}

export function setLifecycleDecision(
  owner: string,
  projectId: string,
  choice: LifecycleChoice,
  now = Date.now(),
): void {
  if (!["keep-active", "snoozed", "prepare-archive"].includes(choice)) throw new Error("Choose a valid lifecycle action.");
  save(owner, "lifecycle", projectId, "", choice, choice === "snoozed" ? now + 90 * DAY : null, now);
}

export function clearLifecycleDecision(owner: string, projectId: string): void {
  remove(owner, "lifecycle", projectId, "");
}

export function lifecycleDecisions(owner: string, now = Date.now()): Map<string, ReviewDecision<LifecycleChoice>> {
  return new Map(list<LifecycleChoice>(owner, "lifecycle", now)
    .map((row) => [row.projectId, row]));
}
