/**
 * Renders the app icon (two chevrons on a dark tile) to PNG without any image library.
 * Usage: node scripts/make-icons.mjs  -> public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
 */
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const BG = [0x0f, 0x11, 0x15];
const FG = [0x4f, 0x8c, 0xff];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const roundedRectDist = (x, y, size, r) => {
  const qx = Math.abs(x - size / 2) - (size / 2 - r), qy = Math.abs(y - size / 2) - (size / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/** chevrons drawn in a 64-unit coordinate system scaled to `inner`, centered in `size` */
function renderer(size, { maskable }) {
  const inner = maskable ? size * 0.6 : size * 0.72; // maskable keeps the glyph inside the safe zone
  const s = inner / 44;
  const ox = (size - 44 * s) / 2 - 10 * s, oy = (size - 28 * s) / 2 - 18 * s; // glyph spans x 10..54, y 18..46
  const segs = [[24, 18, 10, 32], [10, 32, 24, 46], [40, 18, 54, 32], [54, 32, 40, 46]];
  const stroke = 3 * s;
  const aa = (d) => Math.max(0, Math.min(1, 0.5 - d));
  return (x, y) => {
    const bgA = maskable ? 1 : aa(roundedRectDist(x, y, size, size * 0.22));
    if (bgA <= 0) return [0, 0, 0, 0];
    let d = Infinity;
    for (const [ax, ay, bx, by] of segs) d = Math.min(d, segDist(x, y, ox + ax * s, oy + ay * s, ox + bx * s, oy + by * s));
    const fgA = aa(d - stroke);
    const c = BG.map((b, i) => Math.round(b + (FG[i] - b) * fgA));
    return [c[0], c[1], c[2], Math.round(255 * bgA)];
  };
}

const out = path.resolve(import.meta.dirname, "../public");
await Promise.all([
  writeFile(path.join(out, "icon-192.png"), png(192, renderer(192, { maskable: false }))),
  writeFile(path.join(out, "icon-512.png"), png(512, renderer(512, { maskable: false }))),
  writeFile(path.join(out, "icon-maskable-512.png"), png(512, renderer(512, { maskable: true }))),
  writeFile(path.join(out, "apple-touch-icon.png"), png(180, renderer(180, { maskable: true }))),
]);
console.log("icons written to public/");
