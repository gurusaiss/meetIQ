import { NextResponse } from "next/server";

/**
 * True when `e` is one of our domain errors, matched by name rather than `instanceof`:
 * the app code is bundled into several server chunks, and a class can end up with more than
 * one identity there, which silently turns a 409/404/validation message into a generic 500.
 */
export function isError(e: unknown, name: string): e is Error {
  return e instanceof Error && e.name === name;
}

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
