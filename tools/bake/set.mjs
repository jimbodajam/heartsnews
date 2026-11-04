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

/** Desk: keyed, the medallion left blank (the club crest goes over it as a vector, see CREST). `skip` rows at the top are left out (the dark back lip of the v3 desk). */
function deskFromGrid(img, top, skip) {
  const BX = 3.482, BY = 3.582, PX0 = 100, PY0 = top, W = img.w;
  const cols = Math.floor((1274 - PX0) / BX), rows = Math.floor((712 - PY0) / BY), P = new Pix(cols, rows);
  for (let j = skip; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = (Math.round(PY0 + (j + 0.5) * BY) * W + Math.round(PX0 + (i + 0.5) * BX)) * 4, r = img.d[k], g = img.d[k + 1], b = img.d[k + 2];
    if (r > 150 && b > 150 && g < 120 && r - g > 70 && b - g > 70) continue;
    P.set(i, j, [r, g, b]);
  }
  fringe(P);
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

// On This Day's two scenes (#88): art/Museum, regenerated from the photos in art/Museum/photos. Mostly a 240-block grid (5.733 source px) with
// finer detail (the sign, panel headings) drawn in between, so they are sampled at 480 (2.867 px, half a block): the 240 blocks stay exact
// 2x2 and the finer parts keep their detail. Phases from the edge energy at the 240-block boundaries.
const MUSEUM = {
  front: { src: 'art/Museum/front-hd.jpg', file: 'museum-front.png', block: 1376 / 480, ox: 0, oy: 2.75 },
  inside: { src: 'art/Museum/gallery-hd.jpg', file: 'museum.png', block: 1376 / 480, ox: 0, oy: 2.75 },
};
for (const m of Object.values(MUSEUM)) await png(sceneFromGrid(await read(m.src), m.block, m.ox, m.oy), path.join(OUT, m.file));

// The Match Centre touchscreen (#92): art/scenes/touchscreen.jpg has its screen as one flat magenta rectangle. It is found in the baked
// picture (pure magenta only: the dimmer purple in the floor's reflection is left as the glow), filled with a dark panel, and its box
// written to set.json so the site can lay the line's graphic over it.
const TOUCH_SRC = 'art/scenes/touchscreen.jpg', TOUCH_PANEL = [10, 12, 24];
const touch = sceneFromGrid(await read(TOUCH_SRC), 1376 / 480, 0, 2.75);
const isKey = (x, y) => { const [r, g, b] = touch.get(x, y); return r > 150 && b > 150 && g < 110 && r - g > 70 && b - g > 70; };
let tx0 = GW, tx1 = -1, ty0 = GH, ty1 = -1;
for (let y = 0; y < 200; y++) for (let x = 0; x < GW; x++) if (isKey(x, y)) { tx0 = Math.min(tx0, x); tx1 = Math.max(tx1, x); ty0 = Math.min(ty0, y); ty1 = Math.max(ty1, y); }
for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) touch.set(x, y, TOUCH_PANEL);
await png(touch, path.join(OUT, 'touchscreen.png'));
const TOUCH_SCREEN = { x: tx0, y: ty0, w: tx1 - tx0 + 1, h: ty1 - ty0 + 1 };

