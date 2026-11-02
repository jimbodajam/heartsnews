// Reading generated images on to the presenter grid (#69).
// Full frames use the fixed grid every cut row and face box was tuned on. Measured on the sets, they have no usable art grid of their own:
// the strongest period is 5.297 px, the same on both presenters with a steady phase, which is the generator's upscale rather than art cells.
// A head crop is registered against the master instead (`registerCrop`): scale and shift by image match, then read at the master's cells.
import sharp from 'sharp';
import { Pix, gridRGBA } from '../../site/spike-lib/pixel-derive.js';

export async function readRGBA(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** The background of a generated image, from its four corners (the generator does not return exactly the same background twice). */
export function cornerColour({ data, w, h }) {
  const pts = [[8, 8], [w - 9, 8], [8, h - 9], [w - 9, h - 9]], s = [0, 0, 0];
  for (const [x, y] of pts) for (let i = 0; i < 3; i++) s[i] += data[(y * w + x) * 4 + i] / pts.length;
  return s.map(Math.round);
}

export function frameGrid(img, grid, bgMode) {
  return gridRGBA(img.data, img.w, { ...grid, bg: bgMode === 'corner' ? cornerColour(img) : null });
}

/** A hand-edited touch-up: a PNG at grid size, one image pixel per cell, transparent where the frame is empty. */
export async function readTouchUp(file, { w, h }) {
  const img = await readRGBA(file);
  if (img.w !== w || img.h !== h) throw new Error(`${file} is ${img.w}x${img.h}, touch-ups are ${w}x${h}`);
  const P = new Pix(w, h); P.d.set(img.data);
  for (let i = 3; i < P.d.length; i += 4) P.d[i] = P.d[i] > 127 ? 255 : 0;
  return P;
}

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Luminance of the crop at a point in crop-image pixels, or -1 outside. */
const sampleLum = (img, x, y) => { const ix = Math.round(x), iy = Math.round(y); return ix < 0 || iy < 0 || ix >= img.w || iy >= img.h ? -1 : lum(img.data, (iy * img.w + ix) * 4); };

/**
 * Fit a generated crop to the master by image match: `box` is the crop in grid cells, `nominal` the crop-image pixels per cell it was asked for.
 * Searches scale and shift for each axis, scoring every cell of `box` that is opaque in the master and outside `skip` (the part meant to change).
 */
export function registerCrop(img, master, box, nominal, skip) {
  const [x0, y0, x1, y1] = box, cells = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (!master.has(x, y) || (x >= skip[0] && x < skip[2] && y >= skip[1] && y < skip[3])) continue; const c = master.get(x, y); cells.push([x - x0 + 0.5, y - y0 + 0.5, 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]]); }
  const score = (sx, sy, ox, oy) => { let e = 0, n = 0; for (const [cx, cy, l] of cells) { const v = sampleLum(img, ox + cx * sx, oy + cy * sy); if (v >= 0) { e += Math.abs(v - l); n++; } } return n > cells.length * 0.8 ? e / n : Infinity; };
  let best = { e: Infinity };
  const scan = (scales, shifts) => { for (const f of scales) for (const ox of shifts.x) for (const oy of shifts.y) { const sx = nominal[0] * f, sy = nominal[1] * f, e = score(sx, sy, ox, oy); if (e < best.e) best = { e, sx, sy, ox, oy }; } };
  const range = (c, r, step) => { const o = []; for (let v = c - r; v <= c + r + 1e-9; v += step) o.push(v); return o; };
  scan(range(1, 0.03, 0.005), { x: range(0, 18, 3), y: range(0, 18, 3) });
  const f0 = best.sx / nominal[0];
  scan(range(f0, 0.005, 0.001), { x: range(best.ox, 4, 1), y: range(best.oy, 4, 1) });
  return best;
}

/** Reads a registered crop at the master's cells: a Pix on the master grid, holding only `box`, with the crop's background left out. */
export function cropToGrid(img, fit, box, { w, h }, thr = 70) {
  // a crop's lower corners are jacket, so the background comes from the top two only
  const top = i => (img.data[(8 * img.w + 8) * 4 + i] + img.data[(8 * img.w + img.w - 9) * 4 + i]) / 2, bg = [top(0), top(1), top(2)];
  const P = new Pix(w, h), [x0, y0, x1, y1] = box, Rx = Math.max(1, Math.round(fit.sx / 6)), Ry = Math.max(1, Math.round(fit.sy / 6));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const cx = Math.round(fit.ox + (x - x0 + 0.5) * fit.sx), cy = Math.round(fit.oy + (y - y0 + 0.5) * fit.sy), c = [0, 0, 0]; let n = 0;
    for (let dy = -Ry; dy <= Ry; dy++) for (let dx = -Rx; dx <= Rx; dx++) { const px = cx + dx, py = cy + dy; if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue; const k = (py * img.w + px) * 4; for (let i = 0; i < 3; i++) c[i] += img.data[k + i]; n++; }
    if (!n) continue;
    const m = c.map(v => v / n);
    if (Math.hypot(m[0] - bg[0], m[1] - bg[1], m[2] - bg[2]) >= thr) P.set(x, y, m);   // wider than a full frame's key: the crop's soft edges bleed background into the outline
  }
  return P;
}

/** Per-channel gain and offset that bring the mean and spread of `P` (head region, face window left out) to those of `ref`, applied to every pixel of `P`. */
export function matchColour(P, ref) {
  const stat = Q => { const s = [0, 0, 0], s2 = [0, 0, 0]; let n = 0; for (let y = 2; y < 44; y++) for (let x = 40; x < 110; x++) { if (y >= 22 && x >= 72 && x <= 94) continue; if (!Q.has(x, y)) continue; const c = Q.get(x, y); for (let i = 0; i < 3; i++) { s[i] += c[i]; s2[i] += c[i] * c[i]; } n++; } const m = s.map(v => v / n); return { m, sd: s2.map((v, i) => Math.sqrt(Math.max(1, v / n - m[i] * m[i]))) }; };
  const a = stat(P), b = stat(ref), out = P.clone();
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if (P.has(x, y)) { const c = P.get(x, y); out.set(x, y, c.map((v, i) => Math.max(0, Math.min(255, Math.round(b.m[i] + (v - a.m[i]) * b.sd[i] / a.sd[i]))))); }
  return out;
}
