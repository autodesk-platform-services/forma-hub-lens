import "server-only";

import { getDb } from "../db";
import { getTable, resolveColumn, type DatasetTable } from "../dataset";
import type { Chart, Kpi, ToolSpec, Where } from "./specs";

/**
 * Evaluates dashboard specs against the uploaded Data Connector extract.
 *
 * Everything that reaches SQL is resolved through the dataset registry first —
 * a spec names a logical table/column, the registry hands back the stored SQL
 * identifier, and anything that doesn't resolve makes the visual report itself
 * as unavailable rather than producing a query.
 */

/** Foreign keys used to join a fact table to a dimension table. */
const JOINS: Array<{ dim: string; factColumns: string[]; dimColumn: string }> = [
  { dim: "admin_projects", factColumns: ["bim360_project_id", "project_id"], dimColumn: "id" },
  {
    dim: "admin_companies",
    // admin_users names its company link `default_company_id`; photos uses a
    // display-cased column. Order matters: first match on the fact table wins.
    factColumns: ["company_id", "default_company_id", "Creator Company ID"],
    dimColumn: "id",
  },
  { dim: "admin_users", factColumns: ["created_by", "updated_by", "creator_id", "user_id"], dimColumn: "autodesk_id" },
  { dim: "issues_root_causes", factColumns: ["root_cause_id"], dimColumn: "root_cause_id" },
  { dim: "issues_issue_types", factColumns: ["type_id"], dimColumn: "issue_type_id" },
  { dim: "takeoff_packages", factColumns: ["package_id"], dimColumn: "id" },
  { dim: "forms_form_templates", factColumns: ["template_id"], dimColumn: "id" },
  { dim: "assets_categories", factColumns: ["category_id"], dimColumn: "id" },
];

function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Resolves a fact-table column; undefined if the table or column is absent. */
function factColumn(table: DatasetTable, column: string): string | undefined {
  const sql = resolveColumn(table, column);
  return sql ? `f.${q(sql)}` : undefined;
}

type JoinPlan = { clause: string; expr: string } | null;

function planJoin(fact: DatasetTable, dimName: string, dimColumn: string, alias = "d"): JoinPlan {
  const dim = getTable(dimName);
  if (!dim) return null;
  const dimCol = resolveColumn(dim, dimColumn);
  if (!dimCol) return null;

  const rule = JOINS.find((j) => j.dim === dimName);
  if (!rule) return null;
  const keyOn = resolveColumn(dim, rule.dimColumn);
  if (!keyOn) return null;

  for (const candidate of rule.factColumns) {
    const factKey = resolveColumn(fact, candidate);
    if (factKey) {
      return {
        clause: `LEFT JOIN ${q(dim.sqlName)} AS ${alias} ON ${alias}.${q(keyOn)} = f.${q(factKey)}`,
        expr: `${alias}.${q(dimCol)}`,
      };
    }
  }
  return null;
}

function whereSql(
  fact: DatasetTable,
  conditions: Where[] | undefined,
): { sql: string; params: string[] } | null {
  if (!conditions?.length) return { sql: "", params: [] };
  const parts: string[] = [];
  const params: string[] = [];

  for (const cond of conditions) {
    const col = factColumn(fact, cond.column);
    // A filter that can't be resolved would silently widen the result, so bail.
    if (!col) return null;
    if (cond.equals !== undefined) {
      parts.push(`${col} = ? COLLATE NOCASE`);
      params.push(cond.equals);
    } else if (cond.notEquals !== undefined) {
      parts.push(`(${col} IS NULL OR ${col} <> ? COLLATE NOCASE)`);
      params.push(cond.notEquals);
    } else if (cond.in) {
      parts.push(`${col} COLLATE NOCASE IN (${cond.in.map(() => "?").join(",")})`);
      params.push(...cond.in);
    } else if (cond.notNull) {
      parts.push(`(${col} IS NOT NULL AND ${col} <> '')`);
    } else if (cond.isNull) {
      parts.push(`(${col} IS NULL OR ${col} = '')`);
    } else if (cond.beforeToday) {
      parts.push(`date(${col}) < date('now')`);
    }
  }
  return { sql: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", params };
}

function aggSql(expr: string | undefined, agg: string): string | null {
  if (!expr && !["count", "distinct"].includes(agg)) return null;
  switch (agg) {
    case "count":
      return expr ? `COUNT(${expr})` : "COUNT(*)";
    case "distinct":
      return expr ? `COUNT(DISTINCT ${expr})` : "COUNT(*)";
    case "sum":
      return `SUM(CAST(${expr} AS REAL))`;
    case "avg":
      return `AVG(CAST(${expr} AS REAL))`;
    case "min":
      return `MIN(${expr})`;
    case "max":
      return `MAX(${expr})`;
    default:
      return "COUNT(*)";
  }
}

export type KpiResult = {
  label: string;
  value: number | string | null;
  format: Kpi["format"];
  available: boolean;
  reason?: string;
};

export function runKpi(kpi: Kpi): KpiResult {
  const base: KpiResult = { label: kpi.label, value: null, format: kpi.format, available: false };
  const table = getTable(kpi.table);
  if (!table) return { ...base, reason: `${kpi.table}.csv not in dataset` };

  let expr: string | undefined;
  if (kpi.column) {
    expr = factColumn(table, kpi.column);
    if (!expr) return { ...base, reason: `column "${kpi.column}" missing` };
  }

  const where = whereSql(table, kpi.where);
  if (!where) return { ...base, reason: "filter column missing" };

  const aggregate = aggSql(expr, kpi.agg);
  if (!aggregate) return { ...base, reason: `${kpi.agg} requires a column` };
  const sql = `SELECT ${aggregate} AS v FROM ${q(table.sqlName)} AS f${where.sql}`;
  try {
    const row = getDb().prepare(sql).get(...where.params) as { v: number | string | null };
    return { ...base, value: row?.v ?? 0, available: true };
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : "query failed" };
  }
}

