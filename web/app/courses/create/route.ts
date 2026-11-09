import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../lib/auth.ts";
import { getService } from "../../../lib/singletons.ts";
import { forbidResponse } from "../../../lib/http.ts";
import { setCourseCookie } from "../../../lib/course-cookie.ts";
import { courseErrorResponse } from "../../../lib/course-errors.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const form = await req.formData();
  try {
    const course = await getService().createCourse(
      identity.institutionId,
      { code: String(form.get("code") ?? ""), title: String(form.get("title") ?? ""), externalId: String(form.get("externalId") ?? "") },
      identity,
    );
    // Land on the new course's page (that's where staff find the code to hand out) and switch into it.
    const res = NextResponse.redirect(new URL(`/courses/${encodeURIComponent(course.id)}?created=1`, req.url), { status: 303 });
    setCourseCookie(res, course.id);
    return res;
  } catch (e) {
    const r = courseErrorResponse(e, "/courses", "← Back to courses");
    if (r) return r;
    throw e;
  }
}
