import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import {
  governanceFindings,
  normalizeSettings,
  type GovernanceFinding,
  type GovernanceRule,
} from "@/lib/governance";
import { governanceDecisions, type ReviewDecision, type GovernanceChoice } from "@/lib/reviewDecisions";
import { savedViewsOwner } from "@/lib/savedViews";
import { Card, EmptyState, Pill, Stat, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { DemoReviewControls } from "@/components/DemoPreferences";

export const dynamic = "force-dynamic";

const RULES: Array<{ key: GovernanceRule; label: string; summary: string }> = [
  { key: "quiet-project", label: "Possible quiet projects", summary: "No events observed only when a recent, continuous project extract covers the review period." },
  { key: "past-end-date", label: "Past stated end date", summary: "Active projects past the end date in the last synced administration record." },
  { key: "missing-job-number", label: "Missing job number", summary: "Active projects without a job number in the last synced administration record." },
  { key: "large-membership", label: "Large membership", summary: "Active projects at or above your selected membership threshold." },
  { key: "no-project-members", label: "No project members", summary: "Active projects whose last synced record reports zero members." },
];

const CATEGORIES: Array<{ label: string; rules: GovernanceRule[] }> = [
  { label: "Lifecycle", rules: ["past-end-date"] },
  { label: "Project setup", rules: ["missing-job-number", "no-project-members"] },
  { label: "Activity", rules: ["quiet-project"] },
  { label: "Access", rules: ["large-membership"] },
];

type PageParams = Record<string, string | string[] | undefined>;
type Decision = ReviewDecision<GovernanceChoice>;

function decisionKey(finding: GovernanceFinding): string {
  return `${finding.rule}:${finding.projectId.toLowerCase()}`;
}

function feedback(params: PageParams): { text: string; error: boolean } | null {
  const error = typeof params.error === "string" ? params.error.slice(0, 200) : null;
  const notice = typeof params.notice === "string" ? params.notice.slice(0, 200) : null;
  return error ? { text: error, error: true } : notice ? { text: notice, error: false } : null;
}


function FindingRow({ finding, decision, canSave, owner }: {
  finding: GovernanceFinding;
  decision?: Decision;
  canSave: boolean;
  owner: string | null;
}) {
  const status = decision?.choice === "snoozed"
    ? `Snoozed until ${formatDateTime(decision.untilAt)}`
    : decision?.choice === "ignored" ? "Ignored in your queue" : decision ? "Acknowledged" : null;
  return <li className="border-t border-adsk-offwhite py-3 first:border-t-0 first:pt-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/projects/${encodeURIComponent(finding.projectId)}`} className="text-sm font-medium text-adsk-link hover:underline">{finding.projectName}</Link>
      {status && <Pill tone="default">{status}</Pill>}
    </div>
    <p className="mt-1 text-xs text-adsk-gray">{finding.explanation}</p>
    <p className="mt-1 text-[11px] text-adsk-gray">{finding.evidence.join(" · ")}</p>
    {canSave && <DemoReviewControls owner={owner} area="governance" projectId={finding.projectId} rule={finding.rule} />}
  </li>;
}

export default async function GovernancePage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const problems = configProblems();
  if (problems.length) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;

  const params = await searchParams;
  const settings = normalizeSettings({
    quietDays: Number(params.quietDays),
    largeMembership: Number(params.largeMembership),
  });
  const selectedRule = typeof params.rule === "string" && RULES.some((rule) => rule.key === params.rule)
    ? params.rule : "all";
  const owner = savedViewsOwner(session);
  const decisions = owner ? governanceDecisions(owner) : new Map<string, Decision>();
  const { source, findings } = governanceFindings(settings);
  const selected = selectedRule === "all" ? findings : findings.filter((finding) => finding.rule === selectedRule);
  const open = selected.filter((finding) => !decisions.has(decisionKey(finding)));
  const reviewed = selected.filter((finding) => decisions.has(decisionKey(finding)));
  const openByRule = new Map(RULES.map((rule) => [rule.key, open.filter((finding) => finding.rule === rule.key)]));
  const reviewedByRule = new Map(RULES.map((rule) => [rule.key, reviewed.filter((finding) => finding.rule === rule.key)]));
  const firstOpen = CATEGORIES.flatMap((category) => category.rules)
    .find((rule) => (openByRule.get(rule)?.length ?? 0) > 0);
  const savedPath = `/governance?${new URLSearchParams({
    rule: selectedRule,
    quietDays: String(settings.quietDays),
    largeMembership: String(settings.largeMembership),
  })}`;
  const message = feedback(params);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-legend text-2xl text-adsk-black">Governance review</h1>
        <p className="mt-1 max-w-3xl text-sm text-adsk-gray">
          Rules identify projects worth reviewing. They use cached administration records and ingested activity, and do not establish noncompliance.
        </p>
      </div>
      <Link href={`/views?save=${encodeURIComponent(savedPath)}`} className="rounded border border-adsk-lightgray px-3 py-1.5 text-xs text-adsk-link hover:bg-adsk-white">Save this view</Link>
    </div>

    {message && <p role="status" className={`rounded border px-3 py-2 text-xs ${message.error ? "border-adsk-linkvisited bg-adsk-linkvisited/10" : "border-adsk-lightgray bg-adsk-white"}`}>{message.text}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {RULES.map((rule) => <Stat key={rule.key} label={rule.label} value={String(openByRule.get(rule.key)?.length ?? 0)} hint="Findings in the fixed sample" />)}
    </div>

    <Card title="Evidence and thresholds">
      <div className="grid gap-4 text-xs text-adsk-gray md:grid-cols-2">
        <p>Projects last synced: <strong className="text-adsk-black">{formatDateTime(source.projectSyncedAt)}</strong></p>
        <p>Activity last ingested: <strong className="text-adsk-black">{formatDateTime(source.activityIngestedAt)}</strong></p>
        <p>Known activity window: <strong className="text-adsk-black">{source.activityWindowStart?.slice(0, 10) ?? "unknown"} → {source.activityWindowEnd?.slice(0, 10) ?? "unknown"}</strong></p>
        <p>Activity jobs ingested: <strong className="text-adsk-black">{source.activityJobs}</strong></p>
      </div>
      <p className="mt-3 text-xs text-adsk-gray">Extract windows may have gaps. No observed events does not prove no work occurred. Review decisions below are saved only in this browser and never change Autodesk project data. Summary counts describe the fixed sample; personal choices appear on each finding.</p>
      <form method="get" className="mt-4 flex flex-wrap items-end gap-3 text-xs">
        <label>Rule
          <select name="rule" defaultValue={selectedRule} className="mt-1 block rounded border border-adsk-lightgray bg-white px-2 py-1.5">
            <option value="all">All rules</option>
            {RULES.map((rule) => <option key={rule.key} value={rule.key}>{rule.label}</option>)}
          </select>
        </label>
        <label>Quiet review days
          <input name="quietDays" type="number" min="7" max="365" defaultValue={settings.quietDays} className="mt-1 block w-28 rounded border border-adsk-lightgray px-2 py-1.5" />
        </label>
        <label>Large membership threshold
          <input name="largeMembership" type="number" min="10" max="10000" defaultValue={settings.largeMembership} className="mt-1 block w-28 rounded border border-adsk-lightgray px-2 py-1.5" />
        </label>
        <button type="submit" className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 font-medium text-adsk-black">Apply</button>
      </form>
    </Card>

    <Card title={`Open findings (${open.length})`} subtitle="Grouped by category and rule; open a rule to inspect its projects">
      {open.length === 0 ? <EmptyState title="No open findings match these rules and thresholds." /> :
        <div className="space-y-4">
          {CATEGORIES.map((category) => {
            const rules = RULES.filter((rule) => category.rules.includes(rule.key) &&
              (selectedRule === "all" || selectedRule === rule.key) && (openByRule.get(rule.key)?.length ?? 0) > 0);
            if (!rules.length) return null;
            const categoryCount = rules.reduce((sum, rule) => sum + (openByRule.get(rule.key)?.length ?? 0), 0);
            return <section key={category.label} aria-label={`${category.label} findings`}>
              <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-adsk-gray">
                <span>{category.label}</span><span className="tnum normal-case tracking-normal">{categoryCount} finding{categoryCount === 1 ? "" : "s"}</span>
              </h3>
              <div className="space-y-2">{rules.map((rule) => {
                const rows = openByRule.get(rule.key) ?? [];
                return <details key={rule.key} open={rule.key === firstOpen || selectedRule === rule.key} className="rounded border border-adsk-lightgray">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-adsk-black">
                    <span>{rule.label}</span><span className="tnum text-xs text-adsk-gray">{rows.length} project{rows.length === 1 ? "" : "s"}</span>
                  </summary>
                  <div className="border-t border-adsk-lightgray px-4 py-2">
                    <p className="mb-2 text-xs text-adsk-gray">{rule.summary}</p>
                    <ul>{rows.slice(0, 10).map((finding) => <FindingRow key={finding.key} finding={finding} canSave={Boolean(owner)} owner={owner} />)}</ul>
                    {rows.length > 10 && <details className="mt-2 border-t border-adsk-lightgray pt-2">
                      <summary className="cursor-pointer text-xs text-adsk-link">Show {rows.length - 10} more project{rows.length - 10 === 1 ? "" : "s"} in this rule</summary>
                      <ul className="mt-2">{rows.slice(10).map((finding) => <FindingRow key={finding.key} finding={finding} canSave={Boolean(owner)} owner={owner} />)}</ul>
                    </details>}
                  </div>
                </details>;
              })}</div>
            </section>;
          })}
        </div>}
    </Card>

    {reviewed.length > 0 && <Card title={`Acknowledged, ignored, or snoozed (${reviewed.length})`} subtitle="Personal review decisions; reopen a finding to return it to the open queue">
      <div className="space-y-4">
        {CATEGORIES.map((category) => {
          const rules = RULES.filter((rule) => category.rules.includes(rule.key) &&
            (selectedRule === "all" || selectedRule === rule.key) && (reviewedByRule.get(rule.key)?.length ?? 0) > 0);
          if (!rules.length) return null;
          const categoryCount = rules.reduce((sum, rule) => sum + (reviewedByRule.get(rule.key)?.length ?? 0), 0);
          return <section key={category.label} aria-label={`${category.label} reviewed findings`}>
            <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-adsk-gray">
              <span>{category.label}</span><span className="tnum normal-case tracking-normal">{categoryCount} finding{categoryCount === 1 ? "" : "s"}</span>
            </h3>
            <div className="space-y-2">{rules.map((rule) => {
              const rows = reviewedByRule.get(rule.key) ?? [];
              return <details key={rule.key} className="rounded border border-adsk-lightgray">
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-adsk-black">
                  <span>{rule.label}</span><span className="tnum text-xs text-adsk-gray">{rows.length}</span>
                </summary>
                <ul className="border-t border-adsk-lightgray px-4 py-2">
                  {rows.map((finding) => <FindingRow key={finding.key} finding={finding} decision={decisions.get(decisionKey(finding))} canSave={Boolean(owner)} owner={owner} />)}
                </ul>
              </details>;
            })}</div>
          </section>;
        })}
      </div>
    </Card>}
  </div>;
}
