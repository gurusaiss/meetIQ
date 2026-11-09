import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../../lib/auth.ts";
import { getService } from "../../../../lib/singletons.ts";
import { forbidResponse, htmlError, escapeHtml, isError } from "../../../../lib/http.ts";

/** Place or release a legal hold. The service decides who may; this maps its errors to pages. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const { id: lectureId } = await params;
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const back = `<p><a href="/lectures/${encodeURIComponent(lectureId)}/review">← Back to review</a></p>`;

  try {
    if (action === "place") {
      await getService().placeLegalHold(identity.institutionId, lectureId, String(form.get("reason") ?? ""), identity);
    } else if (action === "release") {
      await getService().releaseLegalHold(identity.institutionId, lectureId, identity);
    } else {
      return htmlError(400, `<h1>Unknown action</h1>${back}`);
    }
  } catch (e) {
    if (isError(e, "AuthorizationError")) {
      return htmlError(403, `<h1>Not permitted</h1><div class="notice">${escapeHtml(e.message)}</div>${back}`);
    }
    if (isError(e, "NotFoundError")) return htmlError(404, `<h1>Lecture not found</h1>`);
    if (isError(e, "ValidationError") || isError(e, "ConflictError")) {
      return htmlError(e.name === "ValidationError" ? 400 : 409, `<h1>Can't do that</h1><div class="notice">${escapeHtml(e.message)}</div>${back}`);
    }
    throw e;
  }
  return NextResponse.redirect(
    new URL(`/lectures/${encodeURIComponent(lectureId)}/review?hold=${action === "place" ? "placed" : "released"}`, req.url),
    { status: 303 },
  );
}
