/** Browser-local favorites are scoped to the hub and signed-in Autodesk identity. */
export function toolFavoritesKey(hubId: string, owner: string | null): string | null {
  return owner ? `forma-hub-lens:favorite-tools:${hubId}:${owner}` : null;
}

export type ToolSummary = { id: string; name: string };

export function readToolFavorites(storageKey: string | null, validIds: Set<string>): string[] {
  if (!storageKey || typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && validIds.has(id)))]
      : [];
  } catch {
    return [];
  }
}
