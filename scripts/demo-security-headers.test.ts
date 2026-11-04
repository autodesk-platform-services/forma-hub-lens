import assert from "node:assert/strict";
import test from "node:test";
import { contentSecurityPolicy, securityHeaderRules } from "../src/lib/securityHeaders.ts";

function directives(value: string): Map<string, string[]> {
  return new Map(value.split(";").map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
}

test("every route receives framing, content-type and referrer protections", () => {
  for (const environment of ["development", "production", "test", undefined]) {
    const [baseline] = securityHeaderRules(environment);
    assert.equal(baseline.source, "/:path*");
    assert.equal(baseline.has, undefined);
    const headers = new Map(baseline.headers.map(({ key, value }) => [key, value]));
    assert.equal(headers.get("X-Frame-Options"), "DENY");
    assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(headers.get("Referrer-Policy"), "no-referrer");
    const csp = directives(headers.get("Content-Security-Policy")!);
    assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(csp.get("object-src"), ["'none'"]);
    assert.deepEqual(csp.get("base-uri"), ["'self'"]);
    assert.deepEqual(csp.get("form-action"), ["'self'"]);
    assert.deepEqual(csp.get("script-src-attr"), ["'none'"]);
    assert.equal(headers.has("Strict-Transport-Security"), false);
    assert.equal(csp.has("upgrade-insecure-requests"), false);
  }
});

test("production restricts browser resources and keeps Next hydration/chart styling", () => {
  const csp = directives(contentSecurityPolicy(false, false));
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
  assert.deepEqual(csp.get("connect-src"), ["'self'"]);
  assert.deepEqual(csp.get("script-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp.get("img-src"), ["'self'", "data:", "blob:"]);
  assert.deepEqual(csp.get("font-src"), ["'self'"]);
  assert.deepEqual(csp.get("frame-src"), ["'none'"]);
  assert.equal(contentSecurityPolicy(false, false).includes("'unsafe-eval'"), false);
});

test("development permits Next HMR and debugging without upgrading localhost", () => {
  const rules = securityHeaderRules("development");
  assert.equal(rules.length, 1);
  const csp = directives(rules[0].headers.find(({ key }) => key === "Content-Security-Policy")!.value);
  assert.ok(csp.get("script-src")!.includes("'unsafe-eval'"));
  assert.deepEqual(csp.get("connect-src"), ["'self'", "ws:", "wss:"]);
  assert.equal(csp.has("upgrade-insecure-requests"), false);
});

test("HTTPS enforcement matches only production TLS proxy responses", () => {
  const rules = securityHeaderRules("production");
  assert.equal(rules.length, 2);
  assert.equal(rules[1].source, "/:path*");
  assert.deepEqual(rules[1].has, [{ type: "header", key: "x-forwarded-proto", value: "https" }]);
  const headers = new Map(rules[1].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000");
  assert.equal(headers.get("Strict-Transport-Security")!.includes("includeSubDomains"), false);
  assert.equal(headers.get("Strict-Transport-Security")!.includes("preload"), false);
  const csp = directives(headers.get("Content-Security-Policy")!);
  assert.equal(csp.has("upgrade-insecure-requests"), true);
  assert.deepEqual(csp.get("connect-src"), ["'self'"]);
  assert.equal(csp.get("script-src")!.includes("'unsafe-eval'"), false);
});
