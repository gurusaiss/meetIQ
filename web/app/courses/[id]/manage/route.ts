import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../../lib/auth.ts";
import { getService } from "../../../../lib/singletons.ts";
import { forbidResponse, htmlError } from "../../../../lib/http.ts";
import { courseErrorResponse } from "../../../../lib/course-errors.ts";

/** Edit / archive / restore / replace the join code / remove a person. The service decides who may do each. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const { id } = await params;
  const form = await req.formData();
  const intent = String(form.get("intent") ?? "");
  const svc = getService();
  const inst = identity.institutionId;
  const back = `/courses/${encodeURIComponent(id)}`;

  try {
    if (intent === "update") {
      await svc.updateCourse(inst, id, {
        code: String(form.get("code") ?? ""),
        title: String(form.get("title") ?? ""),
        externalId: String(form.get("externalId") ?? ""),
      }, identity);
    } else if (intent === "archive") await svc.setCourseArchived(inst, id, true, identity);
    else if (intent === "restore") await svc.setCourseArchived(inst, id, false, identity);
    else if (intent === "newcode") await svc.courseJoinCode(inst, id, identity, true);
    else if (intent === "remove") await svc.removeCourseMember(inst, id, String(form.get("userId") ?? ""), identity);
    else return htmlError(400, `<h1>Unknown action</h1><p><a href="${back}">← Back</a></p>`);
  } catch (e) {
    const r = courseErrorResponse(e, back, "← Back to the course");
    if (r) return r;
    throw e;
  }
  return NextResponse.redirect(new URL(`${back}?done=${encodeURIComponent(intent)}`, req.url), { status: 303 });
}
