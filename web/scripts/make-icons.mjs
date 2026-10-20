// Rasterises the MeetIQ mark (same geometry as app/icon.svg) to PNGs with no dependencies.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [0xf2, 0xed, 0xe3], FG = [0x1f, 0x5c, 0x4a];
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

// Coordinates in the 32-unit design space of icon.svg.
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const segDist = (px, py, ax, ay, bx, by) => {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
};
// full-bleed background (maskable/apple icons must not have transparent corners); `scale` shrinks the mark into the safe zone
function pixel(u, v, rounded, scale) {
  if (rounded && !inRoundRect(u, v, 0, 0, 32, 32, 7)) return null;
  const x = 16 + (u - 16) / scale, y = 16 + (v - 16) / scale;
  const ring = inRoundRect(x, y, 5 - 1.3, 5 - 1.3, 27 + 1.3, 27 + 1.3, 5.3) && !inRoundRect(x, y, 5 + 1.3, 5 + 1.3, 27 - 1.3, 27 - 1.3, 2.7);
  const tick = Math.min(segDist(x, y, 10, 16.5, 14, 20.5), segDist(x, y, 14, 20.5, 22, 11.5)) <= 1.3;
  return ring || tick ? FG : BG;
}
function png(size, { rounded, scale }) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 3;
  for (let j = 0; j < size; j++) {
    raw[j * (size * 4 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) {
        const p = pixel(((i + (si + .5) / S) / size) * 32, ((j + (sj + .5) / S) / size) * 32, rounded, scale);
        if (p) { r += p[0]; g += p[1]; b += p[2]; a++; }
      }
      const o = j * (size * 4 + 1) + 1 + i * 4, n = S * S;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const out = (f, size, o) => writeFileSync(new URL(`../public/icons/${f}`, import.meta.url), png(size, o));
out("icon-192.png", 192, { rounded: true, scale: 1 });
out("icon-512.png", 512, { rounded: true, scale: 1 });
out("maskable-512.png", 512, { rounded: false, scale: 0.72 });
out("apple-touch-icon.png", 180, { rounded: false, scale: 0.85 });
