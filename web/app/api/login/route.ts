import { NextResponse, type NextRequest } from "next/server";
import { getSessions, getLoginLimiter, INSTITUTION_ID } from "../../../lib/singletons.ts";
import { COOKIE_NAME, type Identity, type Role } from "../../../lib/auth.ts";

const ROLES: Role[] = ["student", "faculty", "ta", "admin"];

/** A non-redirect error response — NextResponse.redirect only accepts 3xx statuses. */
function errorPage(status: number, message: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><body><h1>Sign in</h1><div class="notice">${message}</div>` +
      `<p><a href="/login">Back to sign in</a></p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(req: NextRequest) {
  const clientKey =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!getLoginLimiter().check(clientKey)) {
    return errorPage(429, "Too many attempts. Please wait a minute and try again.");
  }

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "") as Role;

  if (!name || !ROLES.includes(role)) {
    return errorPage(400, "Enter a name and valid role.");
  }

  const identity: Identity = {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    role,
    institutionId: INSTITUTION_ID,
  };
  const session = getSessions().create(identity);

  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.set(COOKIE_NAME, session.token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
  });
  return res;
}
