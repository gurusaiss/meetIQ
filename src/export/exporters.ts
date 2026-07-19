/**
 * Pure export functions — turn approved knowledge assets into portable files
 * students actually use (SHOULD-tier in Phase 5). Kept dependency-free and
 * pure so they are trivially unit-tested and reused by any delivery surface.
 */
import type { RevisionNotes, Flashcard, Quiz } from "../types.ts";

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Revision notes → Markdown, preserving timestamps + grounding + flags. */
export function notesToMarkdown(lectureId: string, notes: RevisionNotes): string {
  const lines: string[] = [`# ${lectureId} — Revision Notes`, ""];
  for (const topic of notes.topics) {
    lines.push(`## ${topic.title}  _(@${mmss(topic.start)})_`, "");
    for (const p of topic.points) {
      const cite = p.sourceRefs.length ? ` _(cite: ${p.sourceRefs.join(", ")})_` : "";
      const flag = p.flagged ? " ⚠️ _low-confidence — verify_" : "";
      lines.push(`- ${p.text}${cite}${flag}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Flashcards → Anki-importable CSV. Anki reads plain rows of `front,back`;
 * we quote every field and escape embedded quotes so commas/newlines in the
 * content don't break the import.
 */
export function flashcardsToAnkiCsv(cards: Flashcard[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return cards.map((c) => `${q(c.front)},${q(c.back.text)}`).join("\n") + "\n";
}

/** Quiz → Markdown with an answer key at the end (self-study format). */
export function quizToMarkdown(lectureId: string, quiz: Quiz): string {
  const lines: string[] = [`# ${lectureId} — Quiz`, ""];
  quiz.questions.forEach((qq, i) => {
    lines.push(`**Q${i + 1}. ${qq.question}**`, "");
    qq.options.forEach((o, j) => lines.push(`- (${String.fromCharCode(65 + j)}) ${o}`));
    lines.push("");
  });
  lines.push("---", "", "## Answer key", "");
  quiz.questions.forEach((qq, i) => {
    lines.push(
      `${i + 1}. **${String.fromCharCode(65 + qq.answerIndex)}** — ${qq.explanation.text}`,
    );
  });
  return lines.join("\n") + "\n";
}
