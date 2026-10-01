import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-data-safety-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { ingestZip, getTable, validateZipSafety } = await import("../src/lib/dataset.ts");
const { ingestJob } = await import("../src/lib/ingest.ts");
const { rememberJobs, storedJobs, createDataRequest } = await import("../src/lib/aps/dataConnector.ts");
const { listActivities } = await import("../src/lib/queries.ts");
const { getDb, closeDb } = await import("../src/lib/db.ts");

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("ZIP import records and persists tables truncated at the row limit", async () => {
  const csv = `id\n${"1\n".repeat(400_001)}`;
  const zip = zipSync({ "large.csv": strToU8(csv) });
  const summary = await ingestZip("large.zip", zip);
  assert.deepEqual(summary.truncatedTables, ["large"]);
  assert.deepEqual(summary.tables.map((table) => ({ rows: table.rows, truncated: table.truncated })), [
    { rows: 400_000, truncated: true },
  ]);
  assert.equal(getTable("large")?.truncated, true);
});

test("ZIP limits reject inflated entries and entry floods before replacing tables", async () => {
  const large = zipSync({ "oversized.csv": strToU8(`id\n${"x".repeat(2048)}`) });
  assert.throws(
    () => validateZipSafety(large, {
      maxArchiveBytes: 10_000,
      maxEntryBytes: 1024,
      maxTotalBytes: 10_000,
      maxEntries: 10,
    }),
    /uncompressed per-file limit/,
  );
  // A hostile local header can lie about the inflated size; the actual output
  // byte counter must still stop it.
  const forgedHeader = Uint8Array.from(large);
  forgedHeader.set([0, 0, 0, 0], 22);
  assert.throws(
    () => validateZipSafety(forgedHeader, {
      maxArchiveBytes: 10_000,
      maxEntryBytes: 1024,
      maxTotalBytes: 10_000,
      maxEntries: 10,
    }),
    /uncompressed per-file limit/,
  );

  const original = zipSync({ "protected.csv": strToU8("id\nold\n") });
  await ingestZip("original.zip", original);
  const entries: Record<string, Uint8Array> = { "protected.csv": strToU8("id\nnew\n") };
  for (let i = 0; i < 500; i++) entries[`padding-${i}.txt`] = strToU8("x");
  await assert.rejects(() => ingestZip("flood.zip", zipSync(entries)), /more than 500 entries/);
  assert.equal(getTable("protected")?.rowCount, 1);
  assert.equal((getDb().prepare('SELECT id FROM "ds_protected"').get() as { id: string }).id, "old");
});

test("failed replacement after staging batches preserves the previous table and registry", async () => {
  await ingestZip("first.zip", zipSync({ "replacement.csv": strToU8("id\nold\n") }));
  const before = getTable("replacement");
  const malformed = `id\n${"new\n".repeat(2001)}"unterminated`;
  const summary = await ingestZip("failed.zip", zipSync({ "replacement.csv": strToU8(malformed) }));
  assert.deepEqual(summary.tables, []);
  assert.match(summary.skipped[0]?.reason ?? "", /unterminated quoted CSV field/);
  assert.deepEqual(getTable("replacement"), before);
  assert.equal((getDb().prepare('SELECT id FROM "ds_replacement"').get() as { id: string }).id, "old");
  const leaked = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ds_replacement_stage_%'").all();
  assert.equal(leaked.length, 0);
});

test("colliding CSV basenames cannot replace another logical table", async () => {
  await ingestZip("first-name.zip", zipSync({ "a-b.csv": strToU8("id\nold\n") }));
  const summary = await ingestZip("second-name.zip", zipSync({ "a_b.csv": strToU8("id\nnew\n") }));
  assert.deepEqual(summary.tables, []);
  assert.match(summary.skipped[0]?.reason ?? "", /collides with an existing source table/);
  assert.equal(getTable("a_b"), undefined);
  assert.equal((getDb().prepare('SELECT id FROM "ds_a_b"').get() as { id: string }).id, "old");
});

