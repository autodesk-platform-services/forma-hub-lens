/** Escape a text cell for CSV and keep spreadsheet programs from evaluating it. */
export function csvCell(value: string): string {
  // Quoting alone does not stop Excel and similar programs treating text as a formula.
  // Prefix with an apostrophe even when whitespace precedes the trigger character.
  const formulaLike = /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(value) || /^[\t\r\n]/u.test(value);
  const safe = formulaLike ? `'${value}` : value;
  if (formulaLike || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
