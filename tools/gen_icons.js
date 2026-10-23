// tools/gen_icons.js — generate extension icons (no dependencies, hand-rolled PNG encoding)
// Usage: node tools/gen_icons.js

"use strict";
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 16; // base bitmap; other sizes are scaled up proportionally

// Blue rounded square + white "M" glyph
const BG = [37, 99, 235, 255]; // #2563eb
const FG = [255, 255, 255, 255];

const M_GLYPH = [
  "1000001",
  "1100011",
  "1010101",
  "1001001",
  "1000001",
  "1000001",
  "1000001",
];

function basePixel(x, y) {
  // rounded corners: 2px radius
  const r = 2;
  const inCorner =
    (x < r && y < r && (r - x) ** 2 + (r - y) ** 2 > r * r + 1) ||
    (x >= SIZE - r && y < r && (x - (SIZE - r - 1)) ** 2 + (r - y) ** 2 > r * r + 1) ||
    (x < r && y >= SIZE - r && (r - x) ** 2 + (y - (SIZE - r - 1)) ** 2 > r * r + 1) ||
    (x >= SIZE - r && y >= SIZE - r &&
      (x - (SIZE - r - 1)) ** 2 + (y - (SIZE - r - 1)) ** 2 > r * r + 1);
  if (inCorner) return [0, 0, 0, 0];

  const gx = x - 5, gy = y - 5; // place the "M" glyph at (5,5)
  if (gy >= 0 && gy < M_GLYPH.length && gx >= 0 && gx < M_GLYPH[0].length) {
    if (M_GLYPH[gy][gx] === "1") return FG;
  }
  return BG;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  const scale = size / SIZE;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let off = 0;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = basePixel(
        Math.min(SIZE - 1, Math.floor(x / scale)),
        Math.min(SIZE - 1, Math.floor(y / scale))
      );
      raw[off++] = r; raw[off++] = g; raw[off++] = b; raw[off++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), makePng(size));
  console.log(`icons/icon${size}.png written`);
}
