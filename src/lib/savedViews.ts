import "server-only";

import { randomUUID } from "node:crypto";
import type { Session } from "./aps/auth";
import { getDb } from "./db";
import { getPerson } from "./people";

export type SavedView = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
};

export type WatchItem = {
  kind: "project" | "person";
  targetId: string;
  label: string;
  createdAt: number;
};

const MAX_VIEWS = 50;
const MAX_WATCH_ITEMS = 200;

function ensureTables(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS saved_views (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_views_owner ON saved_views (owner_key, updated_at DESC);
    CREATE TABLE IF NOT EXISTS watchlist_items (
      owner_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_key, kind, target_id)
    );
    CREATE INDEX IF NOT EXISTS watchlist_owner ON watchlist_items (owner_key, created_at DESC);
  `);
}

/** Demo preferences belong to this browser profile, never to an Autodesk account. */
export function savedViewsOwner(session: Pick<Session, "userId" | "userEmail"> & Partial<Pick<Session, "mode">>): string | null {
  if (session.mode === "demo" || session.userId === "synthetic-demo-visitor") return "demo:browser";
  const id = session.userId?.trim();
  if (id) return `autodesk:${id.toLowerCase()}`;
  const email = session.userEmail?.trim().toLowerCase();
  return email ? `email:${email}` : null;
}

const VIEW_PARAMS: Record<string, Set<string>> = {
  "/activity": new Set(["from", "to", "project", "service", "action", "actor", "q"]),
  "/people": new Set(["view", "q", "project", "status"]),
  "/projects": new Set(["sort"]),
  "/governance": new Set(["rule", "quietDays", "largeMembership"]),
  "/search": new Set(["q", "kind"]),
};

export function normalizeSavedPath(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.length > 2_048) {
    throw new Error("Save a view from a supported page in this app.");
  }
  const url = new URL(raw, "https://local.invalid");
  const allowed = VIEW_PARAMS[url.pathname];
  if (!allowed) throw new Error("This page cannot be saved as a view yet.");
  const clean = new URLSearchParams();
  let count = 0;
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key) || !value.trim()) continue;
    if (++count > 30 || value.length > 200) throw new Error("The view has too many or overly long filters.");
    clean.append(key, value);
  }
  const query = clean.toString();
  return url.pathname + (query ? `?${query}` : "");
}

export function listSavedViews(owner: string): SavedView[] {
  ensureTables();
  const rows = getDb().prepare(
    `SELECT id, name, path, created_at, updated_at FROM saved_views
     WHERE owner_key = ? ORDER BY updated_at DESC, id LIMIT ?`,
  ).all(owner, MAX_VIEWS) as Array<{
    id: string; name: string; path: string; created_at: number; updated_at: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

export function createSavedView(owner: string, name: string, rawPath: string): SavedView {
  ensureTables();
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 80) throw new Error("View name must be 1–80 characters.");
  const path = normalizeSavedPath(rawPath);
  const db = getDb();
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM saved_views WHERE owner_key = ?")
    .get(owner) as { n: number }).n);
  if (count >= MAX_VIEWS) throw new Error(`You can save at most ${MAX_VIEWS} views.`);
  const now = Date.now();
  const view: SavedView = { id: randomUUID(), name: trimmedName, path, createdAt: now, updatedAt: now };
  db.prepare(
    "INSERT INTO saved_views (id, owner_key, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(view.id, owner, view.name, view.path, now, now);
  return view;
}

export function deleteSavedView(owner: string, id: string): boolean {
  ensureTables();
  const result = getDb().prepare("DELETE FROM saved_views WHERE owner_key = ? AND id = ?").run(owner, id);
  return Number(result.changes) > 0;
}

export function listWatchItems(owner: string): WatchItem[] {
  ensureTables();
  const rows = getDb().prepare(
    `SELECT kind, target_id, label, created_at FROM watchlist_items
     WHERE owner_key = ? ORDER BY created_at DESC, target_id LIMIT ?`,
  ).all(owner, MAX_WATCH_ITEMS) as Array<{
    kind: "project" | "person"; target_id: string; label: string; created_at: number;
  }>;
  return rows.map((row) => ({
    kind: row.kind,
    targetId: row.target_id,
    label: row.label,
    createdAt: Number(row.created_at),
  }));
}

export function addWatchItem(
  owner: string,
  kind: "project" | "person",
  targetId: string,
  label: string,
): void {
  ensureTables();
  if (kind !== "project" && kind !== "person") throw new Error("Unsupported watchlist item.");
  const id = targetId.trim();
  if (!id || id.length > 200) throw new Error("Choose a project or person from search results.");
  const db = getDb();
  if (kind === "project") {
    const hit = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
    if (!hit) throw new Error("This project is not in the local project cache.");
  } else if (getPerson(id).state !== "found") {
    throw new Error("This person cannot be identified uniquely in the uploaded extract.");
  }
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM watchlist_items WHERE owner_key = ?")
    .get(owner) as { n: number }).n);
  const existing = db.prepare(
    "SELECT 1 FROM watchlist_items WHERE owner_key = ? AND kind = ? AND target_id = ?",
  ).get(owner, kind, id);
  if (!existing && count >= MAX_WATCH_ITEMS) throw new Error(`You can save at most ${MAX_WATCH_ITEMS} watchlist items.`);
  const display = label.trim().slice(0, 160) || id;
  db.prepare(
    `INSERT INTO watchlist_items (owner_key, kind, target_id, label, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_key, kind, target_id) DO UPDATE SET label = excluded.label`,
  ).run(owner, kind, id, display, Date.now());
}

export function removeWatchItem(owner: string, kind: "project" | "person", targetId: string): boolean {
  ensureTables();
  const result = getDb().prepare(
    "DELETE FROM watchlist_items WHERE owner_key = ? AND kind = ? AND target_id = ?",
  ).run(owner, kind, targetId);
  return Number(result.changes) > 0;
}
