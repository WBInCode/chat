// Generates the PWA / favicon icon set as real PNG files, with no external
// image dependencies. The design is a maskable-safe full-bleed indigo→violet
// gradient square with a centered white chat bubble (typing dots) inside the
// 80% safe zone, so a single asset works for both "any" and "maskable".
//
// Run: node scripts/gen-icons.mjs   (outputs into ../public)
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public");
mkdirSync(OUT, { recursive: true });

// ---- CRC32 + PNG encoder ----------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Filtered raw: filter byte 0 per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// ---- shape helpers (unit square coordinates) --------------------------------
function insideRoundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  if (dx <= 0 && dy <= 0) return true;
  const ex = Math.max(dx, 0);
  const ey = Math.max(dy, 0);
  return ex * ex + ey * ey <= r * r;
}

function insideCircle(px, py, cx, cy, rad) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= rad * rad;
}

function insideTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Composite a single sub-sample point → [r,g,b] (fully opaque square).
function sample(u, v) {
  // Gradient background (indigo-600 → violet-600), full bleed.
  let r = lerp(79, 124, v);
  let g = lerp(70, 58, v);
  let b = lerp(229, 237, v);

  // White chat bubble (rounded rect) + tail, within the safe zone.
  const bubble = insideRoundRect(u, v, 0.5, 0.455, 0.265, 0.2, 0.075);
  const tail = insideTriangle(u, v, 0.35, 0.6, 0.35, 0.73, 0.47, 0.61);
  if (bubble || tail) {
    r = 255;
    g = 255;
    b = 255;
    // Typing dots (indigo-500) inside the bubble.
    if (
      insideCircle(u, v, 0.4, 0.455, 0.03) ||
      insideCircle(u, v, 0.5, 0.455, 0.03) ||
      insideCircle(u, v, 0.6, 0.455, 0.03)
    ) {
      r = 99;
      g = 102;
      b = 241;
    }
  }
  return [r, g, b];
}

function render(size) {
  const ss = 4; // supersampling for anti-aliasing
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          const [r, g, b] = sample(u, v);
          ar += r;
          ag += g;
          ab += b;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(ar / n);
      rgba[i + 1] = Math.round(ag / n);
      rgba[i + 2] = Math.round(ab / n);
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32]
];

for (const [name, size] of targets) {
  writeFileSync(join(OUT, name), render(size));
  console.log("wrote", name, size);
}
