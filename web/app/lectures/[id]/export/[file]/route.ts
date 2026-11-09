import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../../../lib/auth.ts";
import { getService } from "../../../../../lib/singletons.ts";
import {
  notesToMarkdown,
  flashcardsToAnkiCsv,
  quizToMarkdown,
  actionsToMarkdown,
  transcriptToSrt,
  transcriptToVtt,
  transcriptToText,
} from "../../../../../../src/export/exporters.ts";
import type { RevisionNotes, Quiz, Flashcard, ActionsAndDecisions } from "../../../../../../src/types.ts";
import { htmlError, isError, escapeHtml } from "../../../../../lib/http.ts";
import { config } from "../../../../../../src/config.ts";
import { slidesFromNotes } from "../../../../../lib/slides.ts";
import { buildPptx } from "../../../../../lib/pptx.ts";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  const { id: lectureId, file } = await params;
  let approved;
  try {
    approved = await getService().studentAssets(identity!.institutionId, lectureId, identity!);
  } catch (e) {
    // Not in a course the viewer can reach: the same 404 as a lecture that doesn't exist.
    if (isError(e, "NotFoundError")) return htmlError(404, "<h1>404</h1>");
    throw e;
  }

  const download = (body: string, type: string, name: string) =>
    new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": `${type}; charset=utf-8`,
        "content-disposition": `attachment; filename="${name}"`,
      },
    });

  if (file === "notes.md") {
    const a = approved.find((x) => x.type === "notes");
    if (!a) return htmlError(404, "<h1>Notes not released yet</h1>");
    return download(notesToMarkdown(lectureId, a.content as RevisionNotes), "text/markdown", `${lectureId}-notes.md`);
  }
  if (file === "flashcards.csv") {
    const a = approved.find((x) => x.type === "flashcards");
    if (!a) return htmlError(404, "<h1>Flashcards not released yet</h1>");
    return download(
      flashcardsToAnkiCsv((a.content as { cards: Flashcard[] }).cards),
      "text/csv",
      `${lectureId}-flashcards.csv`,
    );
  }
  if (file === "quiz.md") {
    const a = approved.find((x) => x.type === "quiz");
    if (!a) return htmlError(404, "<h1>Quiz not released yet</h1>");
    return download(quizToMarkdown(lectureId, a.content as Quiz), "text/markdown", `${lectureId}-quiz.md`);
  }
  if (file === "actions.md") {
    const a = approved.find((x) => x.type === "actions");
    if (!a) return htmlError(404, "<h1>Decisions & action items not released yet</h1>");
    return download(
      actionsToMarkdown(lectureId, a.content as ActionsAndDecisions),
      "text/markdown",
      `${lectureId}-actions.md`,
    );
  }
  if (file === "transcript.srt" || file === "transcript.vtt" || file === "transcript.txt") {
    try {
      const t = await getService().getTranscript(identity!.institutionId, lectureId, identity!, "export");
      if (file === "transcript.srt") return download(transcriptToSrt(t), "application/x-subrip", `${lectureId}-transcript.srt`);
      if (file === "transcript.vtt") return download(transcriptToVtt(t), "text/vtt", `${lectureId}-transcript.vtt`);
      return download(transcriptToText(lectureId, t, config.quality.confidenceFlagThreshold), "text/plain", `${lectureId}-transcript.txt`);
    } catch (e) {
      if (isError(e, "AuthorizationError")) {
        return htmlError(403, `<h1>Transcript not released yet</h1><div class="notice">${escapeHtml(e.message)}</div>`);
      }
      if (isError(e, "NotFoundError")) return htmlError(404, "<h1>No transcript for this session</h1>");
      throw e;
    }
  }
  if (file === "slides.pptx") {
    const a = approved.find((x) => x.type === "notes");
    if (!a) return htmlError(404, "<h1>Notes not released yet</h1>");
    const slides = slidesFromNotes(a.content as RevisionNotes);
    const buf = await buildPptx(lectureId, slides);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": `attachment; filename="${lectureId}-slides.pptx"`,
      },
    });
  }
  return htmlError(404, "<h1>404</h1>");
}
