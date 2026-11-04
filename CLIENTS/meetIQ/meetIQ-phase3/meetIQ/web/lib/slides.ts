import type { RevisionNotes } from "../../src/types.ts";

export interface SlideBullet {
  text: string;
  flagged: boolean;
}
export interface SlideData {
  title: string;
  bullets: SlideBullet[];
  /** speaker notes: where each bullet came from */
  notes: string;
  start: number;
}

function mmss(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

/** One slide per topic; a bullet is a verified note. Pure so the preview and the .pptx agree. */
export function slidesFromNotes(notes: RevisionNotes): SlideData[] {
  return notes.topics
    .filter((t) => t.points.length > 0)
    .map((t) => ({
      title: t.title,
      start: t.start,
      bullets: t.points.map((p) => ({ text: p.text, flagged: p.flagged })),
      notes:
        `Starts at ${mmss(t.start)}.\n` +
        t.points
          .map((p) => `- ${p.text.slice(0, 60)}${p.text.length > 60 ? "…" : ""} [${p.sourceRefs.join(", ")}] ${Math.round(p.confidence * 100)}%${p.flagged ? " (low confidence)" : ""}`)
          .join("\n"),
    }));
}
