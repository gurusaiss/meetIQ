import type { Tile as TileData } from "../lib/features.ts";

/** Line icons, 24px grid, drawn with currentColor so they follow the theme. */
const PATHS: Record<string, string> = {
  record: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3",
  upload: "M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v4h14v-4",
  text: "M5 6h14M5 11h14M5 16h9",
  file: "M7 3h7l4 4v14H7V3Zm7 0v4h4M10 12h5M10 16h5",
  notes: "M6 4h12v16H6V4Zm3 4h6M9 12h6M9 16h3",
  flashcards: "M4 8h13v10H4V8Zm3-3h13v10",
  quiz: "M12 17v.01M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  flowchart: "M4 4h6v5H4V4Zm10 11h6v5h-6v-5ZM7 9v3.5a2 2 0 0 0 2 2h5",
  slides: "M3 5h18v12H3V5Zm9 12v3m-4 0h8",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4",
  approvals: "m5 12.5 4.5 4.5L19 7.5",
  audit: "M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Zm-2.5 9 2 2 3.5-4",
  team: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8a6 6 0 0 1 12 0M16.5 11a2.5 2.5 0 1 0 0-5M18 19a5 5 0 0 0-2.5-4.3",
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.notes} />
    </svg>
  );
}

/** One box, one feature: the launcher card used on the home page and pickers. */
export function Tile({ tile, href }: { tile: TileData; href: string }) {
  return (
    <a className="tile" href={href}>
      <span className="tile-icon"><Icon name={tile.key} /></span>
      <span className="tile-title">{tile.title}</span>
      <span className="tile-desc">{tile.desc}</span>
      <span className="tile-go" aria-hidden="true">Open <i>→</i></span>
    </a>
  );
}
