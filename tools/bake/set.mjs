// Bakes the HD studio set (#81): backdrop, desk and desk props, read off the generated images once, so the browser draws PNGs and does no grid sampling.
// Run from the repo root: node tools/bake/set.mjs [--out dir]
// Same logic as backdropFromGrid / deskFromGrid / toGrid in site/pixel-broadcast-spike.html (the spike keeps its own copy for now).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2), oi = argv.indexOf('--out'), OUT = oi >= 0 ? argv[oi + 1] : 'site/public/hd';
const GW = 480, GH = 270;
fs.mkdirSync(OUT, { recursive: true });

async function read(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
}
/** RGBA cells, like the spike's Pix: values are rounded and clamped the way a canvas does. */
class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  idx(x, y) { return (y * this.w + x) * 4; }
  has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[this.idx(x, y) + 3] > 0; }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = this.idx(x, y); this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255; }
  get(x, y) { const i = this.idx(x, y); return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
}
const png = (P, file) => sharp(Buffer.from(P.d.buffer), { raw: { width: P.w, height: P.h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);

/** Backdrop: a true 480-column pixel picture (2.867 px blocks); sample the block centres. */
function backdropFromGrid(img) {
  const BB = 1376 / 480, rows = Math.floor(img.h / BB), out = new Pix(GW, GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const j = Math.min(rows - 1, Math.max(0, y - Math.floor((GH - rows) / 2)));
    const sx = Math.min(img.w - 1, Math.round((x + 0.5) * BB)), sy = Math.min(img.h - 1, Math.round((j + 0.5) * BB)), k = (sy * img.w + sx) * 4;
    out.set(x, y, [img.d[k], img.d[k + 1], img.d[k + 2]]);
  }
  return out;
}

/**
 * A pixel-art picture on a regular block grid (`B` source px a block, first block edge at `ox`, `oy`), sampled at block centres
 * onto the 480x270 canvas: each output pixel takes the centre of the block its 480-column position falls in, so a 240-block
 * picture comes out as exact 2x2 blocks. The picture is a little under 270 rows at 480 wide: the spare rows are the same
 * edge row repeated, split top and bottom, so nothing is cut (the studio does the same).
 */
function sceneFromGrid(img, B, ox, oy) {
  const S = img.w / GW, rows = Math.round(img.h / S), pad = Math.floor((GH - rows) / 2), out = new Pix(GW, GH);
  const snap = (v, o, max) => Math.min(max, Math.max(0, Math.round(o + (Math.floor((v - o) / B) + 0.5) * B)));
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const sx = snap((x + 0.5) * S, ox, img.w - 1), sy = snap(Math.min(rows - 0.5, Math.max(0.5, y - pad + 0.5)) * S, oy, img.h - 1), k = (sy * img.w + sx) * 4;
    out.set(x, y, [img.d[k], img.d[k + 1], img.d[k + 2]]);
  }
  return out;
}

function fringe(P) {
  const kill = [];
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if (P.has(x, y)) { const [r, g, b] = P.get(x, y); if (r > 150 && b > 120 && b - g > 40 && r - g > 40 && (!P.has(x - 1, y) || !P.has(x + 1, y) || !P.has(x, y - 1) || !P.has(x, y + 1))) kill.push([x, y]); }
  for (const [x, y] of kill) P.d[P.idx(x, y) + 3] = 0;
}

/** Desk: keyed, with the club badge drawn into the blank medallion. `skip` rows at the top are left out (the dark back lip of the v3 desk). */
async function deskFromGrid(img, badgeFile, top, skip) {
  const BX = 3.482, BY = 3.582, PX0 = 100, PY0 = top, W = img.w;
  const cols = Math.floor((1274 - PX0) / BX), rows = Math.floor((712 - PY0) / BY), P = new Pix(cols, rows);
  for (let j = skip; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = (Math.round(PY0 + (j + 0.5) * BY) * W + Math.round(PX0 + (i + 0.5) * BX)) * 4, r = img.d[k], g = img.d[k + 1], b = img.d[k + 2];
    if (r > 150 && b > 150 && g < 120 && r - g > 70 && b - g > 70) continue;
    P.set(i, j, [r, g, b]);
  }
  fringe(P);
  const S = 36, bd = await sharp(badgeFile).ensureAlpha().resize(S, S, { fit: 'fill' }).raw().toBuffer(), cx = Math.round((688 - PX0) / BX), cy = Math.round((568 - PY0) / BY);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = (j * S + i) * 4; if (bd[k + 3] > 140) P.set(cx - S / 2 + i, cy - S / 2 + j, [Math.round(bd[k] / 24) * 24, Math.round(bd[k + 1] / 24) * 24, Math.round(bd[k + 2] / 24) * 24]); }
  return P;
}

/** The 5.865 px block grid (240x131) the presenters were made on, magenta keyed with a fringe pass. */
function toGrid(img) {
  const BLK = 5.865, OX = 0.25, OY = 0.25, GI_W = 240, GI_H = 131, P = new Pix(GI_W, GI_H);
  for (let j = 0; j < GI_H; j++) for (let i = 0; i < GI_W; i++) {
    const cx = Math.round(OX + (i + 0.5) * BLK), cy = Math.round(OY + (j + 0.5) * BLK);
    let r = 0, gg = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = ((cy + dy) * img.w + cx + dx) * 4; r += img.d[k]; gg += img.d[k + 1]; b += img.d[k + 2]; n++; }
    r /= n; gg /= n; b /= n;
    if (r > 170 && b > 170 && gg < 130 && r - gg > 80 && b - gg > 80) continue;
    P.set(i, j, [r, gg, b]);
  }
  fringe(P);
  return P;
}

