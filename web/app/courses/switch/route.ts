import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../lib/auth.ts";
import { getService } from "../../../lib/singletons.ts";
import { forbidResponse, htmlError } from "../../../lib/http.ts";
import { setCourseCookie } from "../../../lib/course-cookie.ts";

/** Switch which course you're in. Refused unless you can actually reach it (the cookie is re-checked on every request anyway). */
export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const courseId = String((await req.formData()).get("courseId") ?? "");
  if (!(await getService().canAccessCourse(identity.institutionId, courseId, identity))) {
    return htmlError(404, `<h1>Not found</h1><p><a href="/courses">← Back</a></p>`);
  }
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  setCourseCookie(res, courseId);
  return res;
}
