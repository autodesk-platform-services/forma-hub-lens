import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { cachedProjects } from "@/lib/aps/admin";
import { requireAccountAdmin } from "@/lib/aps/hubAdmin";
import { configProblems } from "@/lib/env";
import { inspectOffboarding, type OffboardingSummary } from "@/lib/offboarding";
import { getPerson, listAccessMatrix, peopleSourceStatus, personActivityObservation, PEOPLE_PAGE_SIZE } from "@/lib/people";
import { Card, EmptyState, Pill, formatDate, formatDateTime } from "@/components/ui";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { savedViewsOwner } from "@/lib/savedViews";
import { DemoWatchButton } from "@/components/DemoPreferences";
import { demoPersonAssociations } from "@/lib/demoData";

export const dynamic = "force-dynamic";

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;
  const demoMode = session.mode === "demo";

  const { id } = await params;
  const query = await searchParams;
  const requestedPage = typeof query.page === "string" ? Number(query.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const lookup = id.length <= 200 ? getPerson(id) : { state: "missing" as const };
  const sources = peopleSourceStatus();

  if (lookup.state !== "found") {
    const message = demoMode ? "This person is not in the synthetic sample data set." : lookup.state === "ambiguous"
      ? "More than one admin_users.csv record has this source ID. This app will not merge their access."
      : lookup.state === "unavailable"
        ? "The uploaded user table has no usable ID column."
        : "This person is not in the currently uploaded user table. A newer upload may have replaced the snapshot.";
    return (
      <div className="space-y-4">
        <Link href="/people" className="text-xs text-adsk-link">← People</Link>
        <Card><EmptyState title="Person record unavailable">{message}</EmptyState></Card>
      </div>
    );
  }

  const person = lookup.person;
  const sampleAccess = demoMode ? demoPersonAssociations(person.id ?? id) : { products: [], roles: [] };
  const activity = personActivityObservation(person);
  const matrix = sources.matrixReady
    ? listAccessMatrix({ userId: id, page })
    : { rows: [], total: 0, page };
  const pages = Math.max(1, Math.ceil(matrix.total / PEOPLE_PAGE_SIZE));
  const personUrl = `/people/${encodeURIComponent(id)}`;
  const userSource = sources.sources.find((source) => source.name === "admin_users");
  const membershipSource = sources.sources.find((source) => source.name === "admin_project_users");
  const syncedProjectIds = new Set(cachedProjects().map((project) => project.id.toLowerCase()));
  const canCheckLive = !demoMode && session.hubRole === "hub_admin" && Boolean(person.email);
  const liveRequested = !demoMode && query.live === "1" && session.hubRole === "hub_admin" && Boolean(person.email);
  let live: OffboardingSummary | null = null;
  let liveError: string | null = null;
  if (liveRequested && person.email) {
    try {
      await requireAccountAdmin(session);
      live = await inspectOffboarding(session, person.email);
      if (!live) liveError = "Autodesk did not return an exact current hub user for this email.";
    } catch (error) {
      liveError = error instanceof Error ? error.message : "Could not inspect current access.";
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/people" className="text-xs text-adsk-link">← People</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-legend text-2xl text-adsk-black">{person.name ?? person.email ?? person.id}</h1>
          <p className="mt-1 text-sm text-adsk-gray">{person.email ?? (demoMode ? "No sample email" : "No email in the uploaded user row")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {person.id && <Link
            href={`${personUrl}/compare`}
            className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-xs text-adsk-link"
          >Compare access</Link>}
          {!demoMode && session.hubRole === "hub_admin" && person.email && <Link
            href={`${personUrl}?live=1`}
            className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-xs text-adsk-link"
          >{liveRequested ? "Refresh current access" : "Check current access"}</Link>}
          {(session.hubRole === "hub_admin" || demoMode) && person.email && <Link
            href={`/offboarding?email=${encodeURIComponent(person.email)}`}
            className="rounded border border-adsk-gold bg-adsk-yellow px-3 py-1.5 text-xs text-adsk-black"
          >{demoMode ? "Explore sample removal plan" : "Plan access removal"}</Link>}
          {person.id && savedViewsOwner(session) && (
            <DemoWatchButton owner={savedViewsOwner(session)} kind="person" targetId={person.id} label={person.name ?? person.email ?? person.id} />
          )}
        </div>
      </div>
      <nav aria-label="Person workspace" className="flex flex-wrap gap-1.5 rounded-lg border border-adsk-lightgray bg-adsk-white p-2 text-xs">
        <Link href="#person-projects" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Projects</Link>
        <Link href={canCheckLive && !liveRequested ? `${personUrl}?live=1#person-products` : "#person-products"} className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Products</Link>
        <Link href={canCheckLive && !liveRequested ? `${personUrl}?live=1#person-roles` : "#person-roles"} className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Roles</Link>
        <Link href="#person-activity" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Activity</Link>
        <Link href="#person-permissions" className="rounded px-2 py-1 text-adsk-link hover:bg-adsk-offwhite">Permissions</Link>
      </nav>
      <div role="note" className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs text-adsk-black">
        {demoMode ? <>
          This profile uses synthetic people, membership, product, role, and activity records. It does not show current Autodesk access.
          {sources.warnings.length > 0 && <span> Some sample tables are missing or incomplete.</span>}
          {person.email && <span> The removal plan is a simulation.</span>}
        </> : <>
          This profile describes uploaded CSV data, not current Forma access. User table imported{" "}
          {formatDateTime(userSource?.uploadedAt)}; memberships imported{" "}
          {formatDateTime(membershipSource?.uploadedAt)}. Tables can come from different ZIPs.
          {sources.warnings.length > 0 && <span> Some source files are missing, incomplete or truncated.</span>}
          {session.hubRole === "hub_admin" && person.email && <span> Access removal starts with a separate live exact-email check and audited preview.</span>}
        </>}
      </div>

      <Card title="User record">
        <dl className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <Field label={demoMode ? "Sample user ID" : "Data Connector user ID"} value={person.id} />
          <Field label={demoMode ? "Sample Autodesk ID" : "Autodesk ID"} value={person.autodeskId} />
          <Field label="Status" value={person.status} />
          <Field label="Email" value={person.email} />
          <div><dt className="font-medium uppercase tracking-wide text-adsk-gray">Company</dt><dd className="mt-1 break-all text-adsk-black">{person.companyId ? <Link href={`/companies/${encodeURIComponent(person.companyId)}`} className="text-adsk-link hover:underline">{person.companyId}</Link> : "—"}</dd></div>
          <Field label={demoMode ? "Sample last sign-in" : "Last sign-in"} value={formatDate(person.lastSignIn)} />
        </dl>
      </Card>

      <div id="person-projects" className="space-y-5 scroll-mt-20">
      {liveRequested && <Card title="Current Forma access" subtitle="Checked on demand using the Forma Admin API">
        {liveError && <p role="alert" className="text-xs text-adsk-linkvisited">{liveError}</p>}
        {live && <>
          <p className="text-xs text-adsk-gray">Checked {formatDateTime(live.checkedAt)}. This read reflects the current API response; observed activity is from local extracts through {formatDateTime(live.activityDataThrough)}.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-adsk-lightgray p-3 text-xs"><strong>{live.projects.length.toLocaleString()}</strong><div className="text-adsk-gray">Projects</div></div>
            <div className="rounded border border-adsk-lightgray p-3 text-xs"><strong>{live.products.length.toLocaleString()}</strong><div className="text-adsk-gray">Product associations</div></div>
            <div className="rounded border border-adsk-lightgray p-3 text-xs"><strong>{live.roles.length.toLocaleString()}</strong><div className="text-adsk-gray">Role associations</div></div>
          </div>
          <div className="mt-4"><h2 className="text-xs font-semibold">Current projects</h2>{live.projects.length ? <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-xs">{live.projects.map((project) => <li key={project.id} className="rounded border border-adsk-lightgray px-2 py-1.5">{syncedProjectIds.has(project.id.toLowerCase()) ? <Link href={`/projects/${encodeURIComponent(project.id)}`} className="text-adsk-link hover:underline">{project.name ?? project.id}</Link> : <span>{project.name ?? project.id}</span>}<span className="ml-2 text-adsk-gray">{project.status ?? ""}</span>{!syncedProjectIds.has(project.id.toLowerCase()) && <span className="ml-2 text-adsk-gray">Not in synced project inventory</span>}</li>)}</ul> : <p className="mt-2 text-xs text-adsk-gray">No current project associations returned.</p>}</div>
          <Link href={`/offboarding?email=${encodeURIComponent(live.email)}`} className="mt-4 inline-block text-xs text-adsk-link hover:underline">Review access cleanup plan →</Link>
        </>}
      </Card>}

      <Card title="Project access" subtitle={`${matrix.total.toLocaleString()} ${demoMode ? "sample" : "snapshot"} membership records`}>
        {!sources.matrixReady ? (
          <EmptyState title="Membership data unavailable.">
            {demoMode ? "The demo owner can restore the synthetic membership table." : <>Upload an Insight Data Connector ZIP containing <code>admin_project_users.csv</code> with user and project IDs in <Link href="/data-health#reporting-dataset" className="text-adsk-link">Data health</Link>.</>}
          </EmptyState>
        ) : matrix.rows.length === 0 ? (
          <EmptyState title={page > 1 ? "No records on this page." : "No project memberships recorded for this user ID."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-adsk-gray">
                <tr className="border-b border-adsk-lightgray">
                  <th className="py-2 pr-3 font-medium">Project</th>
                  <th className="py-2 pr-3 font-medium">Membership</th>
                  <th className="py-2 pr-3 font-medium">Access level</th>
                  <th className="py-2 pr-3 font-medium">Products</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.rowId} className="border-b border-adsk-offwhite align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-adsk-black">{row.projectId && syncedProjectIds.has(row.projectId.toLowerCase()) ? <Link href={`/projects/${encodeURIComponent(row.projectId)}`} className="text-adsk-link hover:underline">{row.projectName ?? row.projectId}</Link> : row.projectName ?? row.projectId ?? "(no project ID)"}</div>
                      {row.projectName && <div className="font-mono text-[10px] text-adsk-gray">{row.projectId}</div>}
                    </td>
                    <td className="py-2 pr-3">{row.membershipStatus ?? "—"}</td>
                    <td className="py-2 pr-3">{row.accessLevel ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {row.products === null ? <Pill tone="warn">Unavailable</Pill>
                        : row.products.length === 0 ? "None recorded"
                          : row.products.map((product) => `${product.key}${product.access ? ` (${product.access})` : ""}`).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-adsk-gray">
          {demoMode
            ? "Sample product and role associations use exact synthetic user and project IDs. They do not describe current Autodesk access."
            : <>Product rows are joined by exact user and project IDs. Role definitions alone do not identify this person&apos;s role assignments.</>}
        </p>
      </Card>
      {pages > 1 && (
        <nav aria-label="Membership pages" className="flex items-center justify-between text-xs text-adsk-gray">
          <span>Page {matrix.page.toLocaleString()} of {pages.toLocaleString()}</span>
          <div className="flex gap-2">
            {matrix.page > 1 && <Link href={`${personUrl}?page=${matrix.page - 1}`} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5">Previous</Link>}
            {matrix.page < pages && <Link href={`${personUrl}?page=${matrix.page + 1}`} className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5">Next</Link>}
          </div>
        </nav>
      )}
      </div>

      <div id="person-products" className="scroll-mt-20"><Card title="Products" subtitle={demoMode ? "Synthetic product associations joined by exact sample user and project IDs" : "Current associations when checked against the Forma Admin API"}>
        {demoMode ? sampleAccess.products.length ? <ul className="space-y-1 text-xs">{sampleAccess.products.map((product) => <li key={product.key} className="rounded border border-adsk-lightgray px-3 py-2">{product.name}<span className="ml-2 text-adsk-gray">{product.projectIds.length} sample project(s)</span></li>)}</ul> : <p className="text-xs text-adsk-gray">No sample product associations are recorded.</p>
          : live ? live.products.length ? <ul className="space-y-1 text-xs">{live.products.map((product, index) => <li key={`${product.id ?? product.key ?? index}-${index}`} className="rounded border border-adsk-lightgray px-3 py-2">{product.name ?? product.key ?? product.id ?? "Unknown product"}{product.projectIds?.length ? <span className="ml-2 text-adsk-gray">{product.projectIds.length} project(s)</span> : null}</li>)}</ul> : <p className="text-xs text-adsk-gray">No product associations returned by Autodesk.</p>
          : <p className="text-xs text-adsk-gray">{liveError ?? (canCheckLive ? "Check current access to load product associations." : "Current associations require Hub Admin access and a known email address.")}</p>}
        {canCheckLive && !live && <Link href={`${personUrl}?live=1#person-products`} className="mt-2 inline-block text-xs text-adsk-link hover:underline">Check current access →</Link>}
      </Card></div>

      <div id="person-roles" className="scroll-mt-20"><Card title="Roles" subtitle={demoMode ? "Synthetic role assignments joined by exact sample user and project IDs" : "Current associations when checked against the Forma Admin API"}>
        {demoMode ? sampleAccess.roles.length ? <ul className="space-y-1 text-xs">{sampleAccess.roles.map((role) => <li key={role.key} className="rounded border border-adsk-lightgray px-3 py-2">{role.name}<span className="ml-2 text-adsk-gray">{role.projectIds.length} sample project(s)</span></li>)}</ul> : <p className="text-xs text-adsk-gray">No sample role assignments are recorded.</p>
          : live ? live.roles.length ? <ul className="space-y-1 text-xs">{live.roles.map((role, index) => <li key={`${role.id ?? role.key ?? index}-${index}`} className="rounded border border-adsk-lightgray px-3 py-2">{role.name ?? role.key ?? role.id ?? "Unknown role"}{role.projectIds?.length ? <span className="ml-2 text-adsk-gray">{role.projectIds.length} project(s)</span> : null}</li>)}</ul> : <p className="text-xs text-adsk-gray">No role associations returned by Autodesk.</p>
          : <p className="text-xs text-adsk-gray">{liveError ?? (canCheckLive ? "Check current access to load role associations." : "Current associations require Hub Admin access and a known email address.")}</p>}
        {canCheckLive && !live && <Link href={`${personUrl}?live=1#person-roles`} className="mt-2 inline-block text-xs text-adsk-link hover:underline">Check current access →</Link>}
      </Card></div>

      <div id="person-activity" className="scroll-mt-20"><Card title="Activity" subtitle={demoMode ? "Observed in synthetic sample activity" : "Observed in locally ingested Data Connector extracts"}>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <Field label="Last observed activity" value={formatDateTime(activity.lastObservedAt)} />
          <Field label="Activity data through" value={formatDateTime(activity.activityDataThrough)} />
        </dl>
        <p className="mt-3 text-xs text-adsk-gray">{demoMode
          ? "These are sample events. Explorer searches synthetic actor fields as text and may return namesakes."
          : "No matching event does not establish inactivity. Explorer searches actor fields as text and may return namesakes; verify the records."}</p>
        <Link href={`/activity?actor=${encodeURIComponent(person.autodeskId ?? person.email ?? person.id ?? id)}`} className="mt-2 inline-block text-xs text-adsk-link hover:underline">Search observed activity →</Link>
      </Card></div>

      <div id="person-permissions" className="scroll-mt-20"><Card title="Docs permissions">
        <p className="text-xs text-adsk-gray">Folder assignments can come from users, roles, companies and inheritance. Lens does not calculate this person&apos;s effective Docs permission or filter the permission explorer by person.</p>
        <Link href="/permissions" className="mt-2 inline-block text-xs text-adsk-link hover:underline">Browse project folder assignments →</Link>
      </Card></div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wide text-adsk-gray">{label}</dt>
      <dd className="mt-1 break-all text-adsk-black">{value ?? "—"}</dd>
    </div>
  );
}
