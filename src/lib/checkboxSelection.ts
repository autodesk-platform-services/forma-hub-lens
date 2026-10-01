/** Selection is retained across filter changes; only visible values are changed in bulk. */
export function toggleShownSelection(current: string[], shown: string[], maxSelected?: number): string[] {
  const selected = new Set(current);
  const allShownSelected = shown.length > 0 && shown.every((value) => selected.has(value));
  if (allShownSelected) return current.filter((value) => !shown.includes(value));
  const additions = shown.filter((value) => !selected.has(value));
  if (maxSelected !== undefined && current.length + additions.length > maxSelected) return current;
  return [...current, ...additions];
}

/** Hidden inputs submit only checked rows outside the current filter, without duplicates. */
export function hiddenSelectedValues(current: string[], shown: string[]): string[] {
  const visible = new Set(shown);
  return current.filter((value) => !visible.has(value));
}
