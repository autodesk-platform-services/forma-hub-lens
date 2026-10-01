import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type { Session } from "../src/lib/aps/auth.ts";
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const { fetchCloseoutProjectEvidence, downloadCloseoutVersion, safeCloseoutNextPath, safeCloseoutDownloadUrl } = await import("../src/lib/aps/closeoutEvidence.ts");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const project = "11111111-2222-3333-4444-555555555555";
const version = "urn:adsk.wipprod:fs.file:vf.abc?version=2";
const session = { id: "test", mode: "live", accessToken: "secret", refreshToken: null, expiresAt: Date.now() + 60_000,
  scope: "data:read", userId: "admin", userEmail: "a@example.com", userName: "Admin",
  hubVerifiedAt: Date.now(), hubRole: "hub_admin" } satisfies Session;
const json = (body: unknown) => Response.json(body);

test("pagination and signed file URLs cannot redirect credentials outside verified destinations", () => {
  assert.equal(safeCloseoutNextPath("/collection?offset=100", "/collection"), "/collection?offset=100");
  for (const bad of ["https://evil.example/collection", "/other", "https://u:p@developer.api.autodesk.com/collection"]) {
    assert.throws(() => safeCloseoutNextPath(bad, "/collection"));
  }
  assert.equal(safeCloseoutDownloadUrl("https://bucket.s3.us-east-1.amazonaws.com/object?signature=x").protocol, "https:");
  for (const bad of ["http://bucket.s3.amazonaws.com/x", "https://localhost/x", "https://s3.amazonaws.com.evil.example/x", "https://bucket.s3.amazonaws.com:444/x"]) assert.throws(() => safeCloseoutDownloadUrl(bad));
});

test("a permission failure remains unknown while complete empty domains remain complete", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret");
    if (url.pathname.endsWith("topFolders")) return json({ data: [] });
    if (url.pathname.includes("/issues/")) return new Response("Forbidden", { status: 403 });
    return json({ results: [], pagination: { totalResults: 0, limit: 100, offset: 0 } });
  }) as typeof fetch;
  const result = await fetchCloseoutProjectEvidence(session, project);
  assert.equal(result.sources.length, 10);
  assert.equal(result.sources.find((s) => s.domain === "issues")?.complete, false);
  assert.equal(result.sources.find((s) => s.domain === "files")?.complete, true);
  assert.match(calls.find((p) => p.includes("/assets/v2/"))!, /bim360\/assets\/v2/);
  assert.ok(calls.some((p) => p.includes("/rfis/v3/")));
});

test("external next pages and unproven collection endings never pass a scan", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://developer.api.autodesk.com");
    if (url.pathname.endsWith("topFolders")) return json({ data: [] });
    if (url.pathname.includes("/issues/")) return json({ results: [{ id: "issue" }], pagination: { nextUrl: "https://evil.example/steal" } });
    return json({ results: [] });
  }) as typeof fetch;
  const result = await fetchCloseoutProjectEvidence(session, project);
  assert.equal(result.sources.find((s) => s.domain === "issues")?.complete, false);
  assert.equal(result.sources.find((s) => s.domain === "forms")?.complete, false);
});

test("download pins the exact version, derives storage on APS, and sends no token to S3", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.hostname.endsWith("amazonaws.com")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      assert.equal(init?.redirect, "error"); return new Response("record");
    }
    if (url.pathname.includes("/versions/")) return json({ data: { id: version, attributes: { displayName: "O&M.pdf" }, relationships: {
      item: { data: { id: "item-1" } }, storage: { data: { id: "urn:adsk.objects:os.object:bucket/object" } },
    } } });
    return json({ status: "complete", url: "https://bucket.s3.amazonaws.com/object", size: 6 });
  }) as typeof fetch;
  const result = await downloadCloseoutVersion(session, project, version);
  assert.equal(result.versionId, version); assert.equal(result.itemId, "item-1");
  assert.equal(result.bytes.length, 6); assert.equal(result.sha256.length, 64);
  assert.ok(calls[0].includes(encodeURIComponent(version)));
});

