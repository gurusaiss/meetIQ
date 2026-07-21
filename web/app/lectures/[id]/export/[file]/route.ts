import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../../../lib/auth.ts";
import { getService, INSTITUTION_ID } from "../../../../../lib/singletons.ts";
import {
  notesToMarkdown,
  flashcardsToAnkiCsv,
  quizToMarkdown,
} from "../../../../../../src/export/exporters.ts";
import type { RevisionNotes, Quiz, Flashcard } from "../../../../../../src/types.ts";
import { htmlError } from "../../../../../lib/http.ts";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  const { id: lectureId, file } = await params;
  const approved = getService().studentAssets(INSTITUTION_ID, lectureId);

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
  return htmlError(404, "<h1>404</h1>");
}
