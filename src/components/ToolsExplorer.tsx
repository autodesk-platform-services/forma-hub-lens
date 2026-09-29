"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChartCard, formatValue } from "./charts";
import type { ChartResult, KpiResult } from "@/lib/dashboards/engine";

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
}: {
  tools: ToolCard[];
  datasetTables: number;
  datasetRows: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setOpenId(null);
    setDashboard(null);
    setError(null);
  }, []);

  const open = useCallback(async (tool: ToolCard) => {
    setOpenId(tool.id);
    setDashboard(null);
    setError(null);
    setLoading(true);
    dialogRef.current?.showModal();
    try {
      const res = await fetch(`/api/dashboards/${tool.id}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDashboard(body as Dashboard);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  // Native <dialog> gives Esc-to-dismiss; keep React state in step with it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpenId(null);
      setDashboard(null);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  const enabled = tools.filter((t) => t.enabled);
  const disabled = tools.filter((t) => !t.enabled);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-adsk-gray">
        <span>
          <strong className="font-legend text-adsk-black">{enabled.length}</strong> of {tools.length}{" "}
          tools enabled
        </span>
        <span>
          {datasetTables.toLocaleString()} tables · {datasetRows.toLocaleString()} rows loaded
        </span>
      </div>

      <ToolGrid tools={enabled} onOpen={open} />

      {disabled.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-legend text-sm text-adsk-black">
            Not enabled — missing source CSVs
          </h2>
          <ToolGrid tools={disabled} onOpen={open} />
        </>
      )}

      <dialog
        ref={dialogRef}
        className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/60"
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
      >
        <div className="flex h-[100dvh] w-full items-center justify-center p-3 sm:p-5">
          <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-adsk-offwhite shadow-2xl">
            <header className="surface-dark flex shrink-0 items-start justify-between gap-4 px-6 py-4">
              <div>
                <h2 className="title-on-dark font-legend text-xl">
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

            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
              {loading && <p className="text-xs text-adsk-gray">Computing dashboard…</p>}
              {error && (
                <p className="rounded border border-adsk-lightgray bg-adsk-white px-4 py-3 text-xs text-adsk-gray">
                  {error}
                </p>
              )}
              {dashboard && <DashboardBody dashboard={dashboard} />}
            </div>

            <footer className="flex shrink-0 items-center justify-between border-t border-adsk-lightgray bg-adsk-white px-6 py-2.5">
              <span className="text-[10px] text-adsk-gray">
                Autodesk Forma · Data Connector extract
              </span>
              <button
                type="button"
                onClick={close}
                className="font-legend text-[11px] text-adsk-link hover:underline"
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
}: {
  tools: ToolCard[];
  onOpen: (tool: ToolCard) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tools.map((tool) => (
        <li key={tool.id}>
          <button
            type="button"
            onClick={() => onOpen(tool)}
            className={`h-full w-full rounded border bg-adsk-white p-4 text-left transition ${
              tool.enabled
                ? "border-adsk-lightgray hover:border-adsk-yellow hover:shadow-sm"
                : "border-dashed border-adsk-lightgray opacity-70 hover:opacity-100"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
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
                <>{tool.rowCount.toLocaleString()} source rows</>
              ) : (
                <>needs {tool.missing.slice(0, 2).join(", ")}.csv</>
              )}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DashboardBody({ dashboard }: { dashboard: Dashboard }) {
  const available = dashboard.kpis.filter((k) => k.available);

  return (
    <div className="space-y-5">
      {!dashboard.enabled && (
        <p className="rounded border border-adsk-gold bg-adsk-gold/10 px-4 py-2.5 text-xs text-adsk-black">
          This tool&apos;s primary table ({dashboard.missing.join(", ")}.csv) is not in the uploaded
          extract, so panels below fall back to whatever related tables are present.
        </p>
      )}

      {available.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {dashboard.kpis.map((kpi, index) => (
            <div key={index} className="rounded border border-adsk-lightgray bg-adsk-white px-4 py-3">
              <div className="font-legend text-[10px] uppercase tracking-wide text-adsk-gray">
                {kpi.label}
              </div>
              <div className="tnum mt-1 font-legend text-2xl text-adsk-black">
                {kpi.available
                  ? typeof kpi.value === "number"
                    ? formatValue(kpi.value, kpi.format)
                    : formatDisplay(kpi.value, kpi.format)
                  : "—"}
              </div>
              {!kpi.available && <div className="mt-0.5 text-[10px] text-adsk-gray">{kpi.reason}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
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
