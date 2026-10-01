"use client";

import type { ChartResult } from "@/lib/dashboards/engine";

/**
 * Chart primitives in the Autodesk palette.
 *
 * Blue, teal and gold lead the categorical ramp. The latter two use darker
 * shades so every mark remains visible against the white/off-white cards.
 * Flame stays reserved for emphasis, and yellow is avoided on these surfaces.
 */
export const DATA_COLORS = [
  "#1D91D0", // accent3 Blue
  "#07816C", // accessible Teal
  "#AB6500", // accessible Orange Gold
  "#1278AF", // hlink Blue, darker step
  "#666666", // dk2 Gray
  "#5E6F69", // dark Gray Green
];

const GRID = "#D5D5CB";
const TEXT = "#666666";

export function formatValue(value: number, format?: string): string {
  if (!Number.isFinite(value)) return "—";
  if (format === "money") {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (format === "percent") {
    // The dashboard's completion_percentage source is already on a 0–100 scale.
    return `${value.toFixed(1)}%`;
  }
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(1);
}

function Unavailable({ reason }: { reason?: string }) {
  return (
    <div className="flex h-full min-h-28 items-center justify-center rounded border border-dashed border-adsk-lightgray px-4 text-center">
      <p className="text-xs text-adsk-gray">{reason ?? "No data"}</p>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** Horizontal bars — the right form when category labels are long text. */
function BarChart({ result }: { result: ChartResult }) {
  const points = result.points;
  if (!points.length) return <Unavailable reason="No values" />;
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <ul className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
      {points.map((point, index) => (
        <li key={point.key + index}>
          <div className="flex items-start justify-between gap-3 text-xs leading-snug">
            <span className="min-w-0 break-words text-adsk-black">
              {point.label}
            </span>
            <span className="tnum shrink-0 font-medium text-adsk-black">
              {formatValue(point.value, result.format)}
            </span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-sm bg-adsk-offwhite" aria-hidden="true">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.max((point.value / max) * 100, 1)}%`,
                background: DATA_COLORS[0],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns / line / area share one cartesian frame. */
function Cartesian({ result }: { result: ChartResult }) {
  const allPoints = result.points;
  const points = allPoints.slice(-60);
  if (points.length === 0) return <Unavailable reason="No dated rows" />;

  const max = Math.max(...points.map((p) => p.value), 1);
  const width = Math.max(760, points.length * 40 + 76);
  const height = 230;
  const padLeft = 64;
  const padBottom = 34;
  const padTop = 12;
  const plotW = width - padLeft - 8;
  const plotH = height - padBottom - padTop;
  const slot = plotW / points.length;
  const ticks = [0, max / 2, max];

  const xy = (index: number, value: number) => ({
    x: padLeft + index * slot + slot / 2,
    y: padTop + plotH - (value / max) * plotH,
  });

  const line = points.map((p, i) => {
    const { x, y } = xy(i, p.value);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const area =
    line +
    ` L${(padLeft + (points.length - 1) * slot + slot / 2).toFixed(1)},${padTop + plotH}` +
    ` L${(padLeft + slot / 2).toFixed(1)},${padTop + plotH} Z`;

  const labelEvery = Math.max(1, Math.ceil(52 / slot));

  return (
    <div>
      {allPoints.length > points.length && <p className="mb-2 text-xs text-adsk-gray">
        Plot shows the most recent {points.length} of {allPoints.length} periods. Open the data table below for every value.
      </p>}
      <div className="overflow-x-auto pb-1" role="region" aria-label={`${result.title} plot; scroll horizontally for more dates`} tabIndex={0}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-none" role="img" aria-label={`${result.title}, ${points.length} values`}>
      <title>{result.title}</title>
      {ticks.map((tick, i) => {
        const y = padTop + plotH - (tick / max) * plotH;
        return (
          <g key={i}>
            <line x1={padLeft} x2={width - 8} y1={y} y2={y} stroke={GRID} strokeWidth="1" />
            <text x={padLeft - 8} y={y + 4} textAnchor="end" fontSize="11" fill={TEXT}>
              {formatValue(tick, result.format)}
            </text>
          </g>
        );
      })}

      {result.kind === "area" && <path d={area} fill={DATA_COLORS[0]} fillOpacity="0.18" />}
      {(result.kind === "line" || result.kind === "area") && (
        <path d={line} fill="none" stroke={DATA_COLORS[0]} strokeWidth="2" />
      )}
      {result.kind !== "line" && result.kind !== "area" &&
        points.map((point, i) => {
          const barW = Math.max(Math.min(slot - 3, 34), 1);
          const h = (point.value / max) * plotH;
          return (
            <rect
              key={point.key + i}
              x={padLeft + i * slot + (slot - barW) / 2}
              y={padTop + plotH - h}
              width={barW}
              height={Math.max(h, point.value > 0 ? 1 : 0)}
              fill={DATA_COLORS[0]}
            >
              <title>{`${point.label}: ${formatValue(point.value, result.format)}`}</title>
            </rect>
          );
        })}

      {points.map((point, i) =>
        i % labelEvery === 0 ? (
          <text
            key={`l${point.key}${i}`}
            x={padLeft + i * slot + slot / 2}
            y={height - 7}
            textAnchor="middle"
            fontSize="11"
            fill={TEXT}
          >
            {truncate(point.label, 14)}
          </text>
        ) : null,
      )}
      </svg>
      </div>
      <details className="mt-2 text-xs text-adsk-gray">
        <summary className="cursor-pointer">View all {allPoints.length} labels and values</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded border border-adsk-lightgray">
          <table className="w-full text-left"><thead><tr><th className="p-2">Period</th><th className="p-2 text-right">Value</th></tr></thead>
            <tbody>{allPoints.map((point, index) => <tr key={`${point.key}-${index}`} className="border-t border-adsk-offwhite">
              <td className="break-words p-2 text-adsk-black">{point.label}</td><td className="tnum p-2 text-right text-adsk-black">{formatValue(point.value, result.format)}</td>
            </tr>)}</tbody></table>
        </div>
      </details>
    </div>
  );
}

function DonutChart({ result }: { result: ChartResult }) {
  const points = result.points;
  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return <Unavailable reason="No values" />;

  const radius = 62;
  const inner = 38;
  const cx = 78;
  const cy = 78;
  let angle = -Math.PI / 2;

  const arcs = points.map((point, index) => {
    const sweep = (point.value / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    const d =
      `M${p(radius, angle)} A${radius},${radius} 0 ${large} 1 ${p(radius, end)}` +
      ` L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, angle)} Z`;
    angle = end;
    return { d, point, fullCircle: point.value === total, color: DATA_COLORS[index % DATA_COLORS.length] };
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 156 156" className="h-36 w-36 shrink-0" role="img" aria-label={`${result.title}; total ${formatValue(total, result.format)}`}>
        <title>{result.title}</title>
        {arcs.map((arc, i) => arc.fullCircle ? (
          <circle key={i} cx={cx} cy={cy} r={(radius + inner) / 2} fill="none"
            stroke={arc.color} strokeWidth={radius - inner}>
            <title>{`${arc.point.label}: ${formatValue(arc.point.value, result.format)}`}</title>
          </circle>
        ) : (
          <path key={i} d={arc.d} fill={arc.color}>
            <title>{`${arc.point.label}: ${formatValue(arc.point.value, result.format)}`}</title>
          </path>
        ))}
        <text x="78" y="74" textAnchor="middle" fontSize="16" fontWeight="700" fill="#000">
          {formatValue(total, result.format)}
        </text>
        <text x="78" y="88" textAnchor="middle" fontSize="8" fill={TEXT}>
          shown
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2">
        {arcs.map((arc, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-snug">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: arc.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words text-adsk-black">{arc.point.label}</span>
            <span className="tnum shrink-0 text-right text-adsk-black">
              {formatValue(arc.point.value, result.format)}<span className="block text-adsk-gray">{Math.round((arc.point.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked share layout keeps category text at normal HTML size on every viewport. */
function Treemap({ result }: { result: ChartResult }) {
  const points = result.points;
  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return <Unavailable reason="No values" />;
  return (
    <div>
      <p className="mb-3 text-xs text-adsk-gray">Share of the categories shown</p>
      <ul className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
        {points.map((point, index) => <li key={`${point.key}-${index}`}>
          <div className="flex items-start justify-between gap-3 text-xs leading-snug">
            <span className="min-w-0 break-words text-adsk-black">{point.label}</span>
            <span className="tnum shrink-0 text-right font-medium text-adsk-black">{formatValue(point.value, result.format)}
              <span className="block font-normal text-adsk-gray">{Math.round(point.value / total * 100)}%</span>
            </span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-sm bg-adsk-offwhite" aria-hidden="true">
            <div className="h-full rounded-sm bg-[#1278AF]" style={{ width: `${Math.max(1, point.value / total * 100)}%` }} />
          </div>
        </li>)}
      </ul>
    </div>
  );
}

function StackedBars({ result }: { result: ChartResult }) {
  const byCategory = new Map<string, Map<string, number>>();
  for (const point of result.points) {
    const key = point.label;
    const inner = byCategory.get(key) ?? new Map<string, number>();
    inner.set(point.series ?? "—", (inner.get(point.series ?? "—") ?? 0) + point.value);
    byCategory.set(key, inner);
  }
  const rows = [...byCategory.entries()]
    .map(([label, inner]) => ({
      label,
      total: [...inner.values()].reduce((a, b) => a + b, 0),
      parts: [...inner.entries()],
    }))
    .sort((a, b) => b.total - a.total);
  if (!rows.length) return <Unavailable reason="No values" />;

  const max = Math.max(...rows.map((r) => r.total), 1);
  const seriesKeys = result.seriesKeys.length
    ? result.seriesKeys
    : [...new Set(result.points.map((point) => point.series ?? "—"))];

  return (
    <div className="space-y-3">
      <ul className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-start justify-between gap-3 text-xs leading-snug">
              <span className="min-w-0 break-words text-adsk-black">{row.label}</span>
              <span className="tnum shrink-0 font-medium text-adsk-black">{formatValue(row.total, result.format)}</span>
            </div>
            <div className="mt-1 flex h-2.5 overflow-hidden rounded-sm bg-adsk-offwhite" aria-hidden="true">
              {row.parts.map(([series, value]) => (
                <div
                  key={series}
                  style={{
                    width: `${(value / max) * 100}%`,
                    background:
                      DATA_COLORS[Math.max(0, seriesKeys.indexOf(series)) % DATA_COLORS.length],
                  }}
                />
              ))}
            </div>
            {row.parts.length > 1 && <details className="mt-1 text-xs text-adsk-gray">
              <summary className="cursor-pointer">View {row.parts.length} series values</summary>
              <ul className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {row.parts.map(([series, value]) => <li key={series} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words text-adsk-black">{series}</span>
                  <span className="tnum shrink-0 text-adsk-black">{formatValue(value, result.format)}</span>
                </li>)}
              </ul>
            </details>}
          </li>
        ))}
      </ul>
      {seriesKeys.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {seriesKeys.map((series, index) => (
            <li key={series} className="flex items-center gap-1.5 text-xs text-adsk-gray">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: DATA_COLORS[index % DATA_COLORS.length] }}
                aria-hidden="true"
              />
              {series}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DataTable({ result }: { result: ChartResult }) {
  if (!result.rows?.length) return <Unavailable reason="No rows" />;
  return (
    <div className="max-h-[32rem] overflow-auto">
      <table className="w-full min-w-[32rem] text-left text-xs">
        <thead className="sticky top-0 bg-adsk-white">
          <tr className="border-b border-adsk-lightgray">
            {result.columns?.map((col) => (
              <th key={col.key} scope="col" className="px-2 py-2 font-legend text-xs text-adsk-gray">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {result.rows.map((row, index) => (
            <tr key={index} className="border-b border-adsk-offwhite">
              {result.columns?.map((col) => (
                <td key={col.key} className="max-w-64 break-words px-2 py-2 align-top">
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScatterChart({ result }: { result: ChartResult }) {
  const points = result.points;
  if (!points.length) return <Unavailable reason="No values" />;
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <div>
      <div className="mb-2 flex justify-between text-xs text-adsk-gray"><span>0</span><span>{formatValue(max, result.format)}</span></div>
      <ul className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
        {points.map((point, index) => <li key={`${point.key}-${index}`}>
          <div className="flex items-start justify-between gap-3 text-xs leading-snug">
            <span className="min-w-0 break-words text-adsk-black">{point.label}</span>
            <span className="tnum shrink-0 font-medium text-adsk-black">{formatValue(point.value, result.format)}</span>
          </div>
          <div className="relative mt-2 h-3 border-b border-adsk-lightgray" aria-hidden="true">
            <span className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[#1278AF]"
              style={{ left: `${Math.max(1, Math.min(99, point.value / max * 100))}%` }} />
          </div>
        </li>)}
      </ul>
    </div>
  );
}

export function ChartCard({ result }: { result: ChartResult }) {
  const datedColumn = result.kind === "column" && result.points.length > 0 &&
    result.points.every((point) => /^\d{4}-\d{2}(?:-\d{2})?$/.test(point.key));
  const wide =
    result.kind === "line" ||
    result.kind === "area" ||
    datedColumn ||
    result.kind === "table";

  return (
    <section
      className={`min-w-0 rounded border border-adsk-lightgray bg-adsk-white p-4 ${wide ? "xl:col-span-2" : ""}`}
    >
      <h3 className="mb-3 font-legend text-sm text-adsk-black">{result.title}</h3>
      {!result.available ? (
        <Unavailable reason={result.reason} />
      ) : result.kind === "table" ? (
        <DataTable result={result} />
      ) : result.points.length === 0 ? (
        <Unavailable reason="No rows matched" />
      ) : result.kind === "donut" ? (
        <DonutChart result={result} />
      ) : result.kind === "treemap" ? (
        <Treemap result={result} />
      ) : result.kind === "bar" ? (
        <BarChart result={result} />
      ) : result.kind === "stackedBar" ? (
        <StackedBars result={result} />
      ) : result.kind === "scatter" ? (
        <ScatterChart result={result} />
      ) : result.kind === "column" && !datedColumn ? (
        <BarChart result={result} />
      ) : (
        <Cartesian result={result} />
      )}
    </section>
  );
}