test("one failed activity download does not block later files", async () => {
  const jobId = "partial-job";
  const badName = "activities_docs_activities.csv";
  const goodName = "activities_issues_activities.csv";
  rememberJobs([{ id: jobId, status: "complete", completionStatus: "success" }]);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(`/jobs/${jobId}/data-listing`)) {
      return Response.json([{ name: badName }, { name: goodName }]);
    }
    if (url.includes(`/jobs/${jobId}/data/`)) {
      const name = decodeURIComponent(url.split("/").pop() ?? "");
      return Response.json({ name, size: 100, signedUrl: `https://bucket.s3.us-east-1.amazonaws.com/${name}` });
    }
    if (url.includes(".s3.us-east-1.amazonaws.com/")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
    }
    if (url.endsWith(badName)) return new Response("unavailable", { status: 503 });
    if (url.endsWith(goodName)) {
      return new Response("id,event_time,project_id,user_name,verb\n1,2026-09-01T00:00:00Z,p1,Ada,opened\n");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const session = {
    id: "session", mode: "live" as const, accessToken: "token", refreshToken: null, expiresAt: Date.now() + 100_000,
    scope: null, userId: null, userName: null, userEmail: null, hubVerifiedAt: Date.now(),
    hubRole: "hub_admin" as const,
  };
  const summary = await ingestJob(session, jobId);
  assert.equal(summary.files.length, 2);
  assert.equal(summary.files[0].failed, true);
  assert.equal(summary.files[1].rows, 1);
  assert.equal(storedJobs()[0].activityRows, 1);
  assert.match(storedJobs()[0].ingestError ?? "", /activities_docs_activities\.csv/);
});

test("activity ingest refuses unsafe or mismatched signed downloads before fetching them", async () => {
  const name = "activities_issues_activities.csv";
  const session = {
    id: "session", mode: "live" as const, accessToken: "token", refreshToken: null,
    expiresAt: Date.now() + 100_000, scope: null, userId: null, userName: null,
    userEmail: null, hubVerifiedAt: Date.now(), hubRole: "hub_admin" as const,
  };
  for (const [jobId, signed] of [
    ["unsafe-url-job", { name, size: 100, signedUrl: "http://127.0.0.1/private" }],
    ["wrong-name-job", { name: "another-file.csv", size: 100,
      signedUrl: `https://bucket.s3.amazonaws.com/${name}` }],
  ] as const) {
    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls++;
      if (url.endsWith(`/jobs/${jobId}/data-listing`)) return Response.json([{ name }]);
      if (url.includes(`/jobs/${jobId}/data/`)) return Response.json(signed);
      throw new Error(`Unsafe download was fetched: ${url}`);
    }) as typeof fetch;
    rememberJobs([{ id: jobId, status: "complete", completionStatus: "success" }]);
    const summary = await ingestJob(session, jobId);
    assert.equal(summary.files[0].failed, true);
    assert.match(summary.files[0].reason ?? "", /invalid signed download/);
    assert.equal(calls, 2);
  }
});

test("search treats LIKE wildcards as text and logs malformed raw JSON", () => {
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO activities (job_id, source_file, fingerprint, actor_name, target_name, raw) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insert.run("query-job", "test.csv", "query-a", "ann_1", "rate%done", '{"note":"ok"}');
  insert.run("query-job", "test.csv", "query-b", "annX1", "ratedone", '{"note":"ok"}');
  insert.run("query-job", "test.csv", "query-c", "broken", "broken", "not-json");

  assert.deepEqual(listActivities({ actor: "_" }, { limit: 10, offset: 0 }).rows.map((row) => row.actorName), ["ann_1"]);
  assert.deepEqual(listActivities({ search: "%" }, { limit: 10, offset: 0 }).rows.map((row) => row.targetName), ["rate%done"]);

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    const row = listActivities({ search: "broken" }, { limit: 10, offset: 0 }).rows[0];
    assert.deepEqual(row.raw, {});
  } finally {
    console.warn = realWarn;
  }
  assert.match(warnings.join("\n"), /Activity row \d+ has invalid raw JSON/);
});

test("Data Connector rejects an overlong custom request at the API boundary", async () => {
  const session = {
    id: "session", mode: "live" as const, accessToken: "token", refreshToken: null, expiresAt: Date.now() + 100_000,
    scope: null, userId: null, userName: null, userEmail: null, hubVerifiedAt: Date.now(),
    hubRole: "hub_admin" as const,
  };
  await assert.rejects(() => createDataRequest(session, {
    description: "too long",
    serviceGroups: ["activities"],
    dateRange: "CUSTOM",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-02-01T00:00:00.000Z",
  }), /31 days/);

  globalThis.fetch = (async () => Response.json({ id: "same-day" })) as typeof fetch;
  const sameDay = await createDataRequest(session, {
    description: "one day",
    serviceGroups: ["activities"],
    dateRange: "CUSTOM",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-01T23:59:59.999Z",
  });
  assert.equal(sameDay.id, "same-day");
});
