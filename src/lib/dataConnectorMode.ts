export type ExtractionMode = "full" | "delta" | "mixed" | "unknown";
/** Autodesk CDC groups produce full data without a date filter. */
export function dataConnectorExtractionMode(request: {
  serviceGroups?: string[]; dateRange?: string | null; startDate?: string | null; endDate?: string | null;
}): ExtractionMode {
  if (!request.serviceGroups?.length) return "unknown";
  const cdc = request.serviceGroups.filter((group) => group.startsWith("cdc")).length;
  if (!cdc || !(request.dateRange || request.startDate || request.endDate)) return "full";
  return cdc === request.serviceGroups.length ? "delta" : "mixed";
}
