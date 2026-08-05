import { NextResponse, type NextRequest } from "next/server";
import { consumeState, exchangeCode, HubAccessError, setSessionCookie } from "@/lib/aps/auth";

export const dynamic = "force-dynamic";

/** Registered APS callback: http://localhost:3000/api/aps/callback */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const error = params.get("error");
  if (error) {
    const description = params.get("error_description") ?? "";
    return errorPage(`Autodesk returned "${error}". ${description}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return errorPage("The callback was missing the authorization code or state parameter.");
  }
  if (!consumeState(state)) {
    return errorPage(
      "State parameter did not match a pending sign-in. Start again from the sign-in button.",
    );
  }

  try {
    const session = await exchangeCode(code);
    await setSessionCookie(session.id);
    return NextResponse.redirect(new URL("/", request.nextUrl.origin));
  } catch (cause) {
    if (cause instanceof HubAccessError) {
      // Authenticated fine, but not entitled to this hub. Say so plainly —
      // this is the expected outcome for anyone outside the hub, not a fault.
      return errorPage(cause.message, "Access denied", 403);
    }
    return errorPage(cause instanceof Error ? cause.message : String(cause));
  }
}

function errorPage(
  message: string,
  heading = "Autodesk sign-in failed",
  status = 400,
): NextResponse {
  // A 403 is a legitimate outcome for someone outside the hub, so it gets no
  // setup troubleshooting — that hint only helps whoever runs the app.
  const hint =
    status === 403
      ? `<p style="color:#666;font-size:12px">If you believe you should have access, ask a hub
         administrator to add your Autodesk account to this Forma hub, then sign in again.</p>`
      : `<p style="color:#666;font-size:12px">Check that the APS app is a
         <strong>Traditional Web App</strong> and that this deployment's callback URL is
         registered on it.</p>`;

  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>
<style>
  body{background:#F5F5F0;color:#000;font:14px/1.6 Arial,sans-serif;padding:3rem}
  code{background:#fff;border:1px solid #D5D5CB;padding:.15rem .35rem;border-radius:3px}
  a{color:#1278AF}
  .box{max-width:46rem;border:1px solid #D5D5CB;border-radius:8px;padding:1.25rem;background:#fff}
</style></head>
<body><div class="box">
<h1 style="font-size:1rem;margin:0 0 .75rem;font-weight:700">${escapeHtml(heading)}</h1>
<p style="color:#666">${escapeHtml(message)}</p>
${hint}
<p><a href="/">Back to Forma Hub Lens</a></p>
</div></body></html>`;

  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
