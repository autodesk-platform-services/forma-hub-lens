"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  demoPreferencesKey, emptyDemoPreferences, parseDemoPreferences, safeDemoViewPath,
  DEMO_PREFERENCES_EVENT, reviewKey, type DemoPreferences, type DemoReview,
} from "@/lib/demoBrowserState";

export function useDemoPreferences(owner: string | null) {
  const key = demoPreferencesKey(owner);
  const [state, setState] = useState<DemoPreferences>(emptyDemoPreferences);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => {
      try { setState(key ? parseDemoPreferences(window.localStorage.getItem(key)) : emptyDemoPreferences()); }
      catch { setError("Browser storage is unavailable. Preferences cannot be saved in this browser."); }
      setReady(true);
    };
    load();
    window.addEventListener(DEMO_PREFERENCES_EVENT, load);
    window.addEventListener("storage", load);
    return () => { window.removeEventListener(DEMO_PREFERENCES_EVENT, load); window.removeEventListener("storage", load); };
  }, [key]);
  const update = useCallback((change: (current: DemoPreferences) => DemoPreferences): boolean => {
    if (!key) { setError("Demo preferences are unavailable. Reload this page to try again."); return false; }
    try {
      const next = change(parseDemoPreferences(window.localStorage.getItem(key)));
      window.localStorage.setItem(key, JSON.stringify(next));
      setState(next); setError("");
      window.dispatchEvent(new Event(DEMO_PREFERENCES_EVENT));
      return true;
    } catch { setError("Could not save browser preferences. Check your browser storage settings."); return false; }
  }, [key]);
  return { state, ready, error, update };
}

const button = "rounded border border-adsk-lightgray bg-adsk-white px-2.5 py-1.5 text-xs text-adsk-black hover:bg-adsk-offwhite";

export function DemoWatchButton({ owner, kind, targetId, label }: {
  owner: string | null; kind: "project" | "person"; targetId: string; label: string;
}) {
  const { state, ready, error, update } = useDemoPreferences(owner);
  const watched = state.watched.some((item) => item.kind === kind && item.targetId === targetId);
  return <span className="inline-flex flex-col gap-1">
    <button type="button" className={button} disabled={!ready || !owner} aria-pressed={watched} onClick={() => update((current) => ({
      ...current, watched: watched ? current.watched.filter((item) => item.kind !== kind || item.targetId !== targetId)
        : [{ kind, targetId, label: label.slice(0, 160), createdAt: Date.now() }, ...current.watched].slice(0, 200),
    }))}>{watched ? "★ Watching" : "☆ Watch"}</button>
    {error && <span role="alert" className="text-[10px] text-adsk-gray">{error}</span>}
  </span>;
}

export function DemoSavedCounts({ owner }: { owner: string | null }) {
  const { state } = useDemoPreferences(owner);
  return <div className="grid grid-cols-3 gap-2 text-center text-xs text-adsk-gray">
    <div><span className="tnum block text-xl font-semibold">{state.views.length}</span> saved views</div>
    <div><span className="tnum block text-xl font-semibold">{state.watched.filter((item) => item.kind === "project").length}</span> projects</div>
    <div><span className="tnum block text-xl font-semibold">{state.watched.filter((item) => item.kind === "person").length}</span> people</div>
  </div>;
}

