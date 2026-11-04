import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { apsFetch, requireLiveApsSession } from "../src/lib/aps/client.ts";
import { getTwoLeggedToken } from "../src/lib/aps/twoLegged.ts";
import { verifyHubAccess } from "../src/lib/aps/authorization.ts";
import { setProjectStatus, fetchProjectStatus } from "../src/lib/aps/hubAdmin.ts";
import { inspectOffboarding } from "../src/lib/offboarding.ts";
import { refreshPublishedSchema, refreshPublishedChanges } from "../src/lib/integrationOfficial.ts";
import type { Session } from "../src/lib/aps/auth.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("hub APIs remain disabled even with a forged live role/session and LENS_MODE=live", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected outbound request"); };
  const previousMode = process.env.LENS_MODE;
  process.env.LENS_MODE = "live";
  const forged = { id: "forged", mode: "live", accessToken: "forged-token", refreshToken: null,
    expiresAt: Date.now() + 60_000, scope: "account:write", userId: "forged", userName: "Forged",
    userEmail: "forged@example.com", hubRole: "hub_admin", hubVerifiedAt: Date.now() } as Session;
  try {
    assert.throws(() => requireLiveApsSession(forged), /disabled in the public demo/);
    await assert.rejects(() => apsFetch(forged, "/construction/admin/v1/accounts/real/projects", { method: "POST" }), /disabled/);
    await assert.rejects(() => getTwoLeggedToken(), /disabled/);
    assert.equal((await verifyHubAccess("forged", "forged@example.com")).ok, false);
    await assert.rejects(() => setProjectStatus("some-project", "archived"), /disabled/);
    assert.equal(await fetchProjectStatus("some-project"), null);
    await assert.rejects(() => inspectOffboarding(forged, "former@example.com"), /disabled/);
    await assert.rejects(() => refreshPublishedSchema(), /disabled/);
    await assert.rejects(() => refreshPublishedChanges(), /disabled/);
    assert.equal(calls, 0, "neither hub data nor public schema requests may leave the demo");
  } finally {
    if (previousMode === undefined) delete process.env.LENS_MODE; else process.env.LENS_MODE = previousMode;
  }
});
