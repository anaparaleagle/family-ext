// Generate the extension's PNG icons — no image library, no build step, no
// checked-in binary we cannot regenerate.
//
// Why this exists: the icons here were 105/186/419-byte placeholders (a blue
// square with a white square in it), copied over from paraleagle-ext along with
// everything else. That is invisible while you sideload, and it becomes the face
// of the Chrome Web Store listing the moment you publish.
//
// Run:  node generate-icons.mjs
//
// Emits
//   icons/icon{16,48,128}.png   the manifest icons, full-bleed (toolbar + menus)
//   store-assets/store-icon-128.png
//                               the STORE LISTING icon, a separate upload in the
//                               developer dashboard. Google asks for the artwork
//                               to sit in ~96x96 with transparent padding, so this
//                               one is inset; the toolbar icons are not, because at
//                               16px padding is pixels you cannot spare.
//
// PNG is written by hand: zlib is in Node, and a PNG is just IHDR + a deflated
// block of filter-0 scanlines + IEND.

import { writeFileSync, mkdirSync } from "fs";
import { deflateSync } from "zlib";

// ── Brand ────────────────────────────────────────────────────────────────────
// #0b3d91 is the navy the popup already uses for its header and primary button
// (src/popup/popup.css). The gradient runs to a lighter blue so the mark still
// reads as a shape, not a flat block, at 16px on a dark toolbar.
const TOP_LEFT = [0x0b, 0x3d, 0x91];
const BOTTOM_RIGHT = [0x1e, 0x63, 0xc8];
const GLYPH = [0xff, 0xff, 0xff];

const SAMPLES = 4; // 4x4 supersampling per pixel -> 16 coverage steps

// ── Geometry, in a unit box ──────────────────────────────────────────────────
// A "P": one stem plus the right half of a ring. The ring's outer top is level
// with the top of the stem (c.y - R === stem.top), so the two meet flush instead
// of leaving a notch above the stem.
const STEM = { x0: 0.3375, x1: 0.4575, y0: 0.205, y1: 0.795 };
const BOWL = { cx: 0.4575, cy: 0.41, inner: 0.098, outer: 0.205 };
const CORNER_RADIUS = 0.22; // of the box side

function inRoundedSquare(x, y, inset) {
  const lo = inset;
  const hi = 1 - inset;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const side = hi - lo;
  const r = CORNER_RADIUS * side;
  // Distance to the nearest corner centre, only inside the corner boxes.
  const dx = Math.max(lo + r - x, 0, x - (hi - r));
  const dy = Math.max(lo + r - y, 0, y - (hi - r));
  return dx * dx + dy * dy <= r * r;
}

function inGlyph(x, y) {
  if (x >= STEM.x0 && x <= STEM.x1 && y >= STEM.y0 && y <= STEM.y1) return true;
  if (x < BOWL.cx) return false; // right half of the ring only
  const d = Math.hypot(x - BOWL.cx, y - BOWL.cy);
  return d >= BOWL.inner && d <= BOWL.outer;
}

function gradientAt(x, y) {
  const t = Math.min(1, Math.max(0, (x + y) / 2));
  return TOP_LEFT.map((c, i) => Math.round(c + (BOTTOM_RIGHT[i] - c) * t));
}

// ── Raster ───────────────────────────────────────────────────────────────────
/** RGBA pixel rows, alpha from rounded-square coverage so the corners are clear. */
function raster(size, inset) {
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(size * 4);
    for (let px = 0; px < size; px++) {
      let inside = 0;
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!inRoundedSquare(x, y, inset)) continue;
          inside++;
          const colour = inGlyph(x, y) ? GLYPH : gradientAt(x, y);
          for (let i = 0; i < 3; i++) acc[i] += colour[i];
        }
      }
      const total = SAMPLES * SAMPLES;
      const o = px * 4;
      if (inside === 0) continue; // leave transparent black
      for (let i = 0; i < 3; i++) row[o + i] = Math.round(acc[i] / inside);
      row[o + 3] = Math.round((inside / total) * 255);
    }
    rows.push(row);
  }
  return rows;
}

// ── PNG ──────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, no filter, no interlace.
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), r])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function write(path, size, inset) {
  const bytes = png(size, raster(size, inset));
  writeFileSync(path, bytes);
  console.log(`${path}  ${size}x${size}  ${bytes.length} bytes`);
}

mkdirSync("icons", { recursive: true });
mkdirSync("store-assets", { recursive: true });

for (const size of [16, 48, 128]) write(`icons/icon${size}.png`, size, 0);
// 12.5% inset === 16px of padding on a 128 canvas, per the store listing spec.
write("store-assets/store-icon-128.png", 128, 0.125);
