// Packs cropped layers into one indexed PNG (#69). The PNG is written by hand so the palette in the file is exactly the locked palette, in order.
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(t)); return Buffer.concat([len, t, sum]); };

/** `pixels` holds one palette index per pixel; index 0 is transparent and `palette` starts at index 1. */
export function indexedPNG(pixels, w, h, palette) {
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 3;
  const plte = Buffer.from([0, 0, 0, ...palette.flat()]), raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('PLTE', plte), chunk('tRNS', Buffer.from([0])), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Tallest first, in rows across a sheet `width` wide. Layers are { name, w, h, cells: Uint8Array of palette indices }. Identical layers share a place. */
export function pack(layers, width = 512) {
  const seen = new Map(), place = {}, unique = [];
  for (const l of layers) { const k = l.w + 'x' + l.h + ':' + Buffer.from(l.cells).toString('latin1'); if (seen.has(k)) l.same = seen.get(k); else { seen.set(k, l); unique.push(l); } }
  unique.sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, row = 0;
  for (const l of unique) { if (x + l.w > width) { x = 0; y += row; row = 0; } l.sx = x; l.sy = y; x += l.w; row = Math.max(row, l.h); }
  const height = y + row, pixels = new Uint8Array(width * height);
  for (const l of unique) for (let j = 0; j < l.h; j++) pixels.set(l.cells.subarray(j * l.w, (j + 1) * l.w), (l.sy + j) * width + l.sx);
  for (const l of layers) { const s = l.same || l; place[l.name] = [s.sx, s.sy, l.w, l.h, l.dx, l.dy]; }
  return { pixels, width, height, place, unique: unique.length };
}
