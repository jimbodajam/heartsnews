// Bakes the standing presenters into one indexed sprite sheet each, plus JSON with cropped layers and fixed offsets (#69). The browser then does no keying, detection or colour matching.
// Run from the repo root: node tools/bake/bake.mjs [isla fraser] [--new-palette] [--colours n --out dir] [--boxes] [--export]
// Frame lists: art/presenters/<name>/frames.json. Locked palette: art/presenters/<name>/palette.json. Touch-ups: art/presenters/<name>/touchups/<frame>.png (see README.md here).
import fs from 'node:fs';
import sharp from 'sharp';
import { readRGBA, frameGrid, readTouchUp } from './grid.mjs';
import { buildPalette, snapper, snapPix, lab } from './palette.mjs';
import { pack, indexedPNG } from './sheet.mjs';
import { matchColour, buildFraser, composeFraser } from '../../site/spike-lib/fraser-frames.js';
import { buildIsla, composeIsla } from '../../site/spike-lib/isla-frames.js';

const RECIPES = { fraser: { build: buildFraser, compose: composeFraser }, isla: { build: buildIsla, compose: composeIsla } };
const argv = process.argv.slice(2), flag = n => { const i = argv.indexOf(n); return i < 0 ? null : argv.splice(i, 2)[1]; }, sw = n => { const i = argv.indexOf(n); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const COLOURS = +(flag('--colours') || 0), OUT = flag('--out') || 'site/public/presenters', NEW_PALETTE = sw('--new-palette'), BOXES = sw('--boxes'), EXPORT = sw('--export');
const NAMES = argv.length ? argv : Object.keys(RECIPES), PREVIEW = 'tools/bake/out/';

const l1 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const same = (A, B, x, y) => A.has(x, y) === B.has(x, y) && (!A.has(x, y) || l1(A.get(x, y), B.get(x, y)) === 0);
const key = (x, y) => x + ',' + y;

/** Connected groups (8-way) of cells that differ from `parent` by more than `thr`. */
function changedBlobs(P, parent, thr = 40) {
  const on = new Set(); for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if (P.has(x, y) !== parent.has(x, y) || (P.has(x, y) && l1(P.get(x, y), parent.get(x, y)) > thr)) on.add(key(x, y));
  const blobs = [];
  while (on.size) {
    const [s] = on; on.delete(s); const q = [s], cells = [];
    while (q.length) { const k = q.pop(), [x, y] = k.split(',').map(Number); cells.push([x, y]); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = key(x + dx, y + dy); if (on.delete(n)) q.push(n); } }
    blobs.push(cells);
  }
  return blobs;
}

/** Everything outside the frame's editable area goes back to its parent, so the generator's drift cannot flicker between frames. */
function clamp(P, parent, area, box, cfg) {
  const copy = (out, x, y) => { if (P.has(x, y)) out.set(x, y, P.get(x, y)); else out.d[out.idx(x, y) + 3] = 0; };
  if (area === 'arm') {
    // an arm is new pixels in solid groups; specks of drift stay on the parent
    const out = parent.clone(), keep = new Set();
    for (const b of changedBlobs(P, parent)) if (b.length >= 12) for (const [x, y] of b) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keep.add(key(x + dx, y + dy));
    for (const k of keep) { const [x, y] = k.split(',').map(Number); if (y >= cfg.headCut && x >= 0 && y < P.h && x < P.w) copy(out, x, y); }
    return out;
  }
  if (area === 'box') {
    const out = parent.clone();
    for (const [x0, y0, x1, y1] of box) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) copy(out, x, y);
    return out;
  }
  return P;
}

