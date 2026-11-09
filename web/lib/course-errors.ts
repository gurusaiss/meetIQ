import type { NextResponse } from "next/server";
import { forbidResponse, htmlError, escapeHtml, isError } from "./http.ts";

/** Map the service's course errors to pages. Returns null for anything unexpected, so the caller rethrows it. */
export function courseErrorResponse(e: unknown, backHref: string, backLabel: string): NextResponse | null {
  const back = `<p><a href="${backHref}">${backLabel}</a></p>`;
  if (isError(e, "AuthorizationError")) return forbidResponse();
  if (isError(e, "NotFoundError")) return htmlError(404, `<h1>Not found</h1>${back}`);
  if (isError(e, "ValidationError")) return htmlError(400, `<h1>Can't do that</h1><div class="notice">${escapeHtml(e.message)}</div>${back}`);
  if (isError(e, "ConflictError")) return htmlError(409, `<h1>Can't do that</h1><div class="notice">${escapeHtml(e.message)}</div>${back}`);
  return null;
}
