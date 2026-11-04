"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useDemoPreferences } from "./DemoPreferences";

type View = { id: string; name: string; path: string };
type Watch = { kind: "project" | "person"; targetId: string; label: string };
type Summary = { hasOwner: boolean; views: View[]; watched: Watch[] };

export function HeaderSavedMenu({ initial, owner = null }: { initial: Summary; owner?: string | null }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { state, ready } = useDemoPreferences(owner);
  const summary = { hasOwner: initial.hasOwner, views: state.views.slice(0, 4), watched: state.watched.slice(0, 4) };
  const loading = !ready;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) detailsRef.current?.removeAttribute("open");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") detailsRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);


  const close = () => detailsRef.current?.removeAttribute("open");
  return (
    <details ref={detailsRef} className="relative">
      <summary aria-label="Saved items menu"
        className="cursor-pointer list-none rounded px-2 py-1.5 font-legend text-xs text-adsk-lightgray hover:bg-white/10 hover:text-adsk-white [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="mr-1 text-adsk-yellow">★</span> Saved <span aria-hidden="true" className="text-[10px]">▾</span>
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded border border-adsk-gray bg-adsk-black p-2 shadow-xl">
        <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-adsk-gray">
          <span>Saved views</span>{loading && <span>Updating…</span>}
        </div>
        {summary.views.length ? summary.views.map((view) => (
          <Link key={view.id} href={view.path} onClick={close}
            className="block truncate rounded px-2 py-1.5 text-xs text-adsk-lightgray hover:bg-white/10 hover:text-adsk-white" title={view.name}>{view.name}</Link>
        )) : <p className="px-2 py-1.5 text-[11px] text-adsk-gray">No saved views yet.</p>}
        <div className="mt-2 border-t border-adsk-gray px-2 pt-2 text-[10px] uppercase tracking-wide text-adsk-gray">Watchlist</div>
        {summary.watched.length ? summary.watched.map((item) => (
          <Link key={`${item.kind}:${item.targetId}`}
            href={item.kind === "project" ? `/projects/${encodeURIComponent(item.targetId)}` : `/people/${encodeURIComponent(item.targetId)}`}
            onClick={close} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-adsk-lightgray hover:bg-white/10 hover:text-adsk-white">
            <span className="shrink-0 text-[10px] uppercase text-adsk-gray">{item.kind}</span><span className="truncate">{item.label}</span>
          </Link>
        )) : <p className="px-2 py-1.5 text-[11px] text-adsk-gray">No watched projects or people yet.</p>}
        {!summary.hasOwner && <p className="mt-2 px-2 text-[11px] text-adsk-gold">Demo saved items are unavailable. Reload this page to try again.</p>}
        <Link href="/views" onClick={close}
          className="mt-2 block rounded border-t border-adsk-gray px-2 py-2 text-xs font-medium text-adsk-yellow hover:bg-white/10">
          Manage saved items →
        </Link>
      </div>
    </details>
  );
}
