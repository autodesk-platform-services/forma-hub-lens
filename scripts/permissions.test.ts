import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type { Session } from "../src/lib/aps/auth.ts";

process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { diffPermissionAssignments, folderPermissions, parseFolderPermissions } = await import("../src/lib/permissions.ts");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const session = {
  id: "session-1", mode: "live", accessToken: "signed-in-token", refreshToken: null,
  expiresAt: Date.now() + 60_000, scope: "data:read", userId: "admin-1",
  userName: "Admin", userEmail: "admin@example.com", hubVerifiedAt: Date.now(), hubRole: "hub_admin",
} satisfies Session;

test("parser accepts Autodesk collection wrappers and preserves raw assignment records", () => {
  const entry = {
    subjectType: "user", subjectId: "user-1", actions: ["VIEW", "DOWNLOAD"], inherited: false,
  };
  for (const body of [[entry], { results: [entry] }, { data: [entry] }, { permissions: [entry] }]) {
    const [row] = parseFolderPermissions(body);
    assert.equal(row.subjectType, "user");
    assert.equal(row.subjectId, "user-1");
    assert.deepEqual(row.actions, ["VIEW", "DOWNLOAD"]);
    assert.equal(row.inherited, false);
    assert.equal(row.comparable, true);
    assert.deepEqual(row.raw, entry);
  }
  assert.throws(() => parseFolderPermissions({ unexpected: [] }), /could not parse/);
  assert.throws(() => parseFolderPermissions({ results: [null] }), /unreadable permission entry/);
});

test("parser handles JSON:API attributes and excludes incomplete records from diff", () => {
  const rows = parseFolderPermissions({ data: [
    { subjectType: "role", attributes: { subjectId: "role-1", actions: [" VIEW "] } },
    { subjectType: "company", subjectId: "company-1" },
    { subjectType: "user", subjectId: "user-2", actions: ["VIEW", 7] },
    { subjectId: "missing-type", actions: ["VIEW"] },
  ] });
  assert.deepEqual(rows[0].actions, ["VIEW"]);
  assert.equal(rows[0].comparable, true);
  assert.equal(rows[1].comparable, false);
  assert.match(rows[1].parseIssue!, /Actions/);
  assert.equal(rows[2].comparable, false);
  assert.equal(rows[3].comparable, false);
  const diff = diffPermissionAssignments(rows, []);
  assert.equal(diff.skippedLeft, 3);
  assert.equal(diff.differences.length, 1);
  assert.equal(diff.differences[0].subjectId, "role-1");
});

test("diff ignores action order and duplicates, then labels changed and one-sided assignments", () => {
  const left = parseFolderPermissions([
    { subjectType: "user", subjectId: "same", actions: ["VIEW", "DOWNLOAD", "VIEW"], inherited: false },
    { subjectType: "role", subjectId: "changed", actions: ["VIEW"] },
    { subjectType: "company", subjectId: "only-left", actions: ["VIEW"] },
  ]);
  const right = parseFolderPermissions([
    { subjectType: "user", subjectId: "same", actions: ["DOWNLOAD", "VIEW"], inherited: true },
    { subjectType: "role", subjectId: "changed", actions: ["VIEW", "DOWNLOAD"] },
    { subjectType: "company", subjectId: "only-right", actions: ["VIEW"] },
  ]);
  const diff = diffPermissionAssignments(left, right);
  assert.equal(diff.unchangedSubjects, 1);
  assert.deepEqual(new Map(diff.differences.map((row) => [row.subjectId, row.kind])), new Map([
    ["only-left", "only-left"], ["only-right", "only-right"], ["changed", "changed"],
  ]));
  assert.deepEqual(diff.differences.find((row) => row.subjectId === "changed")!.rightActionSets, [["DOWNLOAD", "VIEW"]]);
});

test("multiple entries for one subject are ambiguous when their assignment records differ", () => {
  const left = parseFolderPermissions([
    { subjectType: "user", subjectId: "user-1", actions: ["VIEW"] },
    { subjectType: "user", subjectId: "user-1", actions: ["DOWNLOAD"] },
  ]);
  const same = parseFolderPermissions([
    { subjectType: "user", subjectId: "user-1", actions: ["DOWNLOAD"] },
    { subjectType: "user", subjectId: "user-1", actions: ["VIEW"] },
  ]);
  const changed = parseFolderPermissions([
    { subjectType: "user", subjectId: "user-1", actions: ["VIEW"] },
    { subjectType: "user", subjectId: "user-1", actions: ["EDIT"] },
  ]);
  assert.equal(diffPermissionAssignments(left, same).differences.length, 0);
  assert.equal(diffPermissionAssignments(left, same).unchangedSubjects, 1);
  assert.equal(diffPermissionAssignments(left, changed).differences[0].kind, "ambiguous");
});

test("folder assignment reads use only the documented GET route and signed-in token", async () => {
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", authorization: new Headers(init?.headers).get("Authorization") });
    return Response.json({ results: [{ subjectType: "user", subjectId: "user-1", actions: ["VIEW"] }] });
  }) as typeof fetch;
  const result = await folderPermissions(session, "b.project-1", "urn:adsk.wipprod:fs.folder:co.abcd");
  assert.equal(result.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].authorization, "Bearer signed-in-token");
  assert.equal(new URL(calls[0].url).pathname,
    "/bim360/docs/v1/projects/project-1/folders/urn%3Aadsk.wipprod%3Afs.folder%3Aco.abcd/permissions");
});
