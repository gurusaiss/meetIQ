import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getRepo, getService, getCapture, CAPTURE_EXTERNAL_ID } from "../../lib/singletons.ts";
import { forbidResponse, htmlError, escapeHtml } from "../../lib/http.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbidResponse();

  try {
    // This course's own id in the capture system, if it has one; else the organisation-wide default.
    const course = await getRepo().getCourse(identity!.institutionId, identity!.courseId!);
    await getService().importFromCapture(
      identity!.institutionId,
      identity!.courseId!,
      getCapture(),
      course?.externalId || CAPTURE_EXTERNAL_ID,
      identity!,
    );
  } catch (e) {
    console.error("capture.import.failed", e);
    const detail = e instanceof Error ? e.message.slice(0, 300) : "Unknown error";
    return htmlError(
      502,
      `<h1>Import failed</h1><div class="notice">${escapeHtml(detail)}</div><p><a href="/">← Dashboard</a></p>`,
    );
  }
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
