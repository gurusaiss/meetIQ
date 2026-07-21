import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getService, INSTITUTION_ID, COURSE_ID } from "../../lib/singletons.ts";
import { isValidLectureId } from "../../../src/web/lecture-id.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!hasRole(identity, ["faculty", "ta", "admin"])) {
    return new NextResponse("<h1>403 — not permitted for your role</h1>", {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const form = await req.formData();
  const lectureId = String(form.get("lectureId") ?? "").trim();
  if (!lectureId) {
    return new NextResponse("<h1>Missing lecture id</h1>", {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (!isValidLectureId(lectureId)) {
    return new NextResponse(
      "<h1>Invalid lecture id</h1><p>Use 1-64 characters: letters, digits, dot, dash, underscore; must start and end with a letter or digit.</p>",
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  getService().createLecture({
    institutionId: INSTITUTION_ID,
    courseId: COURSE_ID,
    lectureId,
    mediaRef: `media://${lectureId}`,
    captureSource: String(form.get("captureSource") ?? "upload"),
    consent: { noticeShown: form.get("noticeShown") === "on" },
  });

  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