// The Transfer Centre (#92): art/scenes/transfer.jpg has a magenta screen (right) and a magenta clock face (left of it); both are found
// in the baked picture. The screen becomes a dark panel; the face becomes a cream disc with 12 tick marks (the hands are drawn live by
// the site). The podium is its own sprite (art/scenes/transfer-podium.jpg on magenta), keyed, cropped and scaled down by PODIUM_SCALE
// (it was generated bigger than it needs to be) so Ross stands behind it; its bottom row sits on the floor.
const TRANSFER_SRC = 'art/scenes/transfer.jpg', PODIUM_SRC = 'art/scenes/transfer-podium.jpg', PODIUM_SCALE = 0.6;
const tr = sceneFromGrid(await read(TRANSFER_SRC), 1376 / 480, 0, 2.75);
const keyed = (P, x, y) => { const [r, g, b] = P.get(x, y); return r > 150 && b > 150 && g < 110 && r - g > 70 && b - g > 70; };
const box = (test) => { const b = { x0: GW, x1: -1, y0: GH, y1: -1 }; for (let y = 0; y < 200; y++) for (let x = 0; x < GW; x++) if (test(x, y)) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); } return b; };
const sb = box((x, y) => x >= 240 && keyed(tr, x, y)), cb = box((x, y) => x < 240 && keyed(tr, x, y));
for (let y = sb.y0; y <= sb.y1; y++) for (let x = sb.x0; x <= sb.x1; x++) tr.set(x, y, TOUCH_PANEL);
const CLOCK = { x: Math.round((cb.x0 + cb.x1) / 2), y: Math.round((cb.y0 + cb.y1) / 2), r: Math.round((cb.x1 - cb.x0 + 1) / 2) };
for (let y = cb.y0; y <= cb.y1; y++) for (let x = cb.x0; x <= cb.x1; x++) if (keyed(tr, x, y)) tr.set(x, y, [242, 239, 230]);
for (let h = 0; h < 12; h++) { const a = (h / 12) * Math.PI * 2, d = CLOCK.r - 4; tr.set(CLOCK.x + Math.sin(a) * d, CLOCK.y - Math.cos(a) * d, [29, 26, 34]); }
await png(tr, path.join(OUT, 'transfer.png'));
const TRANSFER_SCREEN = { x: sb.x0, y: sb.y0, w: sb.x1 - sb.x0 + 1, h: sb.y1 - sb.y0 + 1 };

const podSrc = await read(PODIUM_SRC);
let pb = { x0: podSrc.w, x1: -1, y0: podSrc.h, y1: -1 };
const podKey = (i) => { const r = podSrc.d[i], g = podSrc.d[i + 1], b = podSrc.d[i + 2]; return r > 150 && b > 150 && g < 130 && r - g > 60 && b - g > 60; };
for (let y = 0; y < podSrc.h; y++) for (let x = 0; x < podSrc.w; x++) if (!podKey((y * podSrc.w + x) * 4)) { pb.x0 = Math.min(pb.x0, x); pb.x1 = Math.max(pb.x1, x); pb.y0 = Math.min(pb.y0, y); pb.y1 = Math.max(pb.y1, y); }
const pcw = pb.x1 - pb.x0 + 1, pch = pb.y1 - pb.y0 + 1, pcrop = Buffer.alloc(pcw * pch * 4);
for (let y = 0; y < pch; y++) for (let x = 0; x < pcw; x++) { const i = ((pb.y0 + y) * podSrc.w + pb.x0 + x) * 4, o = (y * pcw + x) * 4; pcrop[o] = podSrc.d[i]; pcrop[o + 1] = podSrc.d[i + 1]; pcrop[o + 2] = podSrc.d[i + 2]; pcrop[o + 3] = podKey(i) ? 0 : 255; }
const PW = Math.round((pcw / (1376 / 480)) * PODIUM_SCALE), PH = Math.round((pch / (1376 / 480)) * PODIUM_SCALE);
const small = await sharp(pcrop, { raw: { width: pcw, height: pch, channels: 4 } }).resize(PW, PH, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer();
const podium = new Pix(PW, PH);
for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { const k = (y * PW + x) * 4; if (small[k + 3] > 140) podium.set(x, y, [0, 1, 2].map((c) => Math.min(255, Math.round(small[k + c] / 8) * 8))); }
fringe(podium);
await png(podium, path.join(OUT, 'transfer-podium.png'));

// The videowall (#92): art/scenes/videowall.jpg, its screen one big magenta rectangle (it runs lower than the others, so the search goes
// further down the picture; the floor glow is maroon and the reflection dimmer, neither is keyed).
const wall = sceneFromGrid(await read('art/scenes/videowall.jpg'), 1376 / 480, 0, 2.75);
let wx0 = GW, wx1 = -1, wy0 = GH, wy1 = -1;
for (let y = 0; y < 235; y++) for (let x = 0; x < GW; x++) if (keyed(wall, x, y)) { wx0 = Math.min(wx0, x); wx1 = Math.max(wx1, x); wy0 = Math.min(wy0, y); wy1 = Math.max(wy1, y); }
for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) wall.set(x, y, TOUCH_PANEL);
// A purple fringe of the key can sit just outside the rectangle (2 pixels at most): those pixels join the panel.
for (let y = wy0 - 2; y <= wy1 + 2; y++) for (let x = wx0 - 2; x <= wx1 + 2; x++) {
  if (x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1) continue;
  const [r, g, b] = wall.get(x, y);
  if (b - g > 35 && r - g > 25) wall.set(x, y, TOUCH_PANEL);
}
await png(wall, path.join(OUT, 'videowall.png'));
const WALL_SCREEN = { x: wx0, y: wy0, w: wx1 - wx0 + 1, h: wy1 - wy0 + 1 };

