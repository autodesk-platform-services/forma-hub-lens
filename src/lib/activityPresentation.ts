/** Human-readable labels for extract vocabulary. Raw values remain available in Activity. */
const SERVICE_LABELS: Record<string, string> = {
  admin: "Administration", bridge: "Bridge", cost: "Cost", docs: "Docs",
  forms: "Forms", issues: "Issues", issues_changes: "Issue changes",
  rfis: "RFIs", rfis_changes: "RFI changes", sheets: "Sheets",
  submittals: "Submittals", submittals_target_tasks: "Submittal tasks",
  submittals_target_steps: "Submittal steps",
  submittals_target_ball_in_court_users: "Submittal assignees",
};

function humanize(raw: string): string {
  const words = raw.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Not specified in extract";
}

export function serviceLabel(raw: string | null): string {
  if (!raw || raw === "(unspecified)") return "Not specified in extract";
  return SERVICE_LABELS[raw] ?? humanize(raw);
}

export function actionLabel(raw: string | null): string {
  if (!raw || raw === "(unspecified)") return "Not specified in extract";
  return humanize(raw);
}

function opaque(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value) || /^[A-Z0-9]{10,}$/.test(value);
}

export type ActorDisplay = { label: string; detail: string | null };

export function actorDisplay(
  sourceName: string | null,
  sourceEmail: string | null,
  sourceId: string | null,
  resolvedName?: string | null,
): ActorDisplay {
  if (resolvedName) return { label: resolvedName, detail: sourceEmail ?? sourceId };
  if (sourceName && ["Step", "Task", "User"].includes(sourceName)) {
    return { label: "Unresolved actor", detail: sourceId ?? `Source label: ${sourceName}` };
  }
  if (sourceName && !opaque(sourceName)) {
    return { label: sourceName, detail: sourceEmail ?? sourceId };
  }
  if (sourceEmail) return { label: sourceEmail, detail: sourceId };
  const raw = sourceId ?? sourceName;
  return { label: raw ? "Unknown person" : "Not specified in extract", detail: raw };
}