export function DemoReviewControls({ owner, area, projectId, rule = "" }: {
  owner: string | null; area: DemoReview["area"]; projectId: string; rule?: string;
}) {
  const { state, ready, error, update } = useDemoPreferences(owner);
  const key = reviewKey(area, projectId, rule);
  const decision = state.reviews.find((row) => reviewKey(row.area, row.projectId, row.rule) === key &&
    (row.choice !== "snoozed" || (row.untilAt ?? 0) > Date.now()));
  const choices: Array<[DemoReview["choice"], string]> = area === "governance"
    ? [["acknowledged", "Acknowledge"], ["snoozed", "Snooze 30 days"], ["ignored", "Ignore for this project"]]
    : [["keep-active", "Keep active"], ["snoozed", "Snooze 90 days"], ["prepare-archive", "Prepare archive"]];
  function choose(choice: DemoReview["choice"] | null) {
    update((current) => ({ ...current, reviews: [
      ...(choice ? [{ area, projectId, rule, choice, untilAt: choice === "snoozed" ? Date.now() + (area === "governance" ? 30 : 90) * 86400000 : null, updatedAt: Date.now() }] : []),
      ...current.reviews.filter((row) => reviewKey(row.area, row.projectId, row.rule) !== key),
    ].slice(0, 500) }));
  }
  return <div className="mt-3 space-y-2">
    {decision && <p className="text-xs text-adsk-black">Saved in this browser: <strong>{choices.find(([choice]) => choice === decision.choice)?.[1] ?? decision.choice}</strong>{decision.untilAt ? ` · until ${new Date(decision.untilAt).toLocaleDateString()}` : ""}</p>}
    <div className="flex flex-wrap gap-2">{choices.map(([choice, label]) => <button key={choice} type="button" disabled={!ready || !owner} className={button} onClick={() => choose(choice)}>{label}</button>)}
      {decision && <button type="button" className={button} onClick={() => choose(null)}>Clear my decision</button>}
    </div>
    {error && <p role="alert" className="text-xs text-adsk-gray">{error}</p>}
  </div>;
}

export function DemoSavedItems({ owner, pathToSave }: { owner: string | null; pathToSave: string | null }) {
  const { state, ready, error, update } = useDemoPreferences(owner);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  return <div className="space-y-5">
    <p className="text-sm text-adsk-gray">Demo views, watchlists, and review decisions stay in this browser. They create no monitoring and are never stored on the server. Anyone using this browser profile can see these preferences.</p>
    {error && <p role="alert" className="text-xs text-adsk-gray">{error}</p>}
    {notice && <p role="status" className="text-xs text-adsk-black">{notice}</p>}
    {pathToSave && <form className="flex flex-wrap items-end gap-3 rounded border border-adsk-lightgray bg-white p-4" onSubmit={(event) => {
      event.preventDefault(); const path = safeDemoViewPath(pathToSave); if (!path || !name.trim()) return;
      if (state.views.length >= 50) { setNotice("Remove a view before saving another; the limit is 50."); return; }
      const now = Date.now();
      if (update((current) => ({ ...current, views: [{ id: crypto.randomUUID(), name: name.trim().slice(0, 80), path, createdAt: now, updatedAt: now }, ...current.views] }))) { setName(""); setNotice("View saved in this browser."); }
    }}><label className="text-xs">View name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className="mt-1 block rounded border border-adsk-lightgray px-3 py-2" /></label>
      <button className={button} disabled={!ready || !owner}>Save view</button><code className="w-full text-xs text-adsk-gray">{pathToSave}</code></form>}
    <section className="rounded border border-adsk-lightgray bg-white p-4"><h2 className="text-sm font-semibold">Saved views ({state.views.length})</h2>
      <ul className="mt-3 space-y-2">{state.views.map((view) => <li key={view.id} className="flex items-center justify-between gap-3 text-sm"><Link href={view.path} className="text-adsk-link">{view.name}</Link><button className={button} onClick={() => update((current) => ({ ...current, views: current.views.filter((row) => row.id !== view.id) }))}>Remove</button></li>)}</ul>
      {ready && !state.views.length && <p className="mt-2 text-xs text-adsk-gray">Open Activity, Projects, People, Search, or Governance, set filters, then choose Save view.</p>}
    </section>
    <section className="rounded border border-adsk-lightgray bg-white p-4"><h2 className="text-sm font-semibold">Watchlist ({state.watched.length})</h2><ul className="mt-3 space-y-2">{state.watched.map((item) => <li key={`${item.kind}:${item.targetId}`} className="flex items-center justify-between gap-3 text-sm"><Link href={`/${item.kind === "project" ? "projects" : "people"}/${encodeURIComponent(item.targetId)}`} className="text-adsk-link">{item.label}</Link><button className={button} onClick={() => update((current) => ({ ...current, watched: current.watched.filter((row) => row.kind !== item.kind || row.targetId !== item.targetId) }))}>Remove</button></li>)}</ul>{ready && !state.watched.length && <p className="mt-2 text-xs text-adsk-gray">Use Watch on a person profile or search result.</p>}</section>
    <button className={button} disabled={!ready || !owner} onClick={() => { if (update(() => emptyDemoPreferences())) setNotice("Demo saved items and review decisions reset in this browser."); }}>Reset my demo preferences</button>
  </div>;
}
