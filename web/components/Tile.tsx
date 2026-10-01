import type { Tile as TileData } from "../lib/features.ts";

/** One box, one feature: the launcher card used on the home page and pickers. */
export function Tile({ tile, href }: { tile: TileData; href: string }) {
  return (
    <a className="tile" href={href}>
      <span className="tile-icon" style={{ background: `linear-gradient(135deg, ${tile.from}, ${tile.to})` }}>
        {tile.icon}
      </span>
      <span className="tile-title">{tile.title}</span>
      <span className="tile-desc">{tile.desc}</span>
    </a>
  );
}
