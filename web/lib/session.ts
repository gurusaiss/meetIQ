import { NextResponse, type NextRequest } from "next/server";
import { getSessions, getLoginLimiter, getEmailLimiter } from "./singletons.ts";
import { COOKIE_NAME, type Identity } from "../../src/auth/session.ts";
import { config } from "../../src/config.ts";

/**
 * `X-Forwarded-For` is set by the CLIENT unless a trusted reverse proxy
 * overwrites it, so trusting it unconditionally would let anyone dodge the
 * limiter by sending a different value each request. It is only read when the
 * operator has confirmed a proxy is in front (TRUST_PROXY=1); otherwise every
 * request shares one key, which still caps total attempts.
 */
function clientKey(req: NextRequest): string {
  if (!config.security.trustProxy) return "unproxied";
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** True when this client (and, if given, this account) has made too many attempts. */
export function tooManyAttempts(req: NextRequest, account?: string): boolean {
  const clientOk = getLoginLimiter().check(clientKey(req));
  const accountOk = account ? getEmailLimiter().check(`acct:${account}`) : true;
  return !(clientOk && accountOk);
}

/** Redirect (303) to `path`, optionally with a query string. */
export function redirectTo(req: NextRequest, path: string, params?: Record<string, string>): NextResponse {
  const url = new URL(path, req.url);
  for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v);
  return NextResponse.redirect(url, { status: 303 });
}

/** Create a session for `identity` and redirect with the session cookie set. */
export function startSession(req: NextRequest, identity: Identity, to = "/"): NextResponse {
  const session = getSessions().create(identity);
  const res = redirectTo(req, to);
  res.cookies.set(COOKIE_NAME, session.token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: config.security.secureCookies,
  });
  return res;
}

/** Form values as trimmed strings, capped so a huge field can't be echoed back or stored. */
export function field(form: FormData, name: string, max = 200): string {
  return String(form.get(name) ?? "").trim().slice(0, max);
}
