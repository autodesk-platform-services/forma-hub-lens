/** Visitor preferences contain only fictional demo records. They never reach a server. */
export type DemoView = { id: string; name: string; path: string; createdAt: number; updatedAt: number };
export type DemoWatch = { kind: "project" | "person"; targetId: string; label: string; createdAt: number };
export type DemoReview = {
  area: "governance" | "lifecycle"; projectId: string; rule: string;
  choice: "acknowledged" | "ignored" | "snoozed" | "keep-active" | "prepare-archive";
  untilAt: number | null; updatedAt: number;
};
export type DemoPreferences = { views: DemoView[]; watched: DemoWatch[]; reviews: DemoReview[] };
export const DEMO_PREFERENCES_EVENT = "forma-demo-preferences";
export const emptyDemoPreferences = (): DemoPreferences => ({ views: [], watched: [], reviews: [] });

export function demoPreferencesKey(owner: string | null): string | null {
  return owner ? `forma-hub-lens-demo:v1:${encodeURIComponent(owner)}` : null;
}

const ALLOWED_PATHS = new Set(["/activity", "/people", "/projects", "/governance", "/search"]);
export function safeDemoViewPath(raw: string): string | null {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.length > 2048) return null;
  try {
    const url = new URL(raw, "https://demo.invalid");
    if (!ALLOWED_PATHS.has(url.pathname) || url.origin !== "https://demo.invalid" || url.hash) return null;
    return url.pathname + url.search;
  } catch { return null; }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= max;
}
function timestamp(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }

/** Ignore malformed or oversized local values instead of rendering arbitrary saved URLs. */
export function parseDemoPreferences(raw: string | null): DemoPreferences {
  if (!raw || raw.length > 250_000) return emptyDemoPreferences();
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value)) return emptyDemoPreferences();
    const views = Array.isArray(value.views) ? value.views.filter((row): row is DemoView => object(row) &&
      text(row.id, 100) && text(row.name, 80) && text(row.path, 2048) && Boolean(safeDemoViewPath(row.path)) &&
      timestamp(row.createdAt) && timestamp(row.updatedAt)).slice(0, 50) : [];
    const watched = Array.isArray(value.watched) ? value.watched.filter((row): row is DemoWatch => object(row) &&
      ["project", "person"].includes(String(row.kind)) && text(row.targetId, 200) && text(row.label, 160) &&
      timestamp(row.createdAt)).slice(0, 200) : [];
    const reviews = Array.isArray(value.reviews) ? value.reviews.filter((row): row is DemoReview => object(row) &&
      ["governance", "lifecycle"].includes(String(row.area)) && text(row.projectId, 200) && typeof row.rule === "string" && row.rule.length <= 100 &&
      ["acknowledged", "ignored", "snoozed", "keep-active", "prepare-archive"].includes(String(row.choice)) &&
      (row.untilAt === null || timestamp(row.untilAt)) && timestamp(row.updatedAt)).slice(0, 500) : [];
    return { views, watched, reviews };
  } catch { return emptyDemoPreferences(); }
}

export function reviewKey(area: DemoReview["area"], projectId: string, rule = ""): string {
  return `${area}:${projectId.toLowerCase()}:${rule}`;
}
