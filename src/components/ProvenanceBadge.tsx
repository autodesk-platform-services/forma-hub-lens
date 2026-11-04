import { formatDateTime } from "./ui";

export type ProvenanceSource = "live-aps" | "project-sync" | "activity-ingest" | "user-zip" | "lens-local";

const LABELS: Record<ProvenanceSource, string> = {
  "live-aps": "Sample evidence",
  "project-sync": "Sample projects",
  "activity-ingest": "Sample activity",
  "user-zip": "Sample reporting tables",
  "lens-local": "Sample Lens record",
};

/** All portfolio sources in this separate application are bundled fictional fixtures. */
export function ProvenanceBadge({ source, asOf, className = "" }: {
  source: ProvenanceSource;
  asOf?: number | null;
  className?: string;
}) {
  return <span
    title="Fictional demo snapshot. No hub data or source evidence is fetched from Autodesk."
    className={`inline-flex items-center rounded border border-adsk-gold bg-adsk-yellow/10 px-2 py-0.5 text-[11px] text-adsk-black ${className}`}
  >{LABELS[source]} · synthetic{asOf ? ` · ${formatDateTime(asOf)}` : ""}</span>;
}
