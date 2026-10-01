export interface Tile {
  key: string;
  icon: string;
  title: string;
  desc: string;
  /** gradient colours for the icon tile */
  from: string;
  to: string;
}

/** Ways to bring content in (faculty / TA / admin only). */
export const INPUT_TILES: Tile[] = [
  { key: "record", icon: "🎙️", title: "Record", desc: "Record straight from your microphone, right in the browser.", from: "#ef4444", to: "#f97316" },
  { key: "upload", icon: "📁", title: "Upload recording", desc: "Audio or video file: lecture, meeting, call.", from: "#6366f1", to: "#8b5cf6" },
  { key: "text", icon: "✍️", title: "Paste text", desc: "Type or paste notes, an article or a transcript.", from: "#0ea5e9", to: "#6366f1" },
  { key: "file", icon: "📄", title: "Upload text file", desc: ".txt, .md, .srt or .vtt transcripts and notes.", from: "#14b8a6", to: "#0ea5e9" },
];

/** What you can make from an input. */
export const TOOL_TILES: Tile[] = [
  { key: "notes", icon: "📝", title: "Revision notes", desc: "Cited, confidence-scored notes by topic.", from: "#6366f1", to: "#8b5cf6" },
  { key: "flashcards", icon: "🃏", title: "Flashcards", desc: "Flip-card study set with Anki export.", from: "#f59e0b", to: "#ef4444" },
  { key: "quiz", icon: "❓", title: "Quiz", desc: "Self-grading multiple choice with explanations.", from: "#10b981", to: "#14b8a6" },
  { key: "flowchart", icon: "🔀", title: "Flowchart", desc: "The session as a step-by-step topic flow.", from: "#0ea5e9", to: "#6366f1" },
  { key: "slides", icon: "📊", title: "PPT slides", desc: "Download a PowerPoint deck of the verified notes.", from: "#f97316", to: "#ec4899" },
  { key: "search", icon: "🔎", title: "Search", desc: "Ask questions across every input, with timestamps.", from: "#8b5cf6", to: "#ec4899" },
];

export function toolHref(tool: string, lectureId: string, canManage: boolean): string {
  const id = encodeURIComponent(lectureId);
  switch (tool) {
    case "notes":
    case "flashcards":
    case "quiz":
      return canManage ? `/lectures/${id}/review#${tool}` : `/lectures/${id}/student#${tool}`;
    case "flowchart":
      return `/lectures/${id}/flowchart`;
    case "slides":
      return `/lectures/${id}/slides`;
    default:
      return "/search";
  }
}
