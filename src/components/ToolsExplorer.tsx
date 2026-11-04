"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChartCard, formatValue } from "./charts";
import type { ChartResult, KpiResult } from "@/lib/dashboards/engine";
import { readToolFavorites } from "@/lib/toolFavorites";

export type ToolCard = {
  id: string;
  name: string;
  blurb: string;
  template: string;
  enabled: boolean;
  missing: string[];
  rowCount: number;
};

type Dashboard = {
  id: string;
  name: string;
  blurb: string;
  template: string;
  enabled: boolean;
  missing: string[];
  kpis: KpiResult[];
  charts: ChartResult[];
};

export function ToolsExplorer({
  tools,
  datasetTables,
  datasetRows,
  favoritesKey,
  demoMode = false,
}: {
  tools: ToolCard[];
  datasetTables: number;
  datasetRows: number;
  favoritesKey: string | null;
  demoMode?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeOpenId = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const [favorites, setFavorites] = useState<string[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const requestedOpenId = useSearchParams().get("open");

  const replaceOpenParam = useCallback((id: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("open", id);
    else params.delete("open");
    const query = params.toString();
    const href = `${pathname}${query ? `?${query}` : ""}`;
    if (href !== `${window.location.pathname}${window.location.search}`) {
      router.replace(href, { scroll: false });
    }
  }, [pathname, router]);

  const close = useCallback(() => {
    activeOpenId.current = null;
    requestSequence.current += 1;
    if (dialogRef.current?.open) dialogRef.current.close();
    setOpenId(null);
    setDashboard(null);
    setLoading(false);
    setError(null);
    replaceOpenParam(null);
  }, [replaceOpenParam]);

  const open = useCallback(async (tool: ToolCard) => {
    if (activeOpenId.current === tool.id && dialogRef.current?.open) return;
    activeOpenId.current = tool.id;
    const requestId = ++requestSequence.current;
    setOpenId(tool.id);
    setDashboard(null);
    setError(null);
    setLoading(true);
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    try {
      const res = await fetch(`/api/dashboards/${tool.id}`, { cache: "no-store" });
      const body = await res.json();
      if (requestId !== requestSequence.current) return;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDashboard(body as Dashboard);
    } catch (cause) {
      if (requestId === requestSequence.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  const openFromCard = useCallback((tool: ToolCard) => {
    void open(tool);
    replaceOpenParam(tool.id);
  }, [open, replaceOpenParam]);

  useEffect(() => {
    setFavorites(readToolFavorites(favoritesKey, new Set(tools.map((tool) => tool.id))));
  }, [favoritesKey, tools]);

  useEffect(() => {
    const tool = tools.find((candidate) => candidate.id === requestedOpenId);
    if (tool) void open(tool);
    else if (activeOpenId.current !== null) close();
  }, [close, open, requestedOpenId, tools]);

  const toggleFavorite = (id: string) => {
    if (!favoritesKey) return;
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    setFavorites(next);
    try { window.localStorage.setItem(favoritesKey, JSON.stringify(next)); } catch { /* Browser storage unavailable. */ }
  };

  // Native <dialog> gives Esc-to-dismiss; keep React state in step with it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      if (activeOpenId.current !== null) close();
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [close]);

  const enabled = tools.filter((t) => t.enabled);
  const favoriteTools = favorites.flatMap((id) => {
    const tool = tools.find((candidate) => candidate.id === id);
    return tool ? [tool] : [];
  });
  const assigned = new Set(TOOL_CATEGORIES.flatMap((category) => category.ids));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-adsk-gray">
        <span>
          <strong className="font-legend text-adsk-black">{enabled.length}</strong> of {tools.length}{" "}
          tools enabled
        </span>
        <span>
          {datasetTables.toLocaleString()} {demoMode ? "sample" : "loaded"} tables · {datasetRows.toLocaleString()} {demoMode ? "sample rows" : "rows loaded"}
        </span>
      </div>

      {favoriteTools.length > 0 && <section className="mb-7">
        <h2 className="mb-3 font-legend text-sm text-adsk-black">★ My tools</h2>
        <ToolGrid tools={favoriteTools} onOpen={openFromCard} favorites={favorites} onToggleFavorite={toggleFavorite} canFavorite={Boolean(favoritesKey)} demoMode={demoMode} />
      </section>}
      {TOOL_CATEGORIES.map((category) => {
        const group = category.ids.flatMap((id) => {
          const tool = tools.find((candidate) => candidate.id === id);
          return tool ? [tool] : [];
        });
        return group.length ? <section key={category.name} className="mb-7">
          <h2 className="mb-3 font-legend text-sm text-adsk-black">{category.name}</h2>
          <ToolGrid tools={group} onOpen={openFromCard} favorites={favorites} onToggleFavorite={toggleFavorite} canFavorite={Boolean(favoritesKey)} demoMode={demoMode} />
        </section> : null;
      })}
      {tools.some((tool) => !assigned.has(tool.id)) && <section className="mb-7">
        <h2 className="mb-3 font-legend text-sm text-adsk-black">Other tools</h2>
          <ToolGrid tools={tools.filter((tool) => !assigned.has(tool.id))} onOpen={openFromCard} favorites={favorites}
          onToggleFavorite={toggleFavorite} canFavorite={Boolean(favoritesKey)} demoMode={demoMode} />
      </section>}

      <dialog
        ref={dialogRef}
        aria-labelledby="tool-dashboard-title"
        className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/60"
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
      >
        <div className="flex h-[100dvh] w-full items-center justify-center p-2 sm:p-4">
          <div className="flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-lg bg-adsk-offwhite shadow-2xl">
            <header className="surface-dark flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-6">
              <div>
                <h2 id="tool-dashboard-title" className="title-on-dark font-legend text-xl">
                  {dashboard?.name ?? tools.find((t) => t.id === openId)?.name ?? "Loading"}
                </h2>
                <p className="mt-1 text-xs text-adsk-lightgray">
                  {dashboard?.blurb ?? ""}
                  {dashboard?.template && (
                    <span className="ml-2 opacity-70">· {dashboard.template}</span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                autoFocus
                className="shrink-0 rounded border border-adsk-gray px-3 py-1.5 font-legend text-xs text-adsk-white hover:border-adsk-white focus:outline-2 focus:outline-offset-2 focus:outline-adsk-yellow"
              >
                Close ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6">
              {loading && <p className="text-xs text-adsk-gray">Computing dashboard…</p>}
              {error && (
                <p className="rounded border border-adsk-lightgray bg-adsk-white px-4 py-3 text-xs text-adsk-gray">
                  {error}
                </p>
              )}
              {dashboard && <DashboardBody dashboard={dashboard} demoMode={demoMode} />}
            </div>

            <footer className="flex shrink-0 items-center justify-between border-t border-adsk-lightgray bg-adsk-white px-4 py-2.5 sm:px-6">
              <span className="text-xs text-adsk-gray">
                {demoMode ? "Synthetic demo hub · sample dashboard" : "Autodesk Forma · Data Connector extract"}
              </span>
              <button
                type="button"
                onClick={close}
                className="font-legend text-xs text-adsk-link hover:underline"
              >
                ← Back to tools
              </button>
            </footer>
          </div>
        </div>
      </dialog>
    </>
  );
}

function ToolGrid({
  tools,
  onOpen,
  favorites,
  onToggleFavorite,
  canFavorite,
  demoMode,
}: {
  tools: ToolCard[];
  onOpen: (tool: ToolCard) => void;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  canFavorite: boolean;
  demoMode: boolean;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tools.map((tool) => (
        <li key={tool.id} className="relative">
          <button
            type="button"
            onClick={() => onOpen(tool)}
            className={`h-full w-full rounded border bg-adsk-white p-4 text-left transition ${
              tool.enabled
                ? "border-adsk-lightgray hover:border-adsk-yellow hover:shadow-sm"
                : "border-dashed border-adsk-lightgray opacity-70 hover:opacity-100"
            }`}
          >
            <div className="flex items-start justify-between gap-8">
              <h3 className="font-legend text-[13px] leading-snug text-adsk-black">{tool.name}</h3>
              <span
                className="mt-0.5 h-2 w-2 shrink-0 rounded-full border border-adsk-lightgray"
                style={{ background: tool.enabled ? "#FFFE00" : "#D5D5CB" }}
                aria-hidden
              />
            </div>
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-adsk-gray">
              {tool.blurb}
            </p>
            <p className="mt-2 text-[10px] text-adsk-gray">
              {tool.enabled ? (
                <>{tool.rowCount.toLocaleString()} {demoMode ? "sample rows" : "source rows"}</>
              ) : (
                <>{demoMode ? "sample table missing: " : "needs "}{tool.missing.slice(0, 2).join(", ")}{demoMode ? "" : ".csv"}</>
              )}
            </p>
          </button>
          {canFavorite && <button type="button" onClick={() => onToggleFavorite(tool.id)}
            aria-label={`${favorites.includes(tool.id) ? "Remove" : "Add"} ${tool.name} ${favorites.includes(tool.id) ? "from" : "to"} favorite tools`}
            aria-pressed={favorites.includes(tool.id)}
            className="absolute right-3 top-3 rounded px-1 text-lg leading-none text-adsk-black hover:bg-adsk-offwhite focus:outline-2 focus:outline-adsk-yellow">
            {favorites.includes(tool.id) ? "★" : "☆"}
          </button>}
        </li>
      ))}
    </ul>
  );
}

const TOOL_CATEGORIES: Array<{ name: string; ids: string[] }> = [
  { name: "Project management", ids: ["issues", "rfis", "submittals", "meetings", "reviews"] },
  { name: "Field", ids: ["forms", "photos", "assets", "quality-field", "iq"] },
  { name: "Design & coordination", ids: ["quality-ddr", "quality-mc", "quality-mc-clash"] },
  { name: "Commercial", ids: ["cost", "cost-kpis", "takeoff", "estimate"] },
  { name: "Planning", ids: ["schedule", "schedule-kpi"] },
  { name: "Administration", ids: ["activities", "administration"] },
];

function DashboardBody({ dashboard, demoMode }: { dashboard: Dashboard; demoMode: boolean }) {
  const available = dashboard.kpis.filter((k) => k.available);

  return (
    <div className="space-y-5">
      {!dashboard.enabled && (
        <p className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-2.5 text-xs text-adsk-black">
          This tool&apos;s primary table ({dashboard.missing.join(", ")}.csv) is not in the {demoMode ? "sample data set" : "uploaded extract"},
          so panels below fall back to whatever related tables are present.
        </p>
      )}

      {available.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {dashboard.kpis.map((kpi, index) => (
            <div key={index} className="rounded border border-adsk-lightgray bg-adsk-white px-4 py-3">
              <div className="font-legend text-xs uppercase tracking-wide text-adsk-gray">
                {kpi.label}
              </div>
              <div className="tnum mt-1 font-legend text-2xl text-adsk-black">
                {kpi.available
                  ? typeof kpi.value === "number"
                    ? formatValue(kpi.value, kpi.format)
                    : formatDisplay(kpi.value, kpi.format)
                  : "—"}
              </div>
              {!kpi.available && <div className="mt-0.5 text-xs text-adsk-gray">{kpi.reason}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        {dashboard.charts.map((chart, index) => (
          <ChartCard key={index} result={chart} />
        ))}
      </div>
    </div>
  );
}

function formatDisplay(value: string | null, format?: string): string {
  if (value === null) return "—";
  if (format === "date") return String(value).slice(0, 10);
  return String(value);
}

export function DatasetUpload({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage({ ok: false, text: "Choose a .zip first." });
      return;
    }
    setBusy(true);
    setMessage({ ok: true, text: `Uploading and parsing ${file.name}…` });

    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/dataset/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMessage({
        ok: !json.truncatedTables?.length,
        text: `Loaded ${json.tables.length} tables (${json.totalRows.toLocaleString()} rows)${
          json.skipped?.length ? `, skipped ${json.skipped.length} entries` : ""
        }.${json.truncatedTables?.length
          ? ` Warning: ${json.truncatedTables.join(", ")} exceeded 400,000 rows and were truncated.`
          : ""}`,
      });
      router.refresh();
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="max-w-xs text-xs text-adsk-gray file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-adsk-black file:px-3 file:py-1.5 file:font-legend file:text-xs file:text-adsk-white hover:file:bg-adsk-gray"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Loading…" : hasData ? "Replace dataset" : "Upload extract"}
      </button>
      {message && (
        <p className={`text-xs ${message.ok ? "text-adsk-black" : "text-adsk-linkvisited"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
