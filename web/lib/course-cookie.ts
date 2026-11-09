import type { NextResponse } from "next/server";
import { config } from "../../src/config.ts";
import { COURSE_COOKIE } from "./auth.ts";

/** Remember which course the person is in (or forget it, with `null`). Same protections as the session cookie. */
export function setCourseCookie(res: NextResponse, courseId: string | null): void {
  res.cookies.set(COURSE_COOKIE, courseId ?? "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: config.security.secureCookies,
    maxAge: courseId ? 60 * 60 * 24 * 30 : 0,
  });
}
