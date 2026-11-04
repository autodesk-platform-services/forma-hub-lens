"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Suggestion = {
  kind: "project" | "person" | "company";
  id: string;
  title: string;
  detail: string;
  href: string;
};
type SuggestionResponse = {
  suggestions: Suggestion[];
  total: number;
};

export function HeaderSearch({ demoMode = false }: { demoMode?: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SuggestionResponse>({ suggestions: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);

  function show() {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function close() {
    dialogRef.current?.close();
    setOpen(false);
    setActive(-1);
  }
  function go(href: string) {
    close();
    router.push(href);
  }

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialogRef.current?.open) close(); else show();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    setActive(-1);
    setError(null);
    if (term.length < 2) {
      setResults({ suggestions: [], total: 0 });
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Suggestions are unavailable. Reload the page to try again.");
        const body = await response.json() as SuggestionResponse;
        if (!controller.signal.aborted) setResults(body);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setResults({ suggestions: [], total: 0 });
          setError(cause instanceof Error ? cause.message : "Suggestions are unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open]);

  const term = query.trim();
  const allHref = `/search?q=${encodeURIComponent(term)}`;
  const suggestions = results.suggestions;
  const optionCount = suggestions.length + (term ? 1 : 0);

  return (
    <>
      <button type="button" onClick={show}
        className="flex items-center gap-2 rounded border border-adsk-gray px-2.5 py-1.5 text-xs text-adsk-lightgray hover:border-adsk-white hover:text-adsk-white"
        aria-label="Search the portfolio">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" />
        </svg>
        <span>Search</span><span className="hidden text-[10px] text-adsk-gray sm:inline">⌘K</span>
      </button>
      <dialog ref={dialogRef} onClose={() => setOpen(false)}
        className="fixed inset-x-0 top-[12vh] m-0 mx-auto max-h-[76vh] w-[min(94vw,38rem)] overflow-hidden rounded-lg border border-adsk-lightgray bg-adsk-white p-0 text-adsk-black shadow-2xl backdrop:bg-black/60"
        aria-label="Search portfolio">
        <div className="flex items-center gap-2 border-b border-adsk-lightgray px-4 py-3">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-adsk-gray" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" />
          </svg>
          <input ref={inputRef} type="search" value={query} maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && optionCount) { event.preventDefault(); setActive((current) => (current + 1) % optionCount); }
              if (event.key === "ArrowUp" && optionCount) { event.preventDefault(); setActive((current) => (current - 1 + optionCount) % optionCount); }
              if (event.key === "Enter" && term) {
                event.preventDefault();
                go(active >= 0 && active < suggestions.length ? suggestions[active].href : allHref);
              }
              if (event.key === "Escape") close();
            }}
            role="combobox" aria-expanded={open} aria-controls="header-search-results"
            aria-activedescendant={active >= 0 ? `header-search-option-${active}` : undefined}
            placeholder="Search projects, people, companies…"
            className="min-w-0 flex-1 bg-transparent text-sm text-adsk-black outline-none placeholder:text-adsk-gray" />
          <button type="button" onClick={close} aria-label="Close search" className="rounded px-2 py-1 text-xs text-adsk-gray hover:bg-adsk-offwhite">Esc</button>
        </div>
        <div id="header-search-results" role="listbox" aria-label="Portfolio suggestions" className="max-h-[58vh] overflow-y-auto p-2">
          {!term && <p className="px-3 py-5 text-center text-xs text-adsk-gray">{demoMode
            ? "Search synthetic projects, people, and companies in the sample hub."
            : "Search the cached project inventory and uploaded people and company tables."}</p>}
          {term.length === 1 && <p className="px-3 py-5 text-center text-xs text-adsk-gray">Type one more character for suggestions, or press Enter to view all results.</p>}
          {loading && term.length >= 2 && <p role="status" className="px-3 py-3 text-xs text-adsk-gray">Searching local sources…</p>}
          {error && <p role="alert" className="px-3 py-3 text-xs text-adsk-linkvisited">{error}</p>}
          {!loading && !error && term.length >= 2 && suggestions.length === 0 && <p className="px-3 py-4 text-xs text-adsk-gray">No direct matches. View all results to widen the search.</p>}
          {!loading && suggestions.map((item, index) => (
            <button key={`${item.kind}:${item.id}`} id={`header-search-option-${index}`} role="option" aria-selected={active === index}
              type="button" onMouseEnter={() => setActive(index)} onClick={() => go(item.href)}
              className={`flex w-full items-center justify-between gap-3 rounded px-3 py-2.5 text-left hover:bg-adsk-offwhite ${active === index ? "bg-adsk-offwhite" : ""}`}>
              <span className="min-w-0"><span className="block truncate text-xs font-medium text-adsk-black">{item.title}</span><span className="block truncate text-[11px] text-adsk-gray">{item.detail}</span></span>
              <span className="shrink-0 rounded border border-adsk-lightgray px-1.5 py-0.5 text-[10px] uppercase text-adsk-gray">{item.kind}</span>
            </button>
          ))}
          {term && <button id={`header-search-option-${suggestions.length}`} role="option" aria-selected={active === suggestions.length}
            type="button" onMouseEnter={() => setActive(suggestions.length)} onClick={() => go(allHref)}
            className={`mt-1 flex w-full items-center justify-between rounded border-t border-adsk-lightgray px-3 py-3 text-left text-xs font-medium text-adsk-link hover:bg-adsk-offwhite ${active === suggestions.length ? "bg-adsk-offwhite" : ""}`}>
            <span>View all results</span><span>→</span>
          </button>}
        </div>
        <p className="border-t border-adsk-lightgray px-4 py-2 text-[10px] text-adsk-gray">
          {demoMode
            ? "All search results on this deployment are synthetic sample records."
            : "Projects come from the last sync; people and companies come from a user-uploaded ZIP whose source hub is unverified."}
          {term.length >= 2 && !loading && !error ? ` ${results.total.toLocaleString()} local matches.` : ""}
        </p>
      </dialog>
    </>
  );
}
