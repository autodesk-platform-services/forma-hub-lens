import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hublens-db-isolation-"));
process.env.DATA_DIR = directory;
process.env.FORMA_HUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const { closeDb, getDb } = await import("../src/lib/db.ts");

test("the same data directory cannot expose one hub's cached rows to another hub", () => {
  const firstHubId = process.env.FORMA_HUB_ID;
  try {
    getDb().prepare("INSERT INTO projects (id, raw, synced_at) VALUES (?, ?, ?)")
      .run("project-a", "{}", Date.now());
    closeDb();

    process.env.FORMA_HUB_ID = "ffffffff-1111-2222-3333-444444444444";
    const secondHubProjects = getDb().prepare("SELECT id FROM projects").all();
    assert.deepEqual(secondHubProjects, []);
    closeDb();

    process.env.FORMA_HUB_ID = firstHubId;
    const firstHubProjects = getDb().prepare("SELECT id FROM projects").all() as Array<{ id: string }>;
    assert.deepEqual(firstHubProjects.map((row) => row.id), ["project-a"]);
  } finally {
    closeDb();
    process.env.FORMA_HUB_ID = firstHubId;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
