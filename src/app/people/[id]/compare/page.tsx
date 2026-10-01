import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { comparePersonAccess, type AccessRecord, type ProjectComparison } from "@/lib/personCompare";
import { getPerson, listPeople, peopleSourceStatus, type PersonRow } from "@/lib/people";
import { Card, EmptyState, Pill, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";

export const dynamic = "force-dynamic";

function personLabel(person: PersonRow): string {
  return person.name ?? person.email ?? person.id ?? "Unknown person";
}

function accessLabel(value: string | null): string {
  return value ?? "Unknown in snapshot";
}

function AccessCell({ access }: { access: AccessRecord | null }) {
  if (!access) return <span className="text-adsk-gray">No row observed</span>;
  if (access.ambiguous) return <Pill tone="warn">Duplicate rows; access unknown</Pill>;
  return <div className="space-y-1">
    <div>Membership: {accessLabel(access.membershipStatus)}</div>
    <div>Access: {accessLabel(access.accessLevel)}</div>
    <div>Products: {access.products === null ? "Unknown; product table unavailable"
      : access.products.length === 0 ? "None recorded in uploaded table"
        : access.products.map((product) => `${product.key}${product.access ? ` (${product.access})` : ""}`).join(", ")}</div>
  </div>;
}

function ProjectRows({ title, subtitle, rows, empty }: {
  title: string; subtitle: string; rows: ProjectComparison[]; empty: string;
}) {
  return <Card title={`${title} (${rows.length})`} subtitle={subtitle}>
    {rows.length === 0 ? <p className="text-xs text-adsk-gray">{empty}</p> : <div className="max-h-[36rem] overflow-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="sticky top-0 bg-adsk-white text-[11px] uppercase tracking-wide text-adsk-gray">
          <tr className="border-b border-adsk-lightgray"><th className="py-2 pr-3 font-medium">Project</th><th className="py-2 pr-3 font-medium">First person</th><th className="py-2 pr-3 font-medium">Second person</th><th className="py-2 font-medium">Comparison</th></tr>
        </thead>
        <tbody>{rows.map((row) => <tr key={row.projectId} className="border-b border-adsk-offwhite align-top">
          <td className="py-2 pr-3"><div className="font-medium text-adsk-black">{row.projectName ?? row.projectId}</div><div className="font-mono text-[10px] text-adsk-gray">{row.projectId}</div></td>
          <td className="py-2 pr-3"><AccessCell access={row.first} /></td>
          <td className="py-2 pr-3"><AccessCell access={row.second} /></td>
          <td className="py-2">{row.first && row.second
            ? <><Pill tone={row.result === "different" ? "warn" : row.result === "same" ? "good" : "default"}>{row.result === "different" ? "Different" : row.result === "same" ? "Same recorded fields" : "Unknown"}</Pill>{row.differences.length > 0 && <div className="mt-1 text-adsk-gray">{row.differences.join(", ")}</div>}</>
            : <Pill tone="default">Observed for one person</Pill>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </Card>;
}

export default async function ComparePeoplePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;

  const { id } = await params;
  const first = id.length <= 200 ? getPerson(id) : { state: "missing" as const };
  const query = await searchParams;
  const withId = typeof query.with === "string" ? query.with.trim() : "";
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
  const sources = peopleSourceStatus();
  if (first.state !== "found") {
    return <div className="space-y-4"><Link href="/people" className="text-xs text-adsk-link">← People</Link><Card><EmptyState title="First person unavailable">The source user ID is missing, ambiguous, or the uploaded user table is unavailable. Choose an unambiguous record from the directory.</EmptyState></Card></div>;
  }
  const second = withId && withId !== id && withId.length <= 200 ? getPerson(withId) : null;
  const comparison = second?.state === "found" ? comparePersonAccess(id, withId) : null;
  const candidates = search ? listPeople(search, 1) : null;
  const base = `/people/${encodeURIComponent(id)}/compare`;
  const userSource = sources.sources.find((source) => source.name === "admin_users");

  return <div className="space-y-5">
    <Link href={`/people/${encodeURIComponent(id)}`} className="text-xs text-adsk-link">← {personLabel(first.person)}</Link>
    <div>
      <h1 className="font-legend text-2xl text-adsk-black">Compare project access</h1>
      <p className="mt-1 max-w-3xl text-sm text-adsk-gray">Compare recorded project memberships for two exact source user IDs in the uploaded Data Connector snapshot.</p>
    </div>
    <div role="note" className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs text-adsk-black">
      Uploaded snapshot, not current Forma access. User table imported {formatDateTime(userSource?.uploadedAt)}; membership table imported {formatDateTime(comparison?.state === "ready" ? comparison.importedAt : sources.sources.find((source) => source.name === "admin_project_users")?.uploadedAt)}. Files may represent different extracts or another hub. IDs must match exactly; absence of a row is not proof of no current access.
    </div>

    <Card title="Choose a second person" subtitle={`First person: ${personLabel(first.person)} · source ID ${id}`}>
      <form action={base} method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-adsk-gray">Search uploaded directory by name, email or ID
          <input name="q" defaultValue={search} maxLength={120} className="mt-1 block w-72 max-w-full rounded border border-adsk-lightgray px-3 py-1.5 text-sm text-adsk-black" />
        </label>
        <button type="submit" className="rounded border border-adsk-gold bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black">Find people</button>
      </form>
      {candidates && <div className="mt-4">
        <p className="mb-2 text-xs text-adsk-gray">{candidates.total.toLocaleString()} matching source row(s). Showing the first {candidates.rows.length}; search more specifically if needed.</p>
        {candidates.rows.length ? <ul className="max-h-64 space-y-1 overflow-auto">{candidates.rows.map((candidate, index) => <li key={`${candidate.id ?? "missing"}-${index}`} className="rounded border border-adsk-lightgray px-3 py-2 text-xs">
          {candidate.id && candidate.id !== id && !candidate.duplicateId
            ? <Link href={`${base}?with=${encodeURIComponent(candidate.id)}`} className="font-medium text-adsk-link hover:underline">Compare with {personLabel(candidate)} →</Link>
            : <span className="font-medium text-adsk-gray">{personLabel(candidate)} {candidate.id === id ? "(first person)" : "(ID missing or ambiguous)"}</span>}
          <div className="font-mono text-[10px] text-adsk-gray">{candidate.id ?? "No source ID"}{candidate.email ? ` · ${candidate.email}` : ""}</div>
        </li>)}</ul> : <p className="text-xs text-adsk-gray">No matching uploaded users.</p>}
      </div>}
      {sources.sources.find((source) => source.name === "admin_users")?.truncated && <p role="alert" className="mt-3 text-xs text-adsk-linkvisited">The uploaded user table is truncated; candidate search is incomplete.</p>}
    </Card>

    {withId === id && <Card><EmptyState title="Choose a different person">A person cannot be compared with the same source ID.</EmptyState></Card>}
    {withId && withId !== id && second?.state !== "found" && <Card><EmptyState title="Second person unavailable">This exact source ID is missing or ambiguous in the uploaded user table. Search for another person.</EmptyState></Card>}
    {second?.state === "found" && <>
      <Card title="People compared" subtitle="Identity comes from admin_users.csv in the uploaded snapshot">
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          {[first.person, second.person].map((person) => <div key={person.id} className="rounded border border-adsk-lightgray p-3"><div className="font-medium text-adsk-black">{personLabel(person)}</div><div className="mt-1 font-mono text-[10px] text-adsk-gray">{person.id}</div><div className="mt-1 text-adsk-gray">{person.email ?? "Email unknown"}</div></div>)}
        </div>
      </Card>
      {comparison?.state === "unavailable" && <Card><EmptyState title="Comparison unavailable">{comparison.reason}</EmptyState></Card>}
      {comparison?.state === "ready" && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded border border-adsk-lightgray bg-adsk-white p-3 text-xs"><strong className="text-lg">{comparison.shared.length}</strong><div className="text-adsk-gray">Shared recorded projects</div></div>
          <div className="rounded border border-adsk-lightgray bg-adsk-white p-3 text-xs"><strong className="text-lg">{comparison.onlyFirst.length}</strong><div className="text-adsk-gray">Observed only for first person</div></div>
          <div className="rounded border border-adsk-lightgray bg-adsk-white p-3 text-xs"><strong className="text-lg">{comparison.onlySecond.length}</strong><div className="text-adsk-gray">Observed only for second person</div></div>
        </div>
        {!comparison.coverageComplete && <div role="alert" className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs">The membership table is truncated or has rows without project IDs. These observed-only groups are incomplete.</div>}
        {comparison.warnings.length > 0 && <Card title="Comparison limits"><ul className="space-y-1 text-xs text-adsk-gray">{comparison.warnings.map((warning, index) => <li key={index}>• {warning}</li>)}</ul></Card>}
        <ProjectRows title="Shared recorded projects" subtitle="Field differences are shown only when both recorded values are known." rows={comparison.shared} empty="No shared project IDs recorded in this snapshot." />
        <ProjectRows title="Observed only for first person" subtitle="Presence is based on this uploaded membership table, not live access." rows={comparison.onlyFirst} empty="No projects observed only for the first person." />
        <ProjectRows title="Observed only for second person" subtitle="Presence is based on this uploaded membership table, not live access." rows={comparison.onlySecond} empty="No projects observed only for the second person." />
      </>}
    </>}
  </div>;
}
