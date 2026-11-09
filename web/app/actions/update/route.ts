import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../lib/auth.ts";
import { getService } from "../../../lib/singletons.ts";
import { forbidResponse, htmlError, escapeHtml, isError } from "../../../lib/http.ts";

/** Assign / complete / reopen one action item. The service decides who may; this maps its errors to pages. */
export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const form = await req.formData();
  const lectureId = String(form.get("lectureId") ?? "");
  const index = Number(form.get("index"));
  const intent = String(form.get("intent") ?? "");
  const back = `<p><a href="/actions">← Back to the tracker</a></p>`;

  try {
    const svc = getService();
    if (intent === "done") await svc.updateActionItem(identity.institutionId, lectureId, index, { done: true }, identity);
    else if (intent === "reopen") await svc.updateActionItem(identity.institutionId, lectureId, index, { done: false }, identity);
    else if (intent === "assign") {
      await svc.updateActionItem(identity.institutionId, lectureId, index, { assignee: String(form.get("assignee") ?? "") }, identity);
    } else return htmlError(400, `<h1>Unknown action</h1>${back}`);
  } catch (e) {
    if (isError(e, "AuthorizationError")) return forbidResponse();
    if (isError(e, "NotFoundError")) return htmlError(404, `<h1>That action item isn't available</h1>${back}`);
    if (isError(e, "ValidationError")) return htmlError(400, `<h1>Can't do that</h1><div class="notice">${escapeHtml(e.message)}</div>${back}`);
    throw e;
  }
  return NextResponse.redirect(new URL(`/actions#item-${encodeURIComponent(lectureId)}-${index}`, req.url), { status: 303 });
}