const desk = deskFromGrid(deskImg, DESK_TOP, DESK_LIP);
await png(desk, path.join(OUT, 'desk.png'));
const deskX = GW / 2 - Math.round(desk.w / 2), deskY = DESK_Y_TOP - DESK_LIP;   // as the spike draws it: 240 - round(width / 2), 170 - lip

// The club crest: a vector, drawn over the medallion by the page at the screen's own resolution. Baked as pixels at 36
// canvas px it was too rough. The medallion's centre is at canvas (240, 245); CREST_D fits inside its navy disc.
const CREST_D = 36, crestCy = deskY + Math.round((568 - DESK_TOP) / 3.582);
fs.copyFileSync('art/badges/heart-of-midlothian.svg', path.join(OUT, 'crest.svg'));
const crest = { file: 'crest.svg', x: GW / 2 - CREST_D / 2, y: crestCy - CREST_D / 2, w: CREST_D, h: CREST_D };

// props: cut by box, shelf-packed (tallest first) into one sheet
const PG = toGrid(propImg), cuts = Object.entries(PROP_DEFS).map(([name, d]) => ({ name, ...d, w: d.box[2] - d.box[0] + 1, h: d.box[3] - d.box[1] + 1 })).sort((a, b) => b.h - a.h);
const SHEET_W = 256; let px = 0, py = 0, row = 0;
for (const c of cuts) { if (px + c.w > SHEET_W) { px = 0; py += row; row = 0; } c.sx = px; c.sy = py; px += c.w; row = Math.max(row, c.h); }
const sheet = new Pix(SHEET_W, py + row);
for (const c of cuts) for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const sx = c.box[0] + x, sy = c.box[1] + y; if (PG.has(sx, sy)) sheet.set(c.sx + x, c.sy + y, PG.get(sx, sy)); }
await png(sheet, path.join(OUT, 'props.png'));
const props = Object.fromEntries(Object.keys(PROP_DEFS).map(n => { const c = cuts.find(k => k.name === n); return [n, { sheet: [c.sx, c.sy, c.w, c.h], s: c.s, side: c.side }]; }));

// Every presenter has a standing sheet: any of them can present at a standing scene (flipped when their sheet points away from the screen, see `points`).
const STANDING = Object.fromEntries(['isla', 'fraser', 'ross', 'kirsty', 'gregor'].map((id) => [id, 'presenters/' + id]));