async function loadFrames(name, cfg) {
  const raw = {}, touched = new Set();
  await Promise.all(cfg.frames.map(async f => {
    const touch = `art/presenters/${name}/touchups/${f.name}.png`, file = cfg.src + (f.file || f.name + '.jpg');
    if (fs.existsSync(touch)) { raw[f.name] = await readTouchUp(touch, cfg.grid); touched.add(f.name); return; }
    if (!fs.existsSync(file)) { console.log(`  ${f.name}: no image yet, skipped`); return; }
    raw[f.name] = frameGrid(await readRGBA(file), cfg.grid, cfg.bg);
  }));
  // the generated mouth frames came back in slightly different skin tones: match each to its own head so switching mouths does not flicker the colour
  if (cfg.matchColour) for (const f of cfg.frames) if (f.area === 'mouth' || f.area === 'eyes') if (raw[f.name] && !touched.has(f.name) && raw[f.parent]) raw[f.name] = matchColour(raw[f.name], raw[f.parent]);
  return raw;
}

function boxReport(cfg, raw) {
  for (const h of new Set(cfg.frames.filter(f => f.area === 'mouth' || f.area === 'eyes').map(f => f.parent))) for (const area of ['eyes', 'mouth']) {
    const b = [999, 999, -1, -1], each = [];
    for (const f of cfg.frames) if (f.parent === h && f.area === area && raw[f.name]) {
      const cells = changedBlobs(raw[f.name], raw[h], 60).filter(x => x.length >= 3 && x.some(([, y]) => y < cfg.headCut)).flat();
      if (!cells.length) continue;
      const fb = [Math.min(...cells.map(c => c[0])), Math.min(...cells.map(c => c[1])), Math.max(...cells.map(c => c[0])), Math.max(...cells.map(c => c[1]))]; each.push(f.name + ' ' + fb);
      b[0] = Math.min(b[0], fb[0]); b[1] = Math.min(b[1], fb[1]); b[2] = Math.max(b[2], fb[2]); b[3] = Math.max(b[3], fb[3]);
    }
    console.log(h, area, 'union', b.join(','), '\n   ', each.join(' | '));
  }
}

/** A layer from the opaque cells of `P` in rows [y0, y1): cropped, as palette indices (0 is transparent). `over` limits it to cells that differ from a base. */
function layer(layerName, P, y0, y1, snap, over = null) {
  let x0 = P.w, x1 = -1, t0 = y1, t1 = -1;
  const on = (x, y) => P.has(x, y) && !(over && same(P, over, x, y));
  for (let y = y0; y < y1; y++) for (let x = 0; x < P.w; x++) if (on(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); t0 = Math.min(t0, y); t1 = Math.max(t1, y); }
  if (x1 < 0) return { none: true };
  const w = x1 - x0 + 1, h = t1 - t0 + 1, cells = new Uint8Array(w * h);
  for (let y = t0; y <= t1; y++) for (let x = x0; x <= x1; x++) if (!(over && same(P, over, x, y)) && P.has(x, y)) cells[(y - t0) * w + x - x0] = snap(P.get(x, y)) + 1;
  return { name: layerName, w, h, cells, dx: x0, dy: t0 };
}

/** The cells a change clears (empty in `P`, filled in `over`), as a layer the player cuts out before drawing the change itself. Any colour will do, so they all use index 1. */
function eraseLayer(layerName, P, y0, y1, over) {
  const pts = []; for (let y = y0; y < y1; y++) for (let x = 0; x < P.w; x++) if (!P.has(x, y) && over.has(x, y)) pts.push([x, y]);
  if (!pts.length) return { none: true };
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), t0 = Math.min(...pts.map(p => p[1])), t1 = Math.max(...pts.map(p => p[1])), w = x1 - x0 + 1, h = t1 - t0 + 1, cells = new Uint8Array(w * h);
  for (const [x, y] of pts) cells[(y - t0) * w + x - x0] = 1;
  return { name: layerName, w, h, cells, dx: x0, dy: t0 };
}

/** Stacks layers the way the browser player does. */
function stack(baked, palette, { head = 'b1', pose = 'b1', feet = 'b1', eye = 'open', mouth = 'rest' }) {
  const proto = baked.base, out = proto.clone(); out.d.fill(0);
  for (const n of [`feet/${feet}`, `body/${pose}`, `low/${pose}`, `head/${head}`, `eye/${head}/${eye}`, `mouth/${head}/${mouth}`]) {
    const cut = baked.byName['cut/' + n], l = baked.byName[n];
    if (cut) for (let j = 0; j < cut.h; j++) for (let i = 0; i < cut.w; i++) if (cut.cells[j * cut.w + i]) out.d[out.idx(cut.dx + i, cut.dy + j) + 3] = 0;
    if (l) for (let j = 0; j < l.h; j++) for (let i = 0; i < l.w; i++) { const v = l.cells[j * l.w + i]; if (v) out.set(l.dx + i, l.dy + j, palette[v - 1]); }
  }
  return out;
}

