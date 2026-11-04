import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import {
  archiveAssessment,
  governanceFindings,
  projectEvidence,
  type ProjectEvidence,
} from "@/lib/governance";
import {
  lifecycleDecisions,
  type LifecycleChoice,
  type ReviewDecision,
} from "@/lib/reviewDecisions";
import { savedViewsOwner } from "@/lib/savedViews";
import { Card, EmptyState, Pill, Stat, formatDate, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { DemoReviewControls } from "@/components/DemoPreferences";

export const dynamic = "force-dynamic";

type Decision = ReviewDecision<LifecycleChoice>;
type PageParams = Record<string, string | string[] | undefined>;

function feedback(params: PageParams): { text: string; error: boolean } | null {
  const error = typeof params.error === "string" ? params.error.slice(0, 200) : null;
  const notice = typeof params.notice === "string" ? params.notice.slice(0, 200) : null;
  return error ? { text: error, error: true } : notice ? { text: notice, error: false } : null;
}

function statusLabel(decision?: Decision): string | null {
  if (decision?.choice === "keep-active") return "Keep active";
  if (decision?.choice === "prepare-archive") return "Prepare archive";
  if (decision?.choice === "snoozed") return `Snoozed until ${formatDateTime(decision.untilAt)}`;
  return null;
}

function ReviewChecklist({ item }: { item: ProjectEvidence }) {
  const assessment = archiveAssessment(item);
  const knownBacklogs = item.workflowBacklog.filter((row) => row.observedOpen !== null);
  const openCount = knownBacklogs.reduce((sum, row) => sum + (row.observedOpen ?? 0), 0);
  const checklist = [
    {
      title: "Project administration",
      detail: `Active in the last synced record, ${formatDateTime(item.project.syncedAt)}. End date: ${formatDate(item.endDate)}.`,
      status: item.warnings.some((warning) => warning.includes("administration data")) ? "Sync may be stale" : "Inspect record",
    },
    {
      title: "Activity coverage",
      detail: item.activityCoverage.scopeKnown
        ? `Known project extract windows: ${item.activityCoverage.windowCount}, through ${item.activityCoverage.latestWindow}. Last observed event: ${formatDateTime(item.lastObservedEventAt)}.`
        : "Project inclusion and date coverage are not established by the stored extract definitions.",
      status: item.activityCoverage.scopeKnown ? "Inspect coverage" : "Coverage unknown",
    },
    {
      title: "Issues, RFIs, and submittals",
      detail: `${knownBacklogs.length} of 3 uploaded status tables contain rows for this project. ${openCount} open item(s) observed in recognized statuses. The ZIP has no verified project coverage manifest; confirm current work in Forma.`,
      status: openCount > 0 ? "Open work observed" : knownBacklogs.length === 3 ? "Verify live" : "Coverage unknown",
    },
    {
      title: "Project members",
      detail: item.project.memberCount === null
        ? "Member count is unavailable in the last project sync."
        : `${item.project.memberCount} member(s) in the last project sync. Confirm current membership in Forma.`,
      status: item.project.memberCount === null ? "Unknown" : item.project.memberCount > 0 ? "Members remain" : "Verify live",
    },
    {
      title: "Contract and retention",
      detail: "Confirm project closeout, contractual duties, and retention requirements with the responsible administrators.",
      status: "Manual check",
    },
  ];

  return <details className="mt-3 rounded border border-adsk-lightgray bg-adsk-offwhite/40">
    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-adsk-link">Inspect evidence and review checklist</summary>
    <div className="space-y-3 border-t border-adsk-lightgray px-3 py-3">
      <ol className="grid gap-2 md:grid-cols-2">
        {checklist.map((check, index) => <li key={check.title} className="rounded border border-adsk-lightgray bg-adsk-white p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-adsk-black">{index + 1}. {check.title}</span>
            <Pill tone={check.status === "Open work observed" || check.status === "Members remain" ? "warn" : "default"}>{check.status}</Pill>
          </div>
          <p className="mt-1 text-adsk-gray">{check.detail}</p>
        </li>)}
      </ol>
      {item.trend.available ? <p className="text-xs text-adsk-gray">
        In the known {item.trend.periodStart}–{item.trend.periodEnd} extract window: {item.trend.previous} events in the earlier 14 days and {item.trend.current} in the later 14 days. This compares observed events, not total project work.
      </p> : <p className="text-xs text-adsk-gray">Activity trend unavailable: {item.trend.reason}</p>}
      {assessment.blockers.length > 0 && <div className="rounded border border-adsk-gold bg-adsk-gold/10 px-3 py-2 text-xs">
        <strong>Observed open work requiring review:</strong> {assessment.blockers.join("; ")}.
      </div>}
      <div className="text-xs text-adsk-gray">
        <strong className="text-adsk-black">Checks still needed</strong>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{assessment.checks.map((check) => <li key={check}>{check}</li>)}</ul>
      </div>
      {item.warnings.length > 0 && <div className="text-xs text-adsk-gray">
        <strong className="text-adsk-black">Data cautions</strong>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{item.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </div>}
      <p className="text-[11px] text-adsk-gray">An empty or zero count in loaded extracts does not establish that a project is ready to archive.</p>
    </div>
  </details>;
}

function CandidateCard({ item, signals, decision, canSave, owner }: {
  item: ProjectEvidence;
  signals: string[];
  decision?: Decision;
  canSave: boolean;
  owner: string | null;
}) {
  const assessment = archiveAssessment(item);
  const label = statusLabel(decision);
  return <li className="rounded border border-adsk-lightgray bg-adsk-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/projects/${encodeURIComponent(item.project.id)}`} className="text-sm font-semibold text-adsk-link hover:underline">{item.project.name}</Link>
          {label && <Pill tone={decision?.choice === "prepare-archive" ? "warn" : "default"}>{label}</Pill>}
        </div>
        <p className="mt-1 font-mono text-[10px] text-adsk-gray">{item.project.id}</p>
        <p className="mt-1 text-xs text-adsk-gray">
          {signals.length ? signals.join(" · ") : "Earlier review decision; the current rules no longer flag this project."}
        </p>
      </div>
      <div className="text-right text-[11px] text-adsk-gray">
        <div>Last observed event: {formatDateTime(item.lastObservedEventAt)}</div>
        <div>End date: {formatDate(item.endDate)} · Members: {item.project.memberCount ?? "unknown"}</div>
      </div>
    </div>
    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
      {assessment.blockers.length > 0 ? <Pill tone="warn">{assessment.blockers.length} observed open-work check{assessment.blockers.length === 1 ? "" : "s"}</Pill>
        : <Pill>Open work requires live verification</Pill>}
      {item.warnings.length > 0 && <Pill tone="warn">{item.warnings.length} data caution{item.warnings.length === 1 ? "" : "s"}</Pill>}
    </div>
    <ReviewChecklist item={item} />
    {canSave && <DemoReviewControls owner={owner} area="lifecycle" projectId={item.project.id} />}
  </li>;
}

function CandidateSection({ title, subtitle, items, signals, decisions, canSave, empty, owner }: {
  title: string;
  subtitle: string;
  items: ProjectEvidence[];
  signals: Map<string, string[]>;
  decisions: Map<string, Decision>;
  canSave: boolean;
  owner: string | null;
  empty: string;
}) {
  return <Card title={`${title} (${items.length})`} subtitle={subtitle}>
    {items.length ? <ul className="space-y-3">{items.map((item) => <CandidateCard
      key={item.project.id}
      item={item}
      signals={signals.get(item.project.id) ?? []}
      decision={decisions.get(item.project.id.toLowerCase())}
      canSave={canSave}
      owner={owner}
    />)}</ul> : <EmptyState title={empty} />}
  </Card>;
}

export default async function LifecyclePage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;

  const now = Date.now();
  const params = await searchParams;
  const owner = savedViewsOwner(session);
  const decisions = owner ? lifecycleDecisions(owner, now) : new Map<string, Decision>();
  const all = projectEvidence(now);
  const findings = governanceFindings({}, now).findings.filter((finding) =>
    finding.rule === "quiet-project" || finding.rule === "past-end-date");
  const signals = new Map<string, string[]>();
  for (const finding of findings) {
    const values = signals.get(finding.projectId) ?? [];
    values.push(finding.label);
    signals.set(finding.projectId, values);
  }
  const candidates = all.filter((item) => item.project.status === "active" &&
    (signals.has(item.project.id) || decisions.has(item.project.id.toLowerCase())));
  const reviewNow = candidates.filter((item) => !decisions.has(item.project.id.toLowerCase()));
  const prepared = candidates.filter((item) => decisions.get(item.project.id.toLowerCase())?.choice === "prepare-archive");
  const kept = candidates.filter((item) => decisions.get(item.project.id.toLowerCase())?.choice === "keep-active");
  const snoozed = candidates.filter((item) => decisions.get(item.project.id.toLowerCase())?.choice === "snoozed");
  const archived = all.filter((item) => item.project.status === "archived");
  const message = feedback(params);

  return <div className="space-y-5">
    <div>
      <h1 className="font-legend text-2xl text-adsk-black">Project lifecycle</h1>
      <p className="mt-1 max-w-3xl text-sm text-adsk-gray">Review possible archive candidates and archived projects. A candidate is a prompt to investigate; decisions here stay in this browser and do not change Autodesk project status. Summary counts describe the fixed sample; personal choices appear on each project.</p>
    </div>
    {message && <p role="status" className={`rounded border px-3 py-2 text-xs ${message.error ? "border-adsk-linkvisited bg-adsk-linkvisited/10" : "border-adsk-lightgray bg-adsk-white"}`}>{message.text}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Review now" value={String(reviewNow.length)} hint="Current signals without a personal decision" />
      <Stat label="Prepare archive" value={String(prepared.length)} hint="Local review state; no project archived" />
      <Stat label="Keep active" value={String(kept.length)} hint="Personal decision" />
      <Stat label="Snoozed" value={String(snoozed.length)} hint="Returns to review after 90 days" />
    </div>

    <CandidateSection title="Review now" subtitle="Active projects with a past stated end date or a possible quiet-project signal" items={reviewNow} signals={signals} decisions={decisions} canSave={Boolean(owner)} owner={owner} empty="No projects need lifecycle review under the current rules." />
    <CandidateSection title="Prepared for archive review" subtitle="Resolve open work and manual checks before using Manage to preview any status change" items={prepared} signals={signals} decisions={decisions} canSave={Boolean(owner)} owner={owner} empty="No projects are marked Prepare archive." />
    {prepared.length > 0 && session.hubRole === "hub_admin" && <p className="text-xs text-adsk-gray">Ready to review an archive action? <Link href="/manage" className="text-adsk-link hover:underline">Open Manage and its audited archive preview →</Link></p>}
    {(kept.length > 0 || snoozed.length > 0) && <Card title="Other personal decisions" subtitle="These projects remain active in Autodesk">
      <div className="space-y-4">
        {kept.length > 0 && <div><h3 className="mb-2 text-xs font-semibold text-adsk-black">Keep active ({kept.length})</h3><ul className="space-y-3">{kept.map((item) => <CandidateCard key={item.project.id} item={item} signals={signals.get(item.project.id) ?? []} decision={decisions.get(item.project.id.toLowerCase())} canSave={Boolean(owner)} owner={owner} />)}</ul></div>}
        {snoozed.length > 0 && <div><h3 className="mb-2 text-xs font-semibold text-adsk-black">Snoozed ({snoozed.length})</h3><ul className="space-y-3">{snoozed.map((item) => <CandidateCard key={item.project.id} item={item} signals={signals.get(item.project.id) ?? []} decision={decisions.get(item.project.id.toLowerCase())} canSave={Boolean(owner)} owner={owner} />)}</ul></div>}
      </div>
    </Card>}

    <Card title={`Archived inventory (${archived.length})`} subtitle="Status from the last synced project inventory">
      {archived.length ? <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">{archived.map((item) => <li key={item.project.id} className="flex items-center justify-between gap-2 rounded border border-adsk-lightgray px-3 py-2 text-xs">
        <Link href={`/projects/${encodeURIComponent(item.project.id)}`} className="truncate text-adsk-link hover:underline">{item.project.name}</Link><Pill>Archived</Pill>
      </li>)}</ul> : <p className="text-xs text-adsk-gray">No archived projects in the last synced project inventory.</p>}
    </Card>
  </div>;
}