test("a version mismatch stops before downloading content", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return json({ data: { id: "another-version" } }); }) as typeof fetch;
  await assert.rejects(downloadCloseoutVersion(session, project, version), /exact selected/);
  assert.equal(calls, 1);
  await assert.rejects(downloadCloseoutVersion(session, project, "https://evil.example"), /pinned/);
});

test("foreign project identifiers in JSON API attributes cannot become trusted project evidence", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("topFolders")) return json({ data: [] });
    if (url.pathname.endsWith("/issues")) return json({ results: [{ id: "foreign", project_id: project,
      attributes: { projectId: "99999999-2222-3333-4444-555555555555" } }], pagination: { totalResults: 1 } });
    return json({ results: [], pagination: { totalResults: 0 } });
  }) as typeof fetch;
  const result = await fetchCloseoutProjectEvidence(session, project);
  const issues = result.sources.find((source) => source.domain === "issues")!;
  assert.equal(issues.complete, false);
  assert.deepEqual(issues.rows, []);
  assert.match(issues.error!, /different project/);
});

test("APS-specific cursor, RFI search, review limits and transmittal recipient responses are preserved", async () => {
  const calls: { path: string; query: string; method: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push({ path: url.pathname, query: url.search, method: init?.method ?? "GET" });
    const offset = Number(url.searchParams.get("offset"));
    if (url.pathname.endsWith("topFolders")) return json({ data: [] });
    if (url.pathname.includes("/assets/")) {
      assert.equal(url.searchParams.has("offset"), false);
      if (url.pathname.endsWith("/assets")) {
        if (!url.searchParams.has("cursorState")) return json({ results: [{ id: "a1", categoryId: "c1" }], pagination: { cursorState: "opaque" } });
        assert.equal(url.searchParams.get("cursorState"), "opaque");
        return json({ results: [{ id: "a2", categoryId: "c1" }], pagination: { cursorState: null } });
      }
      return json({ results: [], pagination: { cursorState: null } });
    }
    if (url.pathname.endsWith("relationships:search")) return json({ relationships: [{ id: "link1", entities: [] }], page: { continuationToken: null } });
    if (url.pathname.endsWith("search:rfis")) {
      assert.equal(init?.method, "POST"); assert.deepEqual(JSON.parse(String(init?.body)), {});
      assert.equal(url.searchParams.has("limit"), false);
      return json({ results: [{ id: "rfi1", status: "closed" }], pagination: { totalResults: 1, offset } });
    }
    if (url.pathname.includes("/reviews/") || url.pathname.includes("/forms/")) assert.equal(url.searchParams.get("limit"), "50");
    if (url.pathname.endsWith("/transmittals")) return json({ results: [{ id: "t1" }], pagination: { totalResults: 1 } });
    if (url.pathname.endsWith("/documents")) return json({ results: [{ id: "d1" }], pagination: { totalResults: 1 } });
    if (url.pathname.endsWith("/recipients")) return json({ recipients: [{ id: "u1" }], externalMembers: [{ email: "owner@example.com" }] });
    return json({ results: [], pagination: { totalResults: 0, offset: 0, limit: 50 } });
  }) as typeof fetch;
  const result = await fetchCloseoutProjectEvidence(session, project);
  for (const domain of ["assets", "rfis", "relationships", "transmittals"]) {
    assert.equal(result.sources.find((source) => source.domain === domain)?.complete, true, domain);
  }
  assert.equal(result.sources.find((source) => source.domain === "assets")?.rows.length, 2);
  assert.equal(result.sources.find((source) => source.domain === "transmittals")?.rows[0].recipient_count, 2);
  assert.ok(calls.some((call) => call.path.endsWith("search:rfis") && call.method === "POST"));
});

test("Assets full pages without cursor or terminal evidence remain incomplete", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("topFolders")) return json({ data: [] });
    if (url.pathname.includes("/assets/")) return json({ results: [{ id: "a1" }] });
    return json({ results: [], pagination: { totalResults: 0 } });
  }) as typeof fetch;
  const result = await fetchCloseoutProjectEvidence(session, project);
  assert.equal(result.sources.find((source) => source.domain === "assets")?.complete, false);
});
