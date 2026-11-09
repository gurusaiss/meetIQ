import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../../lib/auth.ts";
import { getService } from "../../../../lib/singletons.ts";
import { AuthorizationError, NotFoundError } from "../../../../../src/services/lecture-service.ts";
import { forbidResponse, htmlError, escapeHtml, isError } from "../../../../lib/http.ts";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const { id: lectureId } = await params;

  try {
    await getService().deleteLecture(identity!.institutionId, lectureId, identity);
  } catch (e) {
    if (isError(e, "AuthorizationError")) return forbidResponse();
    if (isError(e, "NotFoundError")) return htmlError(404, "<h1>Lecture not found</h1>");
    if (isError(e, "ComplianceError")) {
      return htmlError(409, `<h1>Can't delete</h1><div class="notice">${escapeHtml(e.message)}</div><p><a href="/">← Dashboard</a></p>`);
    }
    throw e;
  }
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