const labError = (A, B) => { let e = 0, n = 0; for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) if (A.has(x, y) && B.has(x, y)) { const a = lab(A.get(x, y).map(Math.round)), b = lab(B.get(x, y).map(Math.round)); e += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); n++; } return e / n; };

async function bake(name) {
  const cfg = JSON.parse(fs.readFileSync(`art/presenters/${name}/frames.json`, 'utf8')), recipe = RECIPES[name];
  console.log(`\n${name}: ${cfg.frames.length} frames listed`);
  const raw = await loadFrames(name, cfg);
  if (BOXES) { boxReport(cfg, raw); return; }

  const palFile = `art/presenters/${name}/palette.json`, locked = fs.existsSync(palFile) && !NEW_PALETTE && !COLOURS ? JSON.parse(fs.readFileSync(palFile, 'utf8')) : null;
  const palette = locked || buildPalette(cfg.frames.filter(f => raw[f.name]).map(f => clamp(raw[f.name], raw[f.parent] || raw[f.name], areaFor(f), boxFor(cfg, f), cfg)), COLOURS || 128);
  if (!locked && OUT === 'site/public/presenters') fs.writeFileSync(palFile, JSON.stringify(palette) + '\n');
  const snap = snapper(palette), G = {};
  for (const n of Object.keys(raw)) G[n] = snapPix(raw[n], palette, snap);
  // parents first: a frame's parent is clamped before the frame is compared with it
  for (const f of cfg.frames) if (G[f.name] && f.parent && G[f.parent]) G[f.name] = clamp(G[f.name], G[f.parent], areaFor(f), boxFor(cfg, f), cfg);

  if (EXPORT) {
    // the cleaned frames at grid size, ready to open in Aseprite and save as touch-ups
    fs.mkdirSync(`${PREVIEW}export/${name}`, { recursive: true });
    await Promise.all(Object.entries(G).map(([n, P]) => sharp(Buffer.from(P.d), { raw: { width: P.w, height: P.h, channels: 4 } }).png().toFile(`${PREVIEW}export/${name}/${n}.png`)));
  }
  const F = recipe.build(G, raw), compose = o => snapPix(recipe.compose(F, o), palette, snap);
  const base = compose({}), L = [], { headCut: CUT, feetTop: TOP } = cfg, H = cfg.grid.h;
  const add = l => { if (!l.none) L.push(l); };
  const change = (n, P, y0, y1, over) => { add(eraseLayer('cut/' + n, P, y0, y1, over)); add(layer(n, P, y0, y1, snap, over)); };
  for (const head of cfg.heads) {
    const h0 = compose({ head });
    add(layer(`head/${head}`, h0, 0, CUT, snap));
    for (const eye of cfg.eyes) change(`eye/${head}/${eye}`, compose({ head, eye }), 0, CUT, h0);
    for (const mouthKey of cfg.mouths) change(`mouth/${head}/${mouthKey}`, compose({ head, mouthKey }), 0, CUT, h0);
  }
  for (const pose of cfg.poses) {
    const p0 = compose({ pose });
    add(layer(`body/${pose}`, p0, CUT, TOP, snap));
    change(`low/${pose}`, p0, TOP, H, base);   // what a pose changes below the feet line (a hand on the skirt, or a hand lifted off it) stays over the feet frame
  }
  for (const feet of cfg.feet) add(layer(`feet/${feet}`, compose({ feet }), TOP, H, snap));

  const { pixels, width, height, place, unique } = pack(L);
  fs.mkdirSync(OUT, { recursive: true });
  const png = indexedPNG(pixels, width, height, palette), sheetFile = `${OUT}/${name}.png`, jsonFile = `${OUT}/${name}.json`;
  fs.writeFileSync(sheetFile, png);
  const json = JSON.stringify({ name, w: cfg.grid.w, h: cfg.grid.h, headCut: CUT, feetTop: TOP, heads: cfg.heads, poses: cfg.poses, feet: cfg.feet, eyes: cfg.eyes, mouths: cfg.mouths, layers: place });
  fs.writeFileSync(jsonFile, json);

  // checks: the stacked layers against the composed frame, and against the frame as it looked before baking
  const baked = { base, byName: Object.fromEntries(L.map(l => [l.name, l])) }, mism = {};
  let combos = 0, wrong = 0, worst = {};
  for (const head of cfg.heads) for (const pose of cfg.poses) for (const feet of cfg.feet) for (const eye of ['open', ...cfg.eyes]) for (const mouth of ['rest', ...cfg.mouths]) {
    if (!(pose === 'b1' || (eye === 'open' && mouth === 'rest'))) continue;
    const a = stack(baked, palette, { head, pose, feet, eye, mouth }), b = compose({ head, pose, feet, eye, mouthKey: mouth });
    let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < a.w; x++) if (!same(a, b, x, y)) n++;
    combos++; if (n) { wrong++; const k = eye !== 'open' && mouth !== 'rest' ? 'eye+mouth' : 'other'; mism[k] = (mism[k] || 0) + 1; if (n > (worst[k]?.[0] ?? 0)) worst[k] = [n, [head, pose, feet, eye, mouth].join(' ')]; }
  }
  const before = recipe.build(raw), samples = sampleCombos(cfg);
  const errs = samples.map(o => labError(recipe.compose(before, { ...o, mouthKey: o.mouth }), stack(baked, palette, o)));
  await previewSheet(name, recipe, before, baked, palette, samples, cfg);
  const stats = { layers: L.length, unique, sheet: `${width}x${height}`, pngKB: +(png.length / 1024).toFixed(1), jsonKB: +(json.length / 1024).toFixed(1), colours: palette.length, combos, combosDiffer: wrong, differBy: mism, worst, labErr: +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(4) };
  console.log(stats);
  return stats;
}

