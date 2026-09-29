"use client";

import type { ChartResult } from "@/lib/dashboards/engine";

/**
 * Chart primitives in the Autodesk palette.
 *
 * Blue (accent3) and Teal (accent4) are the data/tech colours and lead the
 * categorical ramp; Gold (accent1) follows. Flame (accent2) is reserved for
 * emphasis so it keeps its weight as the brand accent, and Yellow is never used
 * on these light surfaces where it has no contrast.
 */
export const DATA_COLORS = [
  "#1D91D0", // accent3 Blue
  "#2AD0A9", // accent4 Teal
  "#F09D4F", // accent1 Orange Gold
  "#1278AF", // hlink Blue, darker step
  "#666666", // dk2 Gray
  "#D5D5CB", // accent6 Light Gray
];

const GRID = "#D5D5CB";
const TEXT = "#666666";

/** Readable text colour for a fill, by relative luminance rather than position. */
function textOn(background: string): string {
  const hex = background.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.45 ? "#000000" : "#FFFFFF";
}

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
    return `${value <= 1 && value > 0 ? (value * 100).toFixed(1) : value.toFixed(1)}%`;
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
  const points = result.points.slice(0, 14);
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <ul className="space-y-2">
      {points.map((point, index) => (
        <li key={point.key + index}>
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="truncate text-adsk-black" title={point.label}>
              {truncate(point.label, 46)}
            </span>
            <span className="tnum shrink-0 text-adsk-gray">
              {formatValue(point.value, result.format)}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-sm bg-adsk-offwhite">
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
  const points = result.points.slice(0, 60);
  if (points.length === 0) return <Unavailable reason="No dated rows" />;

  const max = Math.max(...points.map((p) => p.value), 1);
  const width = 760;
  const height = 200;
  const padLeft = 46;
  const padBottom = 24;
  const padTop = 8;
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

  const labelEvery = Math.ceil(points.length / 10);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={result.title}>
      {ticks.map((tick, i) => {
        const y = padTop + plotH - (tick / max) * plotH;
        return (
          <g key={i}>
            <line x1={padLeft} x2={width - 8} y1={y} y2={y} stroke={GRID} strokeWidth="1" />
            <text x={padLeft - 6} y={y + 3} textAnchor="end" fontSize="9" fill={TEXT}>
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
            fontSize="9"
            fill={TEXT}
          >
            {truncate(point.label, 10)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function DonutChart({ result }: { result: ChartResult }) {
  const points = result.points.slice(0, 8);
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
    return { d, point, color: DATA_COLORS[index % DATA_COLORS.length] };
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 156 156" className="h-36 w-36 shrink-0" role="img" aria-label={result.title}>
        {arcs.map((arc, i) => (
          <path key={i} d={arc.d} fill={arc.color}>
            <title>{`${arc.point.label}: ${formatValue(arc.point.value, result.format)}`}</title>
          </path>
        ))}
        <text x="78" y="74" textAnchor="middle" fontSize="16" fontWeight="700" fill="#000">
          {formatValue(total, result.format)}
        </text>
        <text x="78" y="88" textAnchor="middle" fontSize="8" fill={TEXT}>
          total
        </text>
      </svg>
      <ul className="min-w-40 flex-1 space-y-1">
        {arcs.map((arc, i) => (
          <li key={i} className="flex items-center gap-2 text-[11px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: arc.color }} />
            <span className="flex-1 truncate text-adsk-black" title={arc.point.label}>
              {truncate(arc.point.label, 26)}
            </span>
            <span className="tnum text-adsk-gray">
              {Math.round((arc.point.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Squarified-ish treemap: good enough for a rank-and-share read. */
function Treemap({ result }: { result: ChartResult }) {
  const points = result.points.slice(0, 12);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return <Unavailable reason="No values" />;

  const width = 100;
  const height = 100;
  const rects: Array<{ x: number; y: number; w: number; h: number; point: (typeof points)[0] }> = [];
  let x = 0;
  let y = 0;
  let remainingW = width;
  let remainingH = height;
  let remaining = total;
  let horizontal = true;

  points.forEach((point, index) => {
    const share = point.value / remaining;
    if (index === points.length - 1) {
      rects.push({ x, y, w: remainingW, h: remainingH, point });
      return;
    }
    if (horizontal) {
      const w = remainingW * share;
      rects.push({ x, y, w, h: remainingH, point });
      x += w;
      remainingW -= w;
    } else {
      const h = remainingH * share;
      rects.push({ x, y, w: remainingW, h, point });
      y += h;
      remainingH -= h;
    }
    remaining -= point.value;
    horizontal = !horizontal;
  });

  return (
    <svg viewBox="0 0 100 100" className="h-52 w-full" preserveAspectRatio="none" role="img" aria-label={result.title}>
      {rects.map((rect, index) => (
        <g key={index}>
          <rect
            x={rect.x}
            y={rect.y}
            width={Math.max(rect.w, 0)}
            height={Math.max(rect.h, 0)}
            fill={DATA_COLORS[index % DATA_COLORS.length]}
            stroke="#FFFFFF"
            strokeWidth="0.5"
          >
            <title>{`${rect.point.label}: ${formatValue(rect.point.value, result.format)}`}</title>
          </rect>
          {rect.w > 16 && rect.h > 9 && (
            <text
              x={rect.x + 1.6}
              y={rect.y + 5}
              fontSize="3.1"
              fill={textOn(DATA_COLORS[index % DATA_COLORS.length])}
              style={{ fontWeight: 600 }}
            >
              {truncate(rect.point.label, Math.floor(rect.w / 1.7))}
            </text>
          )}
        </g>
      ))}
    </svg>
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
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  const max = Math.max(...rows.map((r) => r.total), 1);
  const seriesKeys = result.seriesKeys.length ? result.seriesKeys : ["—"];

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="truncate text-adsk-black" title={row.label}>
                {truncate(row.label, 44)}
              </span>
              <span className="tnum text-adsk-gray">{formatValue(row.total, result.format)}</span>
            </div>
            <div className="mt-1 flex h-2 overflow-hidden rounded-sm bg-adsk-offwhite">
              {row.parts.map(([series, value]) => (
                <div
                  key={series}
                  title={`${series}: ${formatValue(value, result.format)}`}
                  style={{
                    width: `${(value / max) * 100}%`,
                    background:
                      DATA_COLORS[Math.max(0, seriesKeys.indexOf(series)) % DATA_COLORS.length],
                  }}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {result.seriesKeys.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {seriesKeys.slice(0, 8).map((series, index) => (
            <li key={series} className="flex items-center gap-1.5 text-[10px] text-adsk-gray">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: DATA_COLORS[index % DATA_COLORS.length] }}
              />
              {truncate(series, 22)}
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
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-adsk-white">
          <tr className="border-b border-adsk-lightgray">
            {result.columns?.map((col) => (
              <th key={col.key} className="py-1.5 pr-3 font-legend text-[10px] uppercase tracking-wide text-adsk-gray">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {result.rows.map((row, index) => (
            <tr key={index} className="border-b border-adsk-offwhite">
              {result.columns?.map((col) => (
                <td key={col.key} className="max-w-56 truncate py-1.5 pr-3" title={row[col.key]}>
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
  const points = result.points.slice(0, 40);
  if (!points.length) return <Unavailable reason="No values" />;
  const max = Math.max(...points.map((p) => p.value), 1);
  const width = 760;
  const height = 200;
  const pad = 46;
  const plotW = width - pad - 12;
  const plotH = height - 34;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={result.title}>
      <line x1={pad} x2={width - 12} y1={plotH + 8} y2={plotH + 8} stroke={GRID} />
      {points.map((point, index) => {
        const x = pad + (index / Math.max(points.length - 1, 1)) * plotW;
        const y = 8 + plotH - (point.value / max) * plotH;
        return (
          <circle key={point.key + index} cx={x} cy={y} r="5" fill={DATA_COLORS[0]} fillOpacity="0.75">
            <title>{`${point.label}: ${formatValue(point.value, result.format)}`}</title>
          </circle>
        );
      })}
      <text x={pad - 6} y="14" textAnchor="end" fontSize="9" fill={TEXT}>
        {formatValue(max, result.format)}
      </text>
    </svg>
  );
}

export function ChartCard({ result }: { result: ChartResult }) {
  const wide =
    result.kind === "line" ||
    result.kind === "area" ||
    result.kind === "column" ||
    result.kind === "scatter" ||
    result.kind === "table";

  return (
    <section
      className={`rounded border border-adsk-lightgray bg-adsk-white p-4 ${wide ? "lg:col-span-2" : ""}`}
    >
      <h3 className="mb-3 font-legend text-[13px] text-adsk-black">{result.title}</h3>
      {!result.available ? (
        <Unavailable reason={result.reason} />
      ) : result.kind === "table" ? (
        <DataTable result={result} />
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
      ) : result.points.length === 0 ? (
        <Unavailable reason="No rows matched" />
      ) : (
        <Cartesian result={result} />
      )}
    </section>
  );
}