export type ChartPoint = { key: string; label: string; value: number; series?: string };
export type ChartResult = {
  kind: Chart["kind"];
  title: string;
  format?: Chart["format"];
  available: boolean;
  reason?: string;
  points: ChartPoint[];
  seriesKeys: string[];
  rows?: Array<Record<string, string>>;
  columns?: Array<{ key: string; label: string }>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucketExpr(col: string, bucket: "month" | "day"): string {
  // Data Connector emits ISO-ish timestamps; substr is enough and avoids
  // date() returning NULL on values SQLite won't parse.
  return bucket === "month" ? `substr(${col}, 1, 7)` : `substr(${col}, 1, 10)`;
}

function bucketLabel(key: string, bucket?: "month" | "day"): string {
  if (bucket === "month" && /^\d{4}-\d{2}$/.test(key)) {
    const [year, month] = key.split("-");
    return `${MONTHS[Number(month) - 1] ?? month} ${year.slice(2)}`;
  }
  if (bucket === "day" && /^\d{4}-\d{2}-\d{2}$/.test(key)) return key.slice(5);
  return key;
}

export function runChart(chart: Chart): ChartResult {
  const base: ChartResult = {
    kind: chart.kind,
    title: chart.title,
    format: chart.format,
    available: false,
    points: [],
    seriesKeys: [],
  };

  const fact = getTable(chart.table);
  if (!fact) return { ...base, reason: `${chart.table}.csv not in dataset` };

  const where = whereSql(fact, chart.where);
  if (!where) return { ...base, reason: "filter column missing" };

  if (chart.kind === "table") {
    return runTable(chart, fact, where, base);
  }

  if (!chart.category) return { ...base, reason: "no category" };

  let joinClause = "";
  let categoryExpr: string | undefined;

  if (chart.category.table && chart.category.table !== chart.table) {
    const plan = planJoin(fact, chart.category.table, chart.category.column);
    if (!plan) return { ...base, reason: `cannot join ${chart.category.table}` };
    joinClause = plan.clause;
    categoryExpr = plan.expr;
  } else {
    categoryExpr = factColumn(fact, chart.category.column);
    if (!categoryExpr) return { ...base, reason: `column "${chart.category.column}" missing` };
  }

  if (chart.category.bucket) categoryExpr = bucketExpr(categoryExpr, chart.category.bucket);

  let seriesExpr: string | undefined;
  if (chart.series) {
    seriesExpr = factColumn(fact, chart.series.column);
    if (!seriesExpr) seriesExpr = undefined; // series is decoration; drop it silently
  }

  const valueColumn = chart.value?.column ? factColumn(fact, chart.value.column) : undefined;
  if (chart.value?.column && !valueColumn) {
    return { ...base, reason: `column "${chart.value.column}" missing` };
  }
  const measure = aggSql(valueColumn, chart.value?.agg ?? "count");
  if (!measure) return { ...base, reason: `${chart.value?.agg} requires a column` };

  const select = [`${categoryExpr} AS k`, `${measure} AS v`];
  const group = ["k"];
  if (seriesExpr) {
    select.push(`${seriesExpr} AS s`);
    group.push("s");
  }

  const orderBy = chart.category.bucket ? "k ASC" : "v DESC";
  const limit = chart.limit ?? (chart.category.bucket ? 400 : 15);

  // A stacked bar must keep every series slice for each selected category.
  // Limiting the grouped (category, series) rows drops slices and can change
  // both the chart totals and which categories appear.
  const sql = chart.kind === "stackedBar" && seriesExpr
    ? `WITH grouped AS (` +
      `SELECT ${select.join(", ")} FROM ${q(fact.sqlName)} AS f ${joinClause}${where.sql}` +
      ` GROUP BY ${group.join(", ")}` +
      `), top_categories AS (` +
      `SELECT k FROM grouped WHERE k IS NOT NULL AND k <> ''` +
      ` GROUP BY k ORDER BY SUM(v) DESC LIMIT ?` +
      `) SELECT grouped.k, grouped.s, grouped.v FROM grouped` +
      ` JOIN top_categories ON grouped.k = top_categories.k` +
      ` ORDER BY grouped.k, grouped.v DESC`
    : `SELECT ${select.join(", ")} FROM ${q(fact.sqlName)} AS f ${joinClause}${where.sql}` +
      ` GROUP BY ${group.join(", ")} ORDER BY ${orderBy} LIMIT ${Math.min(limit * (seriesExpr ? 6 : 1), 3000)}`;

  try {
    const params = chart.kind === "stackedBar" && seriesExpr
      ? [...where.params, Math.min(limit, 200)]
      : where.params;
    const rows = getDb().prepare(sql).all(...params) as Array<{
      k: string | null;
      v: number | null;
      s?: string | null;
    }>;
    const points: ChartPoint[] = rows
      .filter((row) => row.k !== null && row.k !== "")
      .map((row) => ({
        key: String(row.k),
        label: bucketLabel(String(row.k), chart.category?.bucket),
        value: Number(row.v ?? 0),
        series: row.s ? String(row.s) : undefined,
      }));

    const seriesKeys = [...new Set(points.map((p) => p.series).filter(Boolean) as string[])];
    return { ...base, available: true, points, seriesKeys };
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : "query failed" };
  }
}