const areaFor = f => f.area === 'mouth' || f.area === 'eyes' ? 'box' : f.area;
const boxFor = (cfg, f) => areaFor(f) === 'box' ? cfg.boxes[f.parent][f.area] : null;

function sampleCombos(cfg) {
  const top = ['A', 'wide', 'O', 'smile'], s = [{}];
  cfg.heads.forEach((head, i) => { s.push({ head, mouth: top[i % top.length] }); s.push({ head, eye: 'blink' }); });
  cfg.poses.forEach((pose, i) => s.push({ pose, feet: cfg.feet[i % cfg.feet.length], head: cfg.heads[i % cfg.heads.length] }));
  return s;
}

/** Before on the top row, baked below, at 2x, for looking at by eye. */
async function previewSheet(name, recipe, before, baked, palette, samples, cfg) {
  const S = 2, W = cfg.grid.w, Hh = cfg.grid.h, cols = samples.length, buf = Buffer.alloc(cols * W * S * Hh * S * 2 * 4, 0);
  for (let i = 0; i < 4 * cols * W * S * Hh * S * 2; i += 4) { buf[i] = 40; buf[i + 1] = 46; buf[i + 2] = 80; buf[i + 3] = 255; }
  const put = (P, ox, oy) => { for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (P.has(x, y)) { const c = P.get(x, y).map(Math.round); for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { const k = ((oy + y * S + a) * cols * W * S + ox + x * S + b) * 4; buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; } } };
  samples.forEach((o, i) => { put(recipe.compose(before, { ...o, mouthKey: o.mouth }), i * W * S, 0); put(stack(baked, palette, o), i * W * S, Hh * S); });
  fs.mkdirSync(PREVIEW, { recursive: true });
  await sharp(buf, { raw: { width: cols * W * S, height: Hh * S * 2, channels: 4 } }).png().toFile(`${PREVIEW}${name}-before-after${COLOURS ? '-' + COLOURS : ''}.png`);
}

for (const n of NAMES) await bake(n);
