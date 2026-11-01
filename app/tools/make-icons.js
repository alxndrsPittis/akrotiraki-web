#!/usr/bin/env node
// Generates the PNG app icons without dependencies (Node's zlib only).
// Usage: node tools/make-icons.js   (run from the app/ folder or anywhere)
// Mark: a white Cycladic chapel (body, dome, arched door) on a flat --sea background,
// kept inside the central 80% so it also works as a maskable icon.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SEA = [0x1f, 0x5f, 0x8b];
const WHITE = [255, 255, 255];

// Shape in a 0..100 coordinate space (same geometry as icons/icon.svg).
function inMark(x, y) {
  const body = x >= 30 && x <= 70 && y >= 43.5 && y <= 70.5;
  const dome = y <= 43.5 && (x - 50) ** 2 + (y - 43.5) ** 2 <= 14 ** 2 && x >= 36 && x <= 64;
  const door = (x >= 45.5 && x <= 54.5 && y >= 58.5 && y <= 70.5) || (y < 58.5 && (x - 50) ** 2 + (y - 58.5) ** 2 <= 4.5 ** 2);
  return (body || dome) && !door;
}

function render(size) {
  const SS = 4; // supersampling per axis
  const rowLen = size * 3 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let py = 0; py < size; py++) {
    raw[py * rowLen] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 100;
          const y = ((py + (sy + 0.5) / SS) / size) * 100;
          if (inMark(x, y)) hit++;
        }
      }
      const a = hit / (SS * SS);
      const o = py * rowLen + 1 + px * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(SEA[c] * (1 - a) + WHITE[c] * a);
    }
  }
  return raw;
}

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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(outDir, name), png(size));
  console.log(`wrote icons/${name} (${size}x${size})`);
}
