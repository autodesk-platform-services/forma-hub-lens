import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { ChartResult } from "../src/lib/dashboards/engine.ts";

// Render the actual TSX component without booting Next or copying its logic.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dirname, "../src/components/charts.tsx"), "utf8");
const compiled = ts.transpileModule(code, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const exportsObject: Record<string, unknown> = {};
new Function("require", "exports", compiled)(createRequire(import.meta.url), exportsObject);
const ChartCard = exportsObject.ChartCard as (props: { result: ChartResult }) => React.ReactNode;
const formatValue = exportsObject.formatValue as (value: number, format?: string) => string;
const colors = exportsObject.DATA_COLORS as string[];
const render = (result: ChartResult) => renderToStaticMarkup(createElement(ChartCard, { result }));
const chart = (kind: ChartResult["kind"], points: ChartResult["points"]): ChartResult => ({
  kind, title: "Test chart", available: true, points, seriesKeys: [],
});

test("treemap and donut show every returned category with full names and counts", () => {
  const long = "Root cause involving the complete commissioning handover sequence";
  const points = Array.from({ length: 14 }, (_, index) => ({ key: `k${index}`,
    label: index === 13 ? long : `Category ${index}`, value: index + 1 }));
  const treemap = render(chart("treemap", points));
  assert.ok(treemap.includes(long));
  assert.ok(treemap.includes("Category 12"));
  assert.ok(treemap.includes("Share of the categories shown"));
  assert.equal(treemap.includes("preserveAspectRatio"), false);
  const donut = render(chart("donut", points.slice(0, 10)));
  assert.ok(donut.includes("Category 9"));
  assert.ok(donut.includes("55"));
});

test("named columns, status series, and scatter projects expose readable labels and values", () => {
  const name = "A very long project name that should remain fully visible";
  const categorical = render(chart("column", [{ key: "project-a", label: name, value: 3 }]));
  assert.ok(categorical.includes(name));
  assert.equal(categorical.includes("<svg"), false);
  const stacked = render({ ...chart("stackedBar", [
    { key: "p-open", label: name, value: 2, series: "Open for review" },
    { key: "p-closed", label: name, value: 4, series: "Closed with response" },
  ]), seriesKeys: ["Open for review", "Closed with response"] });
  assert.ok(stacked.includes(name));
  assert.ok(stacked.includes("Open for review"));
  assert.ok(stacked.includes("Closed with response"));
  assert.ok(stacked.includes("View 2 series values"));
  const scatter = render(chart("scatter", [{ key: "p", label: name, value: 12 }]));
  assert.ok(scatter.includes(name));
  assert.ok(scatter.includes("12"));
});

test("a one-status stacked chart still names that status", () => {
  const stacked = render({ ...chart("stackedBar", [
    { key: "p-open", label: "Project A", value: 5, series: "Open for review" },
  ]), seriesKeys: ["Open for review"] });
  assert.ok(stacked.includes("Open for review"));
  assert.ok(stacked.includes("Project A"));
  assert.ok(stacked.includes("5"));
});

test("a one-status donut draws a full ring instead of a degenerate arc", () => {
  const donut = render(chart("donut", [{ key: "open", label: "Open", value: 5 }]));
  assert.ok(donut.includes('<circle cx="78" cy="78" r="50"'));
  assert.ok(donut.includes("Open: 5"));
  assert.equal(donut.includes("<path"), false);
});

test("time plots show recent periods while the complete table retains older values", () => {
  const points = Array.from({ length: 70 }, (_, index) => ({ key: `2026-${String(index + 1).padStart(2, "0")}`,
    label: `Period ${index + 1}`, value: index + 1 }));
  const markup = render(chart("line", points));
  assert.ok(markup.includes("most recent 60 of 70 periods"));
  assert.ok(markup.includes("View all 70 labels and values"));
  assert.ok(markup.includes("Period 1"));
  assert.ok(markup.includes("Period 70"));
  assert.ok(markup.includes('width="2476"'));
});

test("percent values use the source's 0–100 scale and empty charts explain absence", () => {
  assert.equal(formatValue(0.5, "percent"), "0.5%");
  assert.equal(formatValue(75, "percent"), "75.0%");
  for (const kind of ["bar", "stackedBar", "donut", "treemap", "scatter", "column"] as ChartResult["kind"][]) {
    assert.ok(render(chart(kind, [])).includes("No rows matched"), kind);
  }
});

test("chart marks remain visible against white cards", () => {
  for (const hex of colors) {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    assert.ok(1.05 / (luminance + 0.05) >= 3, `${hex} should contrast with white by at least 3:1`);
  }
});
