import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-portfolio-"));
process.env.DATA_DIR = workdir;
process.env.APS_CLIENT_ID = "test";
process.env.APS_CLIENT_SECRET = "test";
process.env.APS_CALLBACK_URL = "http://localhost:3000/api/aps/callback";
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { getDb, closeDb } = await import("../src/lib/db.ts");
const { ingestZip } = await import("../src/lib/dataset.ts");
const { searchCompanies, searchPeople, searchProjects } = await import("../src/lib/portfolioSearch.ts");
const {
  addWatchItem, createSavedView, deleteSavedView, listSavedViews, listWatchItems,
  normalizeSavedPath, removeWatchItem, savedViewsOwner,
} = await import("../src/lib/savedViews.ts");

after(() => {
  closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("portfolio search is bounded and reports each local source", async () => {
  getDb().prepare("INSERT INTO projects (id, name, raw, synced_at) VALUES (?, ?, ?, ?)")
    .run("p1", "100% Bridge", "{}", Date.now());
  getDb().prepare("INSERT INTO projects (id, name, raw, synced_at) VALUES (?, ?, ?, ?)")
    .run("p2", "100X Bridge", "{}", Date.now());
  const companies = Array.from({ length: 52 }, (_, index) =>
    `c${index + 1},Acme ${String(index + 1).padStart(2, "0")},Engineering`);
  await ingestZip("portfolio.zip", zipSync({
    "admin_users.csv": strToU8("id,name,email,status\nu1,Ada,ada@example.com,active\n"),
    "admin_companies.csv": strToU8(`id,name,trade\n${companies.join("\n")}\n`),
  }));

  const projects = searchProjects("%", 1);
  assert.equal(projects.total, 1);
  assert.equal(projects.rows[0].id, "p1");
  assert.equal(projects.source.label, "Forma Admin API project sync");
  const people = searchPeople("ada@example.com", 1);
  assert.equal(people.total, 1);
  assert.equal(people.rows[0].id, "u1");
  assert.equal(people.source.label, "admin_users.csv");
  const first = searchCompanies("Acme", 1);
  const second = searchCompanies("Acme", 2);
  assert.equal(first.total, 52);
  assert.equal(first.rows.length, 50);
  assert.equal(second.rows.length, 2);
  assert.ok(first.source.asOf);
});

test("saved views and watchlists are user-owned and accept only internal view paths", () => {
  const owner = savedViewsOwner({ userId: "ADSK-1", userEmail: "ada@example.com" });
  assert.equal(owner, "autodesk:adsk-1");
  assert.equal(savedViewsOwner({ userId: null, userEmail: "ADA@EXAMPLE.COM" }), "email:ada@example.com");
  assert.equal(savedViewsOwner({ userId: null, userEmail: null }), null);
  assert.equal(
    normalizeSavedPath("/activity?project=p1&project=p2&from=2026-09-01&evil=ignored"),
    "/activity?project=p1&project=p2&from=2026-09-01",
  );
  assert.equal(
    normalizeSavedPath("/governance?rule=quiet-project&quietDays=90&largeMembership=100"),
    "/governance?rule=quiet-project&quietDays=90&largeMembership=100",
  );
  assert.throws(() => normalizeSavedPath("//evil.example/path"));
  assert.throws(() => normalizeSavedPath("https://evil.example/path"));
  assert.throws(() => normalizeSavedPath("/manage"));

  const alice = owner!;
  const bob = "autodesk:adsk-2";
  const view = createSavedView(alice, "Bridge activity", "/activity?project=p1");
  assert.equal(listSavedViews(alice).length, 1);
  assert.equal(listSavedViews(bob).length, 0);
  assert.equal(deleteSavedView(bob, view.id), false);
  assert.equal(deleteSavedView(alice, view.id), true);

  addWatchItem(alice, "project", "p1", "100% Bridge");
  addWatchItem(alice, "person", "u1", "Ada");
  assert.equal(listWatchItems(alice).length, 2);
  assert.equal(listWatchItems(bob).length, 0);
  assert.throws(() => addWatchItem(bob, "person", "unknown", "Unknown"));
  assert.equal(removeWatchItem(bob, "project", "p1"), false);
  assert.equal(removeWatchItem(alice, "project", "p1"), true);
});
