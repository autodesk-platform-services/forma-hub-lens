import "server-only";

import { PUBLISHED_API_NOTICE } from "./integrationOfficial";
import type { ApiNotice, IntegrationManifest } from "./integrationStore";

export type IntegrationImpact = {
  title: string;
  effectiveOn: string | null;
  sourceUrl: string;
  kind: "published" | "admin_recorded";
  matchedPaths: string[];
  detail: string;
};

function segments(path: string): string[] {
  return path.split("/").filter(Boolean).map((piece) => /^\{[^}]+\}$/.test(piece) ? "{}" : piece.toLowerCase());
}

/** Template-segment overlap; only a potential impact, never proof of code use. */
export function pathsOverlap(first: string, second: string): boolean {
  const a = segments(first);
  const b = segments(second);
  if (a.length !== b.length) return false;
  return a.every((piece, index) => piece === "{}" || b[index] === "{}" || piece === b[index]);
}

export function impactsForManifest(manifest: IntegrationManifest, notices: ApiNotice[]): IntegrationImpact[] {
  const result: IntegrationImpact[] = [];
  const treePaths = manifest.dependencies.filter((item) =>
    /classification/i.test(item.path) && /trees/i.test(item.path) || /isBasedOnAccountTree/i.test(item.note ?? ""));
  if (treePaths.length > 0) {
    result.push({
      title: PUBLISHED_API_NOTICE.title, effectiveOn: PUBLISHED_API_NOTICE.effectiveOn,
      sourceUrl: PUBLISHED_API_NOTICE.sourceUrl, kind: "published",
      matchedPaths: treePaths.map((item) => item.path),
      detail: `${PUBLISHED_API_NOTICE.summary} Dependency declarations indicate potential exposure; Lens has not scanned calling code.`,
    });
  }
  for (const notice of notices) {
    const matched = manifest.dependencies.filter((dependency) =>
      notice.affectedPaths.some((path) => pathsOverlap(dependency.path, path)));
    if (matched.length === 0) continue;
    result.push({
      title: notice.title, effectiveOn: notice.effectiveOn, sourceUrl: notice.sourceUrl,
      kind: "admin_recorded", matchedPaths: matched.map((item) => item.path),
      detail: `${notice.description} This notice and its path mapping were entered by an admin; Lens did not validate the linked page or calling code.`,
    });
  }
  return result;
}
