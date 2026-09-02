import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers + CSP nonce, applied to every request — the Next.js
 * equivalent of the same headers the zero-dep server sets per-request.
 *
 * Nonce handling follows Next.js's own documented pattern: the nonce goes on
 * an `x-nonce` request header (so Server Components can read it via
 * `headers()` if they ever need to nonce something themselves) and on the
 * response's CSP header; Next automatically applies that nonce to its own
 * framework-injected inline scripts once it sees the CSP header carries one.
 *
 * style-src allows 'unsafe-inline' — Next's dev-mode Fast Refresh injects
 * inline <style> tags for CSS updates, which a nonce can't cover without
 * extra plumbing on every dev rebuild. This mirrors Next's own official CSP
 * example. In production, CSS ships as external stylesheets regardless.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("permissions-policy", "geolocation=(), microphone=(), camera=()");
  response.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return response;
}

export const config = {
  matcher: [
    // Skip static assets and Next's own internals.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
