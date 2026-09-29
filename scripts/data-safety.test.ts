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

const { ingestZip, getTable } = await import("../src/lib/dataset.ts");
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

test("one failed activity download does not block later files", async () => {
  const jobId = "partial-job";
  const badName = "activities_docs_activities.csv";
  const goodName = "activities_issues_activities.csv";
  rememberJobs([{ id: jobId, status: "complete", completionStatus: "success" }]);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith(`/jobs/${jobId}/data-listing`)) {
      return Response.json([{ name: badName }, { name: goodName }]);
    }
    if (url.includes(`/jobs/${jobId}/data/`)) {
      const name = decodeURIComponent(url.split("/").pop() ?? "");
      return Response.json({ name, size: 100, signedUrl: `https://downloads.test/${name}` });
    }
    if (url.endsWith(badName)) return new Response("unavailable", { status: 503 });
    if (url.endsWith(goodName)) {
      return new Response("id,event_time,project_id,user_name,verb\n1,2026-09-01T00:00:00Z,p1,Ada,opened\n");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const session = {
    id: "session", accessToken: "token", refreshToken: null, expiresAt: Date.now() + 100_000,
    scope: null, userId: null, userName: null, userEmail: null, hubVerifiedAt: Date.now(),
  };
  const summary = await ingestJob(session, jobId);
  assert.equal(summary.files.length, 2);
  assert.equal(summary.files[0].failed, true);
  assert.equal(summary.files[1].rows, 1);
  assert.equal(storedJobs()[0].activityRows, 1);
  assert.match(storedJobs()[0].ingestError ?? "", /activities_docs_activities\.csv/);
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
    id: "session", accessToken: "token", refreshToken: null, expiresAt: Date.now() + 100_000,
    scope: null, userId: null, userName: null, userEmail: null, hubVerifiedAt: Date.now(),
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
