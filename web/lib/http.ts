import { NextResponse } from "next/server";

export function forbidResponse(): NextResponse {
  return new NextResponse("<h1>403 — not permitted for your role</h1>", {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function htmlError(status: number, body: string): NextResponse {
  return new NextResponse(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
