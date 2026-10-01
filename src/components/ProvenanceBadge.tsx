import { formatDateTime } from "./ui";

export type ProvenanceSource = "live-aps" | "project-sync" | "activity-ingest" | "user-zip" | "lens-local";

const SOURCE: Record<ProvenanceSource, { label: string; title: string; className: string }> = {
  "live-aps": {
    label: "Live APS · on demand",
    title: "Specific views fetch Autodesk Platform Services on demand. This badge does not mean every page or local cache is live.",
    className: "border-adsk-teal bg-adsk-teal/10 text-adsk-black",
  },
  "project-sync": {
    label: "Project sync",
    title: "A local mirror of the last successful Admin API project sync; Autodesk may have newer values.",
    className: "border-adsk-lightgray bg-adsk-white text-adsk-gray",
  },
  "activity-ingest": {
    label: "Activity ingest",
    title: "Local Data Connector activity ingestion time, not the event window or a live activity feed.",
    className: "border-adsk-lightgray bg-adsk-white text-adsk-gray",
  },
  "user-zip": {
    label: "User ZIP · hub unverified",
    title: "User-uploaded CSV ZIP. Lens cannot verify which Autodesk hub produced the files or when they were extracted.",
    className: "border-adsk-gold bg-adsk-gold/10 text-adsk-black",
  },
  "lens-local": {
    label: "Lens local",
    title: "Stored in this application's local database; it is not an Autodesk record or live alert.",
    className: "border-adsk-lightgray bg-adsk-white text-adsk-gray",
  },
};

export function ProvenanceBadge({ source, asOf, className = "" }: {
  source: ProvenanceSource;
  asOf?: number | null;
  className?: string;
}) {
  const meta = SOURCE[source];
  return (
    <span
      title={meta.title}
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${meta.className} ${className}`}
    >
      {meta.label}{asOf ? ` · ${formatDateTime(asOf)}` : ""}
    </span>
  );
}
