import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../../../lib/auth.ts";
import { getRepo, getService, getLms, INSTITUTION_ID, EXTERNAL_COURSE } from "../../../../lib/singletons.ts";
import { forbidResponse, htmlError } from "../../../../lib/http.ts";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await getIdentity();
  if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbidResponse();
  const { id: lectureId } = await params;
  const lms = getLms();

  const lecture = getRepo().getLecture(INSTITUTION_ID, lectureId);
  if (!lecture) return htmlError(404, "<h1>Lecture not found</h1>");

  const count = await getService().publishToLms(INSTITUTION_ID, lectureId, lms, EXTERNAL_COURSE, identity!);

  // Redirect back to the review page with a query-string notice — the page
  // reads it and renders the same "Published N asset(s)" message the
  // original hand-rolled server returned inline.
  const url = new URL(`/lectures/${encodeURIComponent(lectureId)}/review`, req.url);
  url.searchParams.set("published", String(count));
  url.searchParams.set("total", String(lms.published.length));
  return NextResponse.redirect(url, { status: 303 });
}
