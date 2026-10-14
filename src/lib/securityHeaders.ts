type ResponseHeader = { key: string; value: string };
type HeaderRule = {
  source: string;
  has?: { type: "header"; key: string; value: string }[];
  headers: ResponseHeader[];
};

/**
 * Same-origin browser policy. APS calls and file downloads run on the server,
 * so they do not require Autodesk or storage domains in browser connect-src.
 *
 * Next 15 emits inline hydration scripts and the UI uses inline chart styles.
 * This baseline therefore permits inline script/style elements; it is not a
 * nonce-based XSS policy. Inline event handlers remain disabled explicitly.
 */
export function contentSecurityPolicy(development: boolean, https: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * Apply baseline protections to every page, API response and public asset.
 * HTTPS enforcement is added only in production behind a TLS reverse proxy
 * that supplies x-forwarded-proto=https. Plain HTTP local previews retain
 * working HTTP assets and development retains Next's HMR WebSocket/eval.
 */
export function securityHeaderRules(nodeEnvironment: string | undefined): HeaderRule[] {
  const development = nodeEnvironment === "development";
  const baseline: HeaderRule = {
    source: "/:path*",
    headers: [
      { key: "Content-Security-Policy", value: contentSecurityPolicy(development, false) },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ],
  };
  if (nodeEnvironment !== "production") return [baseline];

  return [baseline, {
    source: "/:path*",
    has: [{ type: "header", key: "x-forwarded-proto", value: "https" }],
    headers: [
      // Only the current hostname is covered; no subdomain/preload commitment.
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
      { key: "Content-Security-Policy", value: contentSecurityPolicy(false, true) },
    ],
  }];
}
