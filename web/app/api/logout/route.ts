import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSessions } from "../../../lib/singletons.ts";
import { COOKIE_NAME } from "../../../lib/auth.ts";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  getSessions().destroy(jar.get(COOKIE_NAME)?.value);
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", sameSite: "lax", maxAge: 0 });
  return res;
}
