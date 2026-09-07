#!/usr/bin/env node
// Generate the real PNG icons iOS needs for "Add to Home Screen".
//
// iOS ignores an SVG apple-touch-icon, so real PNGs have to exist. Rather than commit binaries
// nobody can regenerate, they are drawn here with a tiny hand-written PNG encoder over Node's
// built-in zlib -- no image library, no download. Re-run with `npm run make-icons`.
//
// The critter is deliberate, not decoration for its own sake: contract pack Section 1 asks for
// cute animal critters as the app's visual personality. This is the placeholder one; the real
// visual pass should reference BuildConsole's existing critters for consistency.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** @param {number} size @param {(x:number,y:number)=>[number,number,number,number]} shade */
function png(size, shade) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BG = [16, 19, 23];
const BODY = [244, 179, 90];
const EAR = [225, 150, 70];
const DARK = [26, 22, 20];
const BLUSH = [237, 137, 122];

function mix(base, over, alpha) {
  return [
    Math.round(base[0] + (over[0] - base[0]) * alpha),
    Math.round(base[1] + (over[1] - base[1]) * alpha),
    Math.round(base[2] + (over[2] - base[2]) * alpha),
  ];
}

/** Antialiased disc coverage at (x,y) for a circle of radius r centred at (cx,cy). */
function disc(x, y, cx, cy, r) {
  const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  return Math.min(1, Math.max(0, r - d + 0.5));
}

/**
 * @param {number} size
 * @param {boolean} maskable  maskable icons get shrunk into the safe zone iOS/Android crop to
 */
function critter(size, { maskable = false, transparentBg = false } = {}) {
  const scale = maskable ? 0.68 : 0.82;
  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * scale;

  return (x, y) => {
    let colour = BG;
    let alpha = 1;

    if (transparentBg) {
      colour = BG;
      alpha = 0;
    }

    // ears
    for (const dir of [-1, 1]) {
      const cover = disc(x, y, cx + dir * R * 0.62, cy - R * 0.66, R * 0.34);
      if (cover > 0) {
        colour = mix(colour, EAR, cover);
        alpha = Math.max(alpha, cover);
      }
    }

    // body
    const body = disc(x, y, cx, cy + R * 0.06, R * 0.92);
    if (body > 0) {
      colour = mix(colour, BODY, body);
      alpha = Math.max(alpha, body);
    }

    // blush
    for (const dir of [-1, 1]) {
      const cover = disc(x, y, cx + dir * R * 0.55, cy + R * 0.28, R * 0.19) * 0.55;
      if (cover > 0) colour = mix(colour, BLUSH, cover);
    }

    // eyes
    for (const dir of [-1, 1]) {
      const cover = disc(x, y, cx + dir * R * 0.32, cy - R * 0.06, R * 0.13);
      if (cover > 0) colour = mix(colour, DARK, cover);
    }

    // snout
    const snout = disc(x, y, cx, cy + R * 0.3, R * 0.1);
    if (snout > 0) colour = mix(colour, DARK, snout);

    return [colour[0], colour[1], colour[2], Math.round(alpha * 255)];
  };
}

const targets = [
  ["icon-180.png", 180, {}],
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["favicon-32.png", 32, { transparentBg: true }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(resolve(OUT, name), png(size, critter(size, opts)));
  console.log(`wrote public/icons/${name} (${size}x${size})`);
}
