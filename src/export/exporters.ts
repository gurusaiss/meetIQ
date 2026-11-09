/**
 * Pure export functions — turn approved knowledge assets into portable files
 * students actually use (SHOULD-tier in Phase 5). Kept dependency-free and
 * pure so they are trivially unit-tested and reused by any delivery surface.
 */
import type { RevisionNotes, Flashcard, Quiz, ActionsAndDecisions, Transcript, TranscriptSegment } from "../types.ts";
import type { AuditEvent } from "../persistence/repository.ts";
import type { ChainVerification } from "../audit/chain.ts";

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

/** Decisions & action items → Markdown, grouped and cited (minutes-style). */
export function actionsToMarkdown(lectureId: string, actions: ActionsAndDecisions): string {
  const lines: string[] = [`# ${lectureId} — Decisions & Action Items`, ""];
  lines.push("## Decisions", "");
  if (actions.decisions.length === 0) lines.push("_No decisions recorded._", "");
  for (const d of actions.decisions) {
    const cite = d.sourceRefs.length ? ` _(cite: ${d.sourceRefs.join(", ")})_` : "";
    const flag = d.flagged ? " ⚠️ _low-confidence — verify_" : "";
    lines.push(`- ${d.text}${cite}${flag}`);
  }
  lines.push("", "## Action items", "");
  if (actions.actionItems.length === 0) lines.push("_No action items recorded._", "");
  for (const a of actions.actionItems) {
    const owner = a.owner ? ` — **${a.owner}**` : " — _unassigned_";
    const cite = a.statement.sourceRefs.length ? ` _(cite: ${a.statement.sourceRefs.join(", ")})_` : "";
    const flag = a.statement.flagged ? " ⚠️ _low-confidence — verify_" : "";
    lines.push(`- [ ] ${a.statement.text}${owner}${cite}${flag}`);
  }
  return lines.join("\n") + "\n";
}

// ── Transcript / captions (accessibility) ───────────────────────────

/** `HH:MM:SS` + `,` (SRT) or `.` (WebVTT) + milliseconds. */
function clock(sec: number, sep: "," | "."): string {
  const total = Math.max(0, Math.round(sec * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms, 3)}`;
}

/** A caption cue must end after it starts, and must not contain a blank line (that ends the cue). */
function cueSpan(seg: TranscriptSegment): { start: number; end: number; text: string } {
  const end = seg.end > seg.start ? seg.end : seg.start + 1;
  const text = seg.text.trim().replace(/\s*\n\s*/g, " ");
  return { start: seg.start, end, text };
}

/** Transcript → SubRip (.srt), the format video players, LMSs and caption editors all accept. */
export function transcriptToSrt(t: Transcript): string {
  return (
    t.segments
      .map((seg, i) => {
        const c = cueSpan(seg);
        const who = seg.speaker ? `${seg.speaker}: ` : "";
        return `${i + 1}\n${clock(c.start, ",")} --> ${clock(c.end, ",")}\n${who}${c.text}\n`;
      })
      .join("\n")
  );
}

function vttEscape(s: string): string {
  // `&` and `<` are markup in WebVTT cue text; `-->` inside a cue is a parse hazard.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/-->/g, "--&gt;");
}

/** Transcript → WebVTT (.vtt), the native caption format of the HTML5 <track> element. */
export function transcriptToVtt(t: Transcript): string {
  const cues = t.segments.map((seg) => {
    const c = cueSpan(seg);
    const text = vttEscape(c.text);
    // `<v Name>` is WebVTT's voice tag; a speaker label can't contain `>` or a newline.
    const body = seg.speaker ? `<v ${vttEscape(seg.speaker).replace(/[>\n]/g, "")}>${text}` : text;
    return `${clock(c.start, ".")} --> ${clock(c.end, ".")}\n${body}\n`;
  });
  return `WEBVTT\n\n${cues.join("\n")}`;
}

/**
 * Transcript → plain text with timestamps. Segments the recogniser was unsure
 * about are marked, so a reader of the text isn't misled into trusting them.
 */
export function transcriptToText(lectureId: string, t: Transcript, flagThreshold: number): string {
  const lines: string[] = [`${lectureId} — Transcript`, ""];
  for (const seg of t.segments) {
    const who = seg.speaker ? `${seg.speaker}: ` : "";
    const unsure = seg.confidence < flagThreshold ? "  [low confidence — verify against the recording]" : "";
    lines.push(`[${clock(seg.start, ".").slice(0, 8)}] ${who}${seg.text.trim()}${unsure}`);
  }
  return lines.join("\n") + "\n";
}

// ── Audit trail (for auditors) ──────────────────────────────────────

/**
 * One CSV cell. A value starting with = + - @ (or a tab/CR) is run as a formula
 * by Excel and Sheets, and audit fields include names and free text, so those get
 * a leading quote, which makes the spreadsheet treat them as plain text.
 */
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function verdictLine(v: ChainVerification): string {
  return v.ok
    ? `audit chain: VERIFIED. ${v.chained} chained events, ${v.legacy} from before the chain existed (not verifiable), ${v.keyed ? "keyed (HMAC)" : "unkeyed (SHA-256)"}, head ${v.head ?? "none"}`
    : `audit chain: BROKEN at event ${v.brokenAt}. ${v.reason ?? ""}`;
}

/**
 * The audit trail as CSV, with the tamper-check verdict as the first line (a
 * `#` comment: most tools skip it, a person opening the file sees it) and each
 * event's hash and predecessor, so the chain can be re-verified outside the app.
 */
export function auditToCsv(events: AuditEvent[], verification: ChainVerification): string {
  const lines = [`# ${verdictLine(verification)}`, "seq,ts,actor,action,target,prev_hash,hash"];
  events.forEach((e, i) => {
    lines.push([String(i + 1), e.ts, e.actor, e.action, e.target, e.prevHash ?? "", e.hash ?? ""].map(csvCell).join(","));
  });
  return lines.join("\n") + "\n";
}

/** The same, as JSON: the verdict, the head hash to record elsewhere, and every event. */
export function auditToJson(events: AuditEvent[], verification: ChainVerification): string {
  return JSON.stringify(
    {
      verification,
      head: verification.head,
      events: events.map((e, i) => ({ seq: i + 1, ts: e.ts, actor: e.actor, action: e.action, target: e.target, prevHash: e.prevHash ?? null, hash: e.hash ?? null })),
    },
    null,
    2,
  ) + "\n";
}