function runTable(
  chart: Chart,
  fact: DatasetTable,
  where: { sql: string; params: string[] },
  base: ChartResult,
): ChartResult {
  const cols = chart.columns ?? [];
  const select: string[] = [];
  const outCols: Array<{ key: string; label: string }> = [];
  const joinClauses: string[] = [];
  const joinAliases = new Map<string, string>();

  cols.forEach((col, index) => {
    const alias = `c${index}`;
    if (col.table && col.table !== chart.table) {
      const existingAlias = joinAliases.get(col.table);
      const joinAlias = existingAlias ?? `d${joinAliases.size + 1}`;
      const plan = planJoin(fact, col.table, col.column, joinAlias);
      if (!plan) return;
      if (!existingAlias) {
        joinAliases.set(col.table, joinAlias);
        joinClauses.push(plan.clause);
      }
      select.push(`${plan.expr} AS ${alias}`);
    } else {
      const expr = factColumn(fact, col.column);
      if (!expr) return;
      select.push(`${expr} AS ${alias}`);
    }
    outCols.push({ key: alias, label: col.label });
  });

  if (select.length === 0) return { ...base, reason: "no resolvable columns" };

  let order = "";
  if (chart.sort) {
    const sortExpr = factColumn(fact, chart.sort.column);
    if (sortExpr) order = ` ORDER BY ${sortExpr} ${chart.sort.dir === "asc" ? "ASC" : "DESC"}`;
  }

  const sql =
    `SELECT ${select.join(", ")} FROM ${q(fact.sqlName)} AS f ${joinClauses.join(" ")}${where.sql}${order}` +
    ` LIMIT ${Math.min(chart.limit ?? 25, 200)}`;

  try {
    const rows = getDb().prepare(sql).all(...where.params) as Array<Record<string, string | null>>;
    return {
      ...base,
      available: true,
      columns: outCols,
      rows: rows.map((row) => {
        const out: Record<string, string> = {};
        for (const col of outCols) out[col.key] = row[col.key] ?? "—";
        return out;
      }),
    };
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : "query failed" };
  }
}

export type ToolStatus = {
  spec: ToolSpec;
  enabled: boolean;
  missing: string[];
  rowCount: number;
};

export function toolStatus(spec: ToolSpec): ToolStatus {
  const missing: string[] = [];
  let rowCount = 0;
  for (const name of spec.requires) {
    const table = getTable(name);
    if (!table) missing.push(name);
    else rowCount += table.rowCount;
  }
  return { spec, enabled: missing.length === 0, missing, rowCount };
}

export type DashboardResult = {
  spec: ToolSpec;
  kpis: KpiResult[];
  charts: ChartResult[];
};

export function runDashboard(spec: ToolSpec): DashboardResult {
  return {
    spec,
    kpis: spec.kpis.map(runKpi),
    charts: spec.charts.map(runChart),
  };
}
