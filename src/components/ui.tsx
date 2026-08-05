import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-adsk-lightgray bg-adsk-white ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-adsk-lightgray px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-adsk-black">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-adsk-gray">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-adsk-black"
      : tone === "warn"
        ? "text-adsk-black"
        : tone === "bad"
          ? "text-adsk-linkvisited"
          : "text-adsk-black";
  return (
    <div className="rounded-lg border border-adsk-lightgray bg-adsk-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-adsk-gray">{label}</div>
      <div className={`tnum mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-adsk-gray">{hint}</div>}
    </div>
  );
}

export function Pill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "good" | "warn" | "bad" | "accent";
}) {
  const tones: Record<string, string> = {
    default: "border-adsk-lightgray bg-adsk-lightgray text-adsk-black",
    good: "border-adsk-lightgray bg-adsk-teal/15 text-adsk-black",
    warn: "border-adsk-gold bg-adsk-gold/10 text-adsk-black",
    bad: "border-adsk-linkvisited bg-adsk-linkvisited/10 text-adsk-linkvisited",
    accent: "border-adsk-gold bg-adsk-gold/10 text-adsk-link",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-adsk-lightgray px-6 py-10 text-center">
      <p className="text-sm font-medium text-adsk-black">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-prose text-xs text-adsk-gray">{children}</div>}
    </div>
  );
}

/** Horizontal bar list — one categorical dimension, sorted by magnitude. */
export function BarList({
  items,
  emptyLabel = "No data",
}: {
  items: Array<{ key: string; label: string; count: number }>;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-adsk-gray">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.key} className="group">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-adsk-black" title={item.label}>
              {item.label}
            </span>
            <span className="tnum shrink-0 text-adsk-gray">{item.count.toLocaleString()}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-adsk-lightgray">
            <div
              className="h-full rounded-full bg-adsk-blue"
              style={{ width: `${Math.max((item.count / max) * 100, 1.5)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Daily volume column chart, drawn as inline SVG (no chart dependency). */
export function DailyChart({
  data,
  height = 140,
}: {
  data: Array<{ day: string; count: number }>;
  height?: number;
}) {
  if (data.length === 0) {
    return <p className="text-xs text-adsk-gray">No dated events in range.</p>;
  }

  const max = Math.max(...data.map((point) => point.count), 1);
  const width = 720;
  const padLeft = 36;
  const padBottom = 18;
  const padTop = 6;
  const plotWidth = width - padLeft;
  const plotHeight = height - padBottom - padTop;
  const slot = plotWidth / data.length;
  const barWidth = Math.max(Math.min(slot - 2, 26), 1);

  const ticks = [0, Math.round(max / 2), max].filter(
    (tick, index, all) => all.indexOf(tick) === index,
  );

  const labelEvery = Math.ceil(data.length / 8);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Activity events per day"
    >
      {ticks.map((tick) => {
        const y = padTop + plotHeight - (tick / max) * plotHeight;
        return (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={width}
              y1={y}
              y2={y}
              stroke="var(--color-adsk-lightgray)"
              strokeWidth="1"
            />
            <text
              x={padLeft - 6}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--color-adsk-gray)"
            >
              {tick.toLocaleString()}
            </text>
          </g>
        );
      })}

      {data.map((point, index) => {
        const barHeight = (point.count / max) * plotHeight;
        const x = padLeft + index * slot + (slot - barWidth) / 2;
        return (
          <rect
            key={point.day}
            x={x}
            y={padTop + plotHeight - barHeight}
            width={barWidth}
            height={Math.max(barHeight, point.count > 0 ? 1 : 0)}
            fill="var(--color-adsk-blue)"
            rx="1"
          >
            <title>{`${point.day}: ${point.count.toLocaleString()} events`}</title>
          </rect>
        );
      })}

      {data.map((point, index) =>
        index % labelEvery === 0 ? (
          <text
            key={`label-${point.day}`}
            x={padLeft + index * slot + slot / 2}
            y={height - 5}
            textAnchor="middle"
            fontSize="9"
            fill="var(--color-adsk-gray)"
          >
            {point.day.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toISOString().slice(0, 10);
}

export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "never";
  const delta = Date.now() - ms;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
