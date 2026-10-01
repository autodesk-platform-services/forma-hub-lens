import Link from "next/link";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import {
  listSavedViews,
  listWatchItems,
  normalizeSavedPath,
  savedViewsOwner,
} from "@/lib/savedViews";
import { Card, EmptyState, formatDateTime } from "@/components/ui";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { SetupRequired, SignInRequired } from "@/components/Gate";
import { deleteViewAction, removeWatchAction, saveViewAction } from "./actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
function value(params: Params, key: string): string {
  return typeof params[key] === "string" ? params[key] : "";
}

export default async function ViewsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupRequired problems={problems} />;
  const session = await getSession();
  if (!session) return <SignInRequired />;

  const owner = savedViewsOwner(session);
  const params = await searchParams;
  let pathToSave: string | null = null;
  const candidate = value(params, "save");
  if (candidate) {
    try { pathToSave = normalizeSavedPath(candidate); } catch { /* show guidance below */ }
  }
  const views = owner ? listSavedViews(owner) : [];
  const watched = owner ? listWatchItems(owner) : [];
  const notice = value(params, "notice").slice(0, 180);
  const error = value(params, "error").slice(0, 180);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-legend text-2xl text-adsk-black">My saved items</h1>
        <p className="mt-1 max-w-3xl text-sm text-adsk-gray">
          Keep useful filters and a short list of people or projects in this app&apos;s local database.
          They belong to your Autodesk identity and do not create alerts or refresh source data.
        </p>
        <div className="mt-2"><ProvenanceBadge source="lens-local" /></div>
      </div>

      {notice && <p role="status" className="rounded border border-adsk-lightgray bg-adsk-teal/15 px-4 py-3 text-xs text-adsk-black">{notice}</p>}
      {error && <p role="alert" className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-3 text-xs text-adsk-black">{error}</p>}

      {!owner ? (
        <Card><EmptyState title="Your saved items are unavailable.">
          Autodesk did not provide a stable user ID or email for this session. Sign out and in again.
        </EmptyState></Card>
      ) : (
        <>
          <Card title="Save a view">
            {pathToSave ? (
              <form action={saveViewAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="path" value={pathToSave} />
                <label className="text-xs text-adsk-gray">
                  View name
                  <input name="name" required maxLength={80} placeholder="e.g. Recent issues" className="mt-1 block w-64 rounded border border-adsk-lightgray bg-adsk-white px-3 py-1.5 text-sm text-adsk-black" />
                </label>
                <button type="submit" className="rounded border border-adsk-gold bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black">Save view</button>
                <code className="w-full break-all text-[11px] text-adsk-gray">{pathToSave}</code>
              </form>
            ) : (
              <p className="text-xs text-adsk-gray">
                Open <Link href="/activity" className="text-adsk-link">Activity</Link>,{" "}
                <Link href="/people" className="text-adsk-link">People</Link>, or{" "}
                <Link href="/search" className="text-adsk-link">Portfolio search</Link> or{" "}
                <Link href="/governance" className="text-adsk-link">Governance</Link>, set filters, then choose <strong>Save view</strong> on that page.
              </p>
            )}
          </Card>

          <Card title={`Saved views (${views.length})`}>
            {views.length === 0 ? <EmptyState title="No views saved yet." /> : (
              <ul className="divide-y divide-adsk-offwhite">
                {views.map((view) => (
                  <li key={view.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                    <div className="min-w-0">
                      <Link href={view.path} className="font-medium text-adsk-black hover:text-adsk-link">{view.name}</Link>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-adsk-gray" title={view.path}>{view.path}</div>
                      <div className="mt-0.5 text-[10px] text-adsk-gray">Saved {formatDateTime(view.createdAt)}</div>
                    </div>
                    <form action={deleteViewAction}>
                      <input type="hidden" name="id" value={view.id} />
                      <button type="submit" className="rounded border border-adsk-lightgray px-2.5 py-1.5 text-xs text-adsk-gray hover:text-adsk-black">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Watchlist (${watched.length})`} subtitle="Bookmarks from local project and people records; no notifications or automatic monitoring.">
            {watched.length === 0 ? (
              <EmptyState title="Your watchlist is empty.">
                Add a project from <Link href="/search" className="text-adsk-link">Portfolio search</Link> or a person from their profile.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-adsk-offwhite">
                {watched.map((item) => (
                  <li key={`${item.kind}:${item.targetId}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                    <div className="min-w-0">
                      <span className="mr-2 rounded border border-adsk-lightgray px-1.5 py-0.5 text-[10px] uppercase text-adsk-gray">{item.kind}</span>
                      <Link
                        href={item.kind === "project" ? `/projects/${encodeURIComponent(item.targetId)}` : `/people/${encodeURIComponent(item.targetId)}`}
                        className="font-medium text-adsk-black hover:text-adsk-link"
                      >
                        {item.label}
                      </Link>
                      <div className="mt-1 truncate font-mono text-[10px] text-adsk-gray">{item.targetId} · added {formatDateTime(item.createdAt)}</div>
                    </div>
                    <form action={removeWatchAction}>
                      <input type="hidden" name="kind" value={item.kind} />
                      <input type="hidden" name="targetId" value={item.targetId} />
                      <button type="submit" className="rounded border border-adsk-lightgray px-2.5 py-1.5 text-xs text-adsk-gray hover:text-adsk-black">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
