/**
 * Tests for the two pieces that have to be right before any real extract lands:
 * the CSV reader and the activity column mapper.
 *
 * Run with: npm test
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseCsvRecords } from "../src/lib/csv.ts";
import { csvCell } from "../src/lib/csvExport.ts";
import {
  isActivityFile,
  mapColumns,
  parseTimestamp,
  serviceFromFileName,
} from "../src/lib/activitySchema.ts";

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      // Emit in small chunks so multi-byte and mid-field boundaries get exercised.
      for (let i = 0; i < bytes.length; i += 7) {
        controller.enqueue(bytes.slice(i, i + 7));
      }
      controller.close();
    },
  });
}

async function collect<T>(iterator: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterator) out.push(item);
  return out;
}

test("parses plain rows", async () => {
  const rows = await collect(parseCsv(streamOf("a,b,c\n1,2,3\n")));
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("handles quoted fields, embedded commas, newlines and escaped quotes", async () => {
  const csv = 'name,note\n"Smith, Jo","said ""hi""\nthen left"\n';
  const rows = await collect(parseCsv(streamOf(csv)));
  assert.deepEqual(rows[1], ["Smith, Jo", 'said "hi"\nthen left']);
});

test("handles CRLF and a final row without a trailing newline", async () => {
  const rows = await collect(parseCsv(streamOf("a,b\r\n1,2\r\n3,4")));
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("keeps empty trailing fields", async () => {
  const rows = await collect(parseCsv(streamOf("a,b,c\n1,,\n")));
  assert.deepEqual(rows[1], ["1", "", ""]);
});

test("records are keyed by header, with the BOM stripped", async () => {
  const records = await collect(parseCsvRecords(streamOf("﻿id,name\n7,Ada\n")));
  assert.deepEqual(records, [{ id: "7", name: "Ada" }]);
});

test("multi-byte characters survive chunk boundaries", async () => {
  const records = await collect(parseCsvRecords(streamOf("id,name\n1,Ævar Ólafsdóttir 日本\n")));
  assert.equal(records[0].name, "Ævar Ólafsdóttir 日本");
});

test("CSV export keeps spreadsheet formula text inert", () => {
  assert.equal(csvCell('=HYPERLINK("https://example.test","x")'),
    `"'=HYPERLINK(""https://example.test"",""x"")"`);
  assert.equal(csvCell(" +SUM(A1:A2)"), `"' +SUM(A1:A2)"`);
  assert.equal(csvCell("-1"), `"'-1"`);
  assert.equal(csvCell("@name"), `"'@name"`);
  assert.equal(csvCell("＝1+2"), `"'＝1+2"`);
  assert.equal(csvCell('ordinary,"quoted"'), '"ordinary,""quoted"""');
});

test("maps a docs-style activity header", () => {
  const mapping = mapColumns([
    "id",
    "event_time",
    "project_id",
    "user_id",
    "user_name",
    "user_email",
    "verb",
    "object_type",
    "object_name",
  ]);
  assert.equal(mapping.occurred_at, "event_time");
  assert.equal(mapping.project_id, "project_id");
  assert.equal(mapping.actor_name, "user_name");
  assert.equal(mapping.actor_email, "user_email");
  assert.equal(mapping.action, "verb");
  assert.equal(mapping.target_type, "object_type");
  assert.equal(mapping.target_name, "object_name");
  assert.equal(mapping.idColumn, "id");
});

test("maps camelCase headers the same way as snake_case", () => {
  const mapping = mapColumns(["createdAt", "projectId", "createdByEmail", "activityType"]);
  assert.equal(mapping.occurred_at, "createdAt");
  assert.equal(mapping.project_id, "projectId");
  assert.equal(mapping.actor_email, "createdByEmail");
  assert.equal(mapping.action, "activityType");
});

test("a column is never claimed by two canonical fields", () => {
  // "name" is a candidate for actor_name and target_name; only one may win.
  const mapping = mapColumns(["timestamp", "name"]);
  const claimed = Object.entries(mapping)
    .filter(([key]) => key !== "idColumn")
    .map(([, header]) => header);
  assert.equal(new Set(claimed).size, claimed.length);
});

test("derives the service from the file name", () => {
  assert.equal(serviceFromFileName("activities_docs_activities.csv"), "docs");
  assert.equal(serviceFromFileName("activities_issues_activities.csv"), "issues");
  assert.equal(serviceFromFileName("activities_admin.csv"), "admin");
  assert.equal(serviceFromFileName("admin_projects.csv"), null);
});

test("recognises activity files only", () => {
  assert.equal(isActivityFile("activities_docs_activities.csv"), true);
  assert.equal(isActivityFile("admin_projects.csv"), false);
  assert.equal(isActivityFile("autodesk_data_extract.zip"), false);
  assert.equal(isActivityFile("README.html"), false);
});

test("parses the timestamp shapes Data Connector emits", () => {
  const expected = Date.UTC(2024, 5, 1, 12, 3, 4);
  assert.equal(parseTimestamp("2024-06-01T12:03:04.000Z"), expected);
  assert.equal(parseTimestamp("2024-06-01 12:03:04"), expected, "space-separated is read as UTC");
  assert.equal(parseTimestamp("2024-06-01T12:03:04"), expected, "zoneless is read as UTC");
  assert.equal(parseTimestamp(String(expected)), expected, "epoch millis");
  assert.equal(parseTimestamp(String(expected / 1000)), expected, "epoch seconds");
  assert.equal(parseTimestamp("2024-06-01T14:03:04+02:00"), expected, "explicit offset honoured");
  assert.equal(parseTimestamp(""), null);
  assert.equal(parseTimestamp(undefined), null);
  assert.equal(parseTimestamp("not a date"), null);
});
