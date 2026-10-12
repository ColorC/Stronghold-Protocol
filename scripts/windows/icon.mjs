// scripts/windows/icon.mjs — the Workshop icon as a Windows .ico, drawn from the same shape as the page favicon.
//
// public/independent.html uses an inline SVG favicon: a #101216 square (viewBox 24×24) with the #ff9a2e hexagon
// `M12 3 21 8v8l-9 5-9-5V8z`. The launcher exe and the installers need an .ico, and the repo has no binary icon, so the
// polygon is rasterised here (supersampled for anti-aliasing) instead of committing a binary that could drift from it.
//
// Every size below 256 is stored as a classic 32-bit DIB (what every icon consumer understands); 256×256 is stored
// as PNG, which Windows Vista+ expects for that size and which keeps the file small.

import zlib from 'node:zlib';

const BACKGROUND = [0x10, 0x12, 0x16];
const HEXAGON = [0xff, 0x9a, 0x2e];
/** Hexagon vertices in the favicon's 24×24 viewBox. */
const POLYGON = [[12, 3], [21, 8], [21, 16], [12, 21], [3, 16], [3, 8]];
export const ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 256]);

function inside(x, y) {
  let hit = false;
  for (let i = 0, j = POLYGON.length - 1; i < POLYGON.length; j = i++) {
    const [xi, yi] = POLYGON[i]; const [xj, yj] = POLYGON[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Top-down RGBA pixels of the icon at `size`×`size`. */
export function renderIcon(size, samples = 8) {
  const px = Buffer.alloc(size * size * 4);
  const scale = 24 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          if (inside((x + (sx + 0.5) / samples) * scale, (y + (sy + 0.5) / samples) * scale)) cover++;
        }
      }
      const a = cover / (samples * samples);
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BACKGROUND[c] * (1 - a) + HEXAGON[c] * a);
      px[o + 3] = 255;
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 (zip / PNG polynomial); `zlib.crc32` only exists from Node 22.2, so it is spelled out once here. */
export function crc32(buf, prev = 0) {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);   // XOR image + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4; const d = ((size - 1 - y) * size + x) * 4;   // bottom-up BGRA
      xor[d] = rgba[s + 2]; xor[d + 1] = rgba[s + 1]; xor[d + 2] = rgba[s]; xor[d + 3] = rgba[s + 3];
    }
  }
  const maskStride = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, xor, Buffer.alloc(maskStride * size)]);   // all-zero mask: alpha decides
}

/** The complete .ico file. */
export function workshopIco(sizes = ICON_SIZES) {
  const images = sizes.map((size) => (size >= 256 ? png(size, renderIcon(size, 4)) : dib(size, renderIcon(size))));
  const dir = Buffer.alloc(6 + 16 * sizes.length);
  dir.writeUInt16LE(1, 2); dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((size, i) => {
    const e = 6 + 16 * i;
    dir[e] = size >= 256 ? 0 : size; dir[e + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);   // planes / bit count filled in for every entry
    dir.writeUInt32LE(images[i].length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([dir, ...images]);
}

/** A standalone PNG of the icon, to look at the shape without an icon viewer. */
export function workshopPng(size = 256) {
  return png(size, renderIcon(size, 4));
}