// ---- constants decided in #81 / #78 ----
const DESK_TOP = 272, DESK_LIP = 8, DESK_Y_TOP = 170;   // image row the desk box starts at; back-lip rows left out; scene row of the cream top
const PROP_DEFS = {
  laptop: { box: [9, 23, 96, 77], s: 0.5, side: 0 }, mug: { box: [103, 47, 133, 76], s: 0.7, side: 1 }, notebook: { box: [181, 92, 220, 117], s: 0.7, side: 1 },
  papers: { box: [184, 42, 231, 76], s: 0.7, side: 1 }, glass: { box: [141, 40, 160, 76], s: 0.7, side: 1 }, bottle: { box: [161, 36, 177, 76], s: 0.7, side: 1 }, headphones: { box: [124, 90, 168, 119], s: 0.6, side: 1 },
};

const [bgImg, deskImg, propImg] = await Promise.all([read('site/public/spike/studio-pixel.jpg'), read('site/public/spike/desk-pixel-v3.jpg'), read('site/public/spike/props/sheet.jpg')]);

const backdrop = backdropFromGrid(bgImg);
await png(backdrop, path.join(OUT, 'backdrop.png'));

// On This Day's two scenes (#88): art/Museum, each a 240-block pixel picture (block 5.733 and 4.267 source px: width / 240), phases found by the edge energy at block boundaries.
const MUSEUM = {
  front: { src: 'art/Museum/Gemini_Generated_Image_n2i954n2i954n2i9.jpg', file: 'museum-front.png', block: 1376 / 240, ox: 4.75, oy: 4.75 },
  inside: { src: 'art/Museum/ff3cb19b-dcff-4933-bbb2-ddc15d6e4b10.jpg', file: 'museum.png', block: 1024 / 240, ox: 3.25, oy: 1.25 },
};
for (const m of Object.values(MUSEUM)) await png(sceneFromGrid(await read(m.src), m.block, m.ox, m.oy), path.join(OUT, m.file));

const desk = await deskFromGrid(deskImg, 'site/public/badges/heart-of-midlothian.png', DESK_TOP, DESK_LIP);
await png(desk, path.join(OUT, 'desk.png'));
const deskX = GW / 2 - Math.round(desk.w / 2), deskY = DESK_Y_TOP - DESK_LIP;   // as the spike draws it: 240 - round(width / 2), 170 - lip

// props: cut by box, shelf-packed (tallest first) into one sheet
const PG = toGrid(propImg), cuts = Object.entries(PROP_DEFS).map(([name, d]) => ({ name, ...d, w: d.box[2] - d.box[0] + 1, h: d.box[3] - d.box[1] + 1 })).sort((a, b) => b.h - a.h);
const SHEET_W = 256; let px = 0, py = 0, row = 0;
for (const c of cuts) { if (px + c.w > SHEET_W) { px = 0; py += row; row = 0; } c.sx = px; c.sy = py; px += c.w; row = Math.max(row, c.h); }
const sheet = new Pix(SHEET_W, py + row);
for (const c of cuts) for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const sx = c.box[0] + x, sy = c.box[1] + y; if (PG.has(sx, sy)) sheet.set(c.sx + x, c.sy + y, PG.get(sx, sy)); }
await png(sheet, path.join(OUT, 'props.png'));
const props = Object.fromEntries(Object.keys(PROP_DEFS).map(n => { const c = cuts.find(k => k.name === n); return [n, { sheet: [c.sx, c.sy, c.w, c.h], s: c.s, side: c.side }]; }));

const set = {
  w: GW, h: GH,
  backdrop: { file: 'backdrop.png', x: 0, y: 0 },
  desk: { file: 'desk.png', x: deskX, y: deskY, w: desk.w, h: desk.h, lip: DESK_LIP, top: DESK_Y_TOP, note: 'drawn over the seated figures; rows above `top` are transparent (the back lip is left out)' },
  props: { file: 'props.png', base: 189, slotSide: 14, tightScale: 1 / 0.7, laptopTight: 1.15, laptopLift: 2, default: { isla: 'none', fraser: 'none' }, items: props, note: 'drawn at sheet size * s, bottom on `base`, centred on the seat x moved `side * slotSide` towards the middle; smoothed scaling' },
  seated: {
    hcut: 112, propx: 0,
    note: 'figure origin: x = seat x - 120, y = desk.top - hcut (the sprite row hcut meets the desk back edge); sprites are 1:1',
    seats: { wide: { isla: 168, fraser: 312 }, tight: { isla: 222, fraser: 258 }, alone: 240 },
    presenters: { isla: 'presenters/isla-seated', fraser: 'presenters/fraser-seated' },
  },
  stack: 48,
  museum: {
    front: MUSEUM.front.file, inside: MUSEUM.inside.file,
    note: 'On This Day (#88): the front for the first line, the gallery for the rest; standing presenters at 1:1, feet at `feet` (the art row of the last sheet row), centred on `x`',
    outside: { x: 62, feet: 262 }, gallery: { x: 415, feet: 270 },
    glance: { every: 5, for: 1.6 },
    presenters: { fraser: 'presenters/fraser' },
  },
  camera: { wide: { z: 1, x: 240, y: 135, sy: 135 }, tight: { z: 1.8, x: 'seat', y: 55, sy: 78 } },
};
fs.writeFileSync(path.join(OUT, 'set.json'), JSON.stringify(set, null, 1) + '\n');
for (const f of ['backdrop.png', 'desk.png', 'props.png', 'museum-front.png', 'museum.png', 'set.json']) console.log(f, fs.statSync(path.join(OUT, f)).size, 'bytes');
console.log('desk', desk.w + 'x' + desk.h, 'at', deskX + ',' + deskY, '| props sheet', sheet.w + 'x' + sheet.h);
