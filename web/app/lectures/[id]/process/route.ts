import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../../../lib/auth.ts";
import { getService, INSTITUTION_ID } from "../../../../lib/singletons.ts";
import { ComplianceError, ConflictError } from "../../../../../src/services/lecture-service.ts";
import { forbidResponse, htmlError, escapeHtml } from "../../../../lib/http.ts";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await getIdentity();
  if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbidResponse();
  const { id: lectureId } = await params;

  try {
    await getService().processLecture(INSTITUTION_ID, lectureId, {
      diarize: true,
      speakerHints: { SPEAKER_0: "Prof. Anika", SPEAKER_1: "Student" },
    });
  } catch (e) {
    if (e instanceof ComplianceError) {
      return htmlError(
        409,
        `<h1>Processing blocked</h1><div class="notice">${escapeHtml(e.message)}</div><p><a href="/">← Dashboard</a></p>`,
      );
    }
    if (e instanceof ConflictError) {
      return htmlError(
        409,
        `<h1>Cannot process</h1><div class="notice">${escapeHtml(e.message)}</div><p><a href="/">← Dashboard</a></p>`,
      );
    }
    // Provider/transcription failures (bad key, unreadable audio, rate limit): show a
    // readable page instead of Next's bare 500, and log the full error server-side.
    console.error("lecture.process.failed", lectureId, e);
    const detail = e instanceof Error ? e.message.slice(0, 300) : "Unknown error";
    return htmlError(
      502,
      `<h1>Processing failed</h1><div class="notice">${escapeHtml(detail)}</div>` +
        `<p>Check the provider settings and the audio file, then delete this session and create it again.</p>` +
        `<p><a href="/">← Dashboard</a></p>`,
    );
  }

  return NextResponse.redirect(new URL(`/lectures/${encodeURIComponent(lectureId)}/review`, req.url), {
    status: 303,
  });
}
