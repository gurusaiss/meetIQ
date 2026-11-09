import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../lib/auth.ts";
import { getService } from "../../../lib/singletons.ts";
import { forbidResponse, isError } from "../../../lib/http.ts";
import { setCourseCookie } from "../../../lib/course-cookie.ts";

/** Enrol with a course's join code, then switch into it. A bad code goes back to the form with one generic message. */
export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const code = String((await req.formData()).get("code") ?? "");
  try {
    const course = await getService().joinCourse(identity.institutionId, code, identity);
    const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
    setCourseCookie(res, course.id);
    return res;
  } catch (e) {
    if (isError(e, "ValidationError")) {
      return NextResponse.redirect(new URL(`/courses?error=${encodeURIComponent(e.message)}`, req.url), { status: 303 });
    }
    throw e;
  }
}