const set = {
  w: GW, h: GH,
  backdrop: { file: 'backdrop.png', x: 0, y: 0 },
  desk: { file: 'desk.png', x: deskX, y: deskY, w: desk.w, h: desk.h, lip: DESK_LIP, top: DESK_Y_TOP, note: 'drawn over the seated figures; rows above `top` are transparent (the back lip is left out)' },
  crest: { ...crest, note: 'the club crest (SVG) drawn over the desk medallion, on the same camera transform as the desk' },
  props: { file: 'props.png', base: 189, slotSide: 14, tightScale: 1 / 0.7, laptopTight: 1.15, laptopLift: 2, default: { isla: 'none', fraser: 'none', ross: 'none', kirsty: 'none' }, items: props, note: 'drawn at sheet size * s, bottom on `base`, centred on the seat x moved `side * slotSide` towards the middle; smoothed scaling' },
  seated: {
    hcut: 112, propx: 0,
    note: 'figure origin: x = seat x - 120, y = desk.top - hcut (the sprite row hcut meets the desk back edge); sprites are 1:1',
    // Ross and Kirsty have no seat of their own: they take whichever side his partner leaves free (seatFor in site/src/hd/desk.ts, #89)
    seats: { wide: { isla: 168, fraser: 312 }, tight: { isla: 222, fraser: 258 }, alone: 240 },
    presenters: { isla: 'presenters/isla-seated', fraser: 'presenters/fraser-seated', ross: 'presenters/ross-seated', kirsty: 'presenters/kirsty-seated' },
  },
  stack: 48,
  museum: {
    front: MUSEUM.front.file, inside: MUSEUM.inside.file,
    note: 'On This Day (#88): the front for the first line, the gallery for the rest; standing presenters at 1:1, feet at `feet` (the art row of the last sheet row), centred on `x`',
    outside: { x: 62, feet: 262 }, gallery: { x: 415, feet: 270 },
    glance: { every: 5, for: 1.6 },
    presenters: STANDING,
  },
  points: { kirsty: 'left', fraser: 'left', ross: 'right', isla: 'right', gregor: 'right' },
  touchscreen: {
    file: 'touchscreen.png', screen: TOUCH_SCREEN,
    note: 'Match Centre (#92): the screen box is a dark panel the line\'s graphic goes over; the standing presenter is centred on `x` with the sheet\'s last row on `feet`',
    stand: { x: 325, feet: 262 }, screenSide: 'left',
    glance: { every: 5, for: 1.6 },
    presenters: STANDING,
  },
  transfer: {
    file: 'transfer.png', screen: TRANSFER_SCREEN, clock: CLOCK,
    note: 'Transfer Centre (#92): as touchscreen, plus the wall clock (hands drawn live) and the podium sprite drawn over the presenter, its last row on `feet`, centred on `x`; `label` is the panel (podium pixels) the title is drawn on',
    stand: { x: 142, feet: 262 }, screenSide: 'right',
    podium: { file: 'transfer-podium.png', x: 142, feet: 226, w: PW, h: PH, label: { cx: Math.round(PW / 2), cy: Math.round(PH * 0.47) } },
    glance: { every: 5, for: 1.6 },
    presenters: STANDING,
  },
  videowall: {
    file: 'videowall.png', screen: WALL_SCREEN,
    note: 'Team news (#92): the wall on the left, a standing presenter on the right (flipped if their sheet points the other way); the card is the line card, else the last card of the segment (as SD)',
    stand: { x: 360, feet: 262 }, screenSide: 'left',
    glance: { every: 5, for: 1.6 },
    presenters: STANDING,
  },
  camera: { wide: { z: 1, x: 240, y: 135, sy: 135 }, tight: { z: 1.8, x: 'seat', y: 55, sy: 78 } },
};
fs.writeFileSync(path.join(OUT, 'set.json'), JSON.stringify(set, null, 1) + '\n');
for (const f of ['backdrop.png', 'desk.png', 'props.png', 'museum-front.png', 'museum.png', 'touchscreen.png', 'transfer.png', 'transfer-podium.png', 'videowall.png', 'set.json']) console.log(f, fs.statSync(path.join(OUT, f)).size, 'bytes');
console.log('touchscreen screen', JSON.stringify(TOUCH_SCREEN));
console.log('transfer screen', JSON.stringify(TRANSFER_SCREEN), 'clock', JSON.stringify(CLOCK), 'podium', PW + 'x' + PH);
console.log('videowall screen', JSON.stringify(WALL_SCREEN));
console.log('desk', desk.w + 'x' + desk.h, 'at', deskX + ',' + deskY, '| props sheet', sheet.w + 'x' + sheet.h);
