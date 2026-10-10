import type { Identity, Role } from "../../src/auth/session.ts";
import { getSector, type WordKey } from "../../src/auth/sectors.ts";

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

/** Tiles that aren't an input or a tool: oversight and administration. */
export const APPROVALS_TILE: Tile = {
  key: "approvals", icon: "✅", title: "Approvals",
  desc: "Review generated material. Nothing is released until you approve it.",
  from: "#10b981", to: "#0ea5e9",
};
export const AUDIT_TILE: Tile = {
  key: "audit", icon: "🛡️", title: "Audit trail",
  desc: "Every approval, export and deletion, plus data retention.",
  from: "#64748b", to: "#334155",
};
export const TEAM_TILE: Tile = {
  key: "team", icon: "👥", title: "Team & invite code",
  desc: "Who has joined, and the code for adding your colleagues.",
  from: "#8b5cf6", to: "#6366f1",
};

/** Apply the signed-in organisation's wording ("class", "meeting", "hearing"...). */
export function reword(tile: Tile, sectorId?: string): Tile {
  const w = getSector(sectorId)?.words[tile.key as WordKey];
  return w ? { ...tile, title: w[0], desc: w[1] } : tile;
}

/** What each permission role can do. Routes enforce these too; this only decides what to show. */
export function accessFor(role: Role) {
  return {
    /** add inputs, process, approve, delete, export */
    canManage: role === "faculty" || role === "ta" || role === "admin",
    canAudit: role === "admin" || role === "auditor",
    canRunRetention: role === "admin",
  };
}

/** The tiles a person sees, grouped for the home screen. */
export function tilesFor(identity: Identity) {
  const access = accessFor(identity.role);
  const sector = identity.sector;
  const tools = TOOL_TILES.map((t) => reword(t, sector));
  const admin: Tile[] = [];
  if (access.canManage) admin.push(APPROVALS_TILE);
  if (access.canAudit) admin.push(AUDIT_TILE);
  if (identity.owner || identity.role === "admin") admin.push(TEAM_TILE);
  return {
    inputs: access.canManage ? INPUT_TILES.map((t) => reword(t, sector)) : [],
    tools,
    admin,
    access,
  };
}

/** "class" / "classes" etc. for this person's organisation. */
export function noun(identity: Identity, plural = false): string {
  const n = getSector(identity.sector)?.noun ?? { one: "session", many: "sessions" };
  return plural ? n.many : n.one;
}

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
