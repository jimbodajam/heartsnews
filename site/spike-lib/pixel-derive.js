// Derive eye/brow poses from a single gridded presenter master, no generator needed.
// Input: a Pix (true-pixel grid from toGrid) plus a rough window around the eyes. Everything else is detected.

export class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  idx(x, y) { return (y * this.w + x) * 4; }
  has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[this.idx(x, y) + 3] > 0; }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = this.idx(x, y); this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255; }
  get(x, y) { const i = this.idx(x, y); return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
  clone() { const o = new Pix(this.w, this.h); o.d.set(this.d); return o; }
  canvas() { const c = document.createElement('canvas'); c.width = this.w; c.height = this.h; c.getContext('2d').putImageData(new ImageData(this.d.slice(), this.w, this.h), 0, 0); return c; }
}

/** Sample a generated image on its block grid (block centres) and key the magenta out. */
export function toGrid(img, { blk = 5.865, ox = 0.25, oy = 0.25, w = 240, h = 131 } = {}) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, P = new Pix(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const cx = Math.round(ox + (i + 0.5) * blk), cy = Math.round(oy + (j + 0.5) * blk);
    let r = 0, gg = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = ((cy + dy) * c.width + cx + dx) * 4; r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; }
    r /= n; gg /= n; b /= n;
    if (r > 170 && b > 170 && gg < 130 && r - gg > 80 && b - gg > 80) continue;
    P.set(i, j, [r, gg, b]);
  }
  const kill = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (P.has(x, y)) {
    const [r, g2, b] = P.get(x, y);
    if (r > 150 && b > 120 && b - g2 > 40 && r - g2 > 40 && (!P.has(x - 1, y) || !P.has(x + 1, y) || !P.has(x, y - 1) || !P.has(x, y + 1))) kill.push([x, y]);
  }
  for (const [x, y] of kill) P.d[P.idx(x, y) + 3] = 0;
  return P;
}

const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const sat = c => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };
const isBright = c => lum(c) > 188 && sat(c) < 0.2;   // eye white, including the slightly shaded top row
const skinLike = c => c[0] > c[1] + 8 && c[1] >= c[2] - 6;
const key = (x, y) => x + ',' + y;
const median = arr => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Find both eyes inside a rough window [x0,y0,x1,y1] and work out what is sclera, iris/pupil/highlight and lid. */
export function detectEyes(P, win) {
  const [wx0, wy0, wx1, wy1] = win, bright = new Set();
  for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) if (P.has(x, y) && isBright(P.get(x, y))) bright.add(key(x, y));
  // Cluster bright pixels (radius 3 so the iris does not split an eye in two).
  const seen = new Set(), clusters = [];
  for (const k of bright) {
    if (seen.has(k)) continue;
    const q = [k], pts = []; seen.add(k);
    while (q.length) {
      const [x, y] = q.pop().split(',').map(Number); pts.push([x, y]);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const nk = key(x + dx, y + dy); if (bright.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); } }
    }
    clusters.push(pts);
  }
  clusters.sort((a, b) => b.length - a.length);
  const two = clusters.slice(0, 2).sort((a, b) => a[0][0] - b[0][0] + (Math.min(...a.map(p => p[0])) - Math.min(...b.map(p => p[0]))) * 0);
  two.sort((a, b) => Math.min(...a.map(p => p[0])) - Math.min(...b.map(p => p[0])));
  return two.map(pts => analyseEye(P, pts));
}

function analyseEye(P, brightPts) {
  const xs = brightPts.map(p => p[0]), ys = brightPts.map(p => p[1]);
  const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1 };
  const brightSet = new Set(brightPts.map(p => key(p[0], p[1])));
  const inBox = (x, y) => x >= bb.x0 - 1 && x <= bb.x1 + 1 && y >= bb.y0 && y <= bb.y1;
  // Iris: non-bright, non-skin, not dark, inside the eye box.
  const iris = new Set();
  for (let y = bb.y0; y <= bb.y1; y++) for (let x = bb.x0 - 1; x <= bb.x1 + 1; x++) if (P.has(x, y) && !brightSet.has(key(x, y))) { const c = P.get(x, y); if (c[1] > c[0] - 6 && lum(c) >= 55) iris.add(key(x, y)); }   // green / blue-grey only: purple lid shadow and pink skin are not iris
  const nb4 = (x, y, set) => [[1, 0], [-1, 0], [0, 1], [0, -1]].reduce((n, [dx, dy]) => n + (set.has(key(x + dx, y + dy)) ? 1 : 0), 0);
  // Pupil: dark pixels with at least two neighbours inside the iris/sclera (lids sit on the edge and fail this).
  const pupil = new Set(), eyeish = new Set([...iris, ...brightSet]);
  for (let pass = 0; pass < 3; pass++) for (let y = bb.y0; y <= bb.y1; y++) for (let x = bb.x0 - 1; x <= bb.x1 + 1; x++) {
    const k = key(x, y); if (!P.has(x, y) || iris.has(k) || brightSet.has(k) || pupil.has(k)) continue;
    if (lum(P.get(x, y)) < 70 && nb4(x, y, eyeish) >= 2 && nb4(x, y, new Set([...iris, ...pupil])) >= 1) { pupil.add(k); eyeish.add(k); }
  }
  // Highlight: bright pixels surrounded by iris/pupil. They travel with the iris.
  const moving = new Set([...iris, ...pupil]), highlight = new Set();
  const nb8 = (x, y, set) => { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && set.has(key(x + dx, y + dy))) n++; return n; };
  const mv = [...moving].map(k => k.split(',').map(Number)), ix0 = Math.min(...mv.map(p => p[0])), ix1 = Math.max(...mv.map(p => p[0])), iy0 = Math.min(...mv.map(p => p[1])), iy1 = Math.max(...mv.map(p => p[1]));
  for (const k of brightSet) { const [x, y] = k.split(',').map(Number); if (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1 && nb8(x, y, moving) >= 2) highlight.add(k); }
  for (const k of highlight) moving.add(k);
  const sclera = [...brightSet].filter(k => !highlight.has(k)).map(k => k.split(',').map(Number));
  const scleraCol = (() => { const cols = sclera.map(([x, y]) => P.get(x, y)); return [median(cols.map(c => c[0])), median(cols.map(c => c[1])), median(cols.map(c => c[2]))].map(Math.round); })();
  // Aperture extent per row (sclera + everything that moves).
  const range = {};
  for (const [x, y] of sclera) { const r = range[y] || (range[y] = [x, x]); r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); }
  for (const k of moving) { const [x, y] = k.split(',').map(Number); const r = range[y] || (range[y] = [x, x]); r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); }
  const rows = Object.keys(range).map(Number), top = Math.min(...rows), bottom = Math.max(...rows);
  const cx = Math.round((bb.x0 + bb.x1) / 2);
  const cheek = P.get(cx, Math.min(P.h - 1, bottom + 3));
  // Darkest pixel just above the aperture is the lash/lid colour.
  let lash = [24, 14, 22], best = 999;
  for (let x = bb.x0; x <= bb.x1; x++) for (let y = top - 2; y < top; y++) if (P.has(x, y)) { const l = lum(P.get(x, y)); if (l < best) { best = l; lash = P.get(x, y); } }
  return { bb, cx, moving, sclera, scleraCol, range, top, bottom, skin: cheek, lash };
}

/** Slide iris/pupil/highlight sideways inside the aperture; vacated pixels become sclera. */
export function gaze(P, eyes, dx) {
  const out = P.clone();
  for (const e of eyes) {
    // Vacated pixels take the colour of the nearest remaining sclera in the same row (keeps the lid-shadow tone), else the global sclera colour.
    const byRow = {};
    for (const [x, y] of e.sclera) (byRow[y] || (byRow[y] = [])).push(x);
    const fill = (x, y) => { for (const yy of [y, y - 1, y + 1]) { const xs = byRow[yy]; if (xs && xs.length) { let bx = xs[0]; for (const v of xs) if (Math.abs(v - x) < Math.abs(bx - x)) bx = v; return P.get(bx, yy); } } return e.scleraCol; };
    for (const k of e.moving) { const [x, y] = k.split(',').map(Number); out.set(x, y, fill(x, y)); }
    for (const k of e.moving) {
      const [x, y] = k.split(',').map(Number), nx = x + dx, r = e.range[y];
      if (!r || nx < r[0] || nx > r[1]) continue;           // clipped by the eye corner
      out.set(nx, y, P.get(x, y));
    }
  }
  return out;
}

/** Close the eyes: fill the aperture with skin and draw a lid line (bowed down in the middle). */
export function blink(P, eyes) {
  const out = P.clone();
  for (const e of eyes) {
    // Wipe the open eye: every dark or eyeball pixel in and around the aperture (lashes, lids, corners) becomes skin.
    const x0 = e.bb.x0 - 2, x1 = e.bb.x1 + 2;
    for (let y = e.top - 2; y <= e.bottom + 1; y++) for (let x = x0; x <= x1; x++) {
      if (!P.has(x, y)) continue;
      const r = e.range[y], inAp = r && x >= r[0] && x <= r[1];
      if (inAp || lum(P.get(x, y)) < 100) out.set(x, y, e.skin);
    }
    // Closed lid: a 2px curved line, lowest in the middle, one pixel thick at the corners.
    const yMid = Math.round((e.top + e.bottom) / 2), hw = (e.bb.x1 - e.bb.x0) / 2 + 1;
    for (let x = e.bb.x0 - 1; x <= e.bb.x1 + 1; x++) {
      const u = (x - e.cx) / hw, y = yMid + Math.round(1.1 * (1 - u * u)) - 1;
      out.set(x, y, e.lash); if (Math.abs(u) < 0.45) out.set(x, y + 1, e.lash);
    }
  }
  return out;
}

/** Lift the brows by dy rows (brow = dark-ish pixels in a band above each eye); vacated pixels take the forehead colour. */
export function brows(P, eyes, dy = 2) {
  const out = P.clone();
  for (const e of eyes) {
    const skinL = lum(e.skin), pts = [];
    for (let y = e.top - 9; y <= e.top - 3; y++) for (let x = e.bb.x0 - 1; x <= e.bb.x1 + 1; x++) if (P.has(x, y)) { const c = P.get(x, y); if (lum(c) < skinL * 0.72 && c[1] >= c[2] - 4 && !isBright(c)) pts.push([x, y]); }   // dark and brown/grey, not pink or purple dither
    if (!pts.length) continue;
    // Per column: the brow's top pixel; vacated pixels take the skin directly above it, then the brow slides up.
    const colTop = {}; for (const [x, y] of pts) colTop[x] = Math.min(colTop[x] ?? 99, y);
    for (const [x, y] of pts) out.set(x, y, P.get(x, Math.max(0, colTop[x] - 1)));
    for (const [x, y] of pts) out.set(x, y - dy, P.get(x, y));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Mouths: draw each viseme from the presenter's own colours and mouth width.
// ---------------------------------------------------------------------------------------------
const dist3 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Find the closed mouth inside a rough window [x0,y0,x1,y1]: its extent, centre line, and the lip colours. */
export function detectMouth(P, win) {
  const [wx0, wy0, wx1, wy1] = win, my = Math.round((wy0 + wy1) / 2);
  const refs = []; for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) if (P.has(x, y)) refs.push(P.get(x, y));   // median of the window ≈ skin (the mouth is a small part of it)
  const skin = [0, 1, 2].map(i => median(refs.map(c => c[i])));
  const skinL = lum(skin);
  const lipLike = (x, y) => { if (!P.has(x, y)) return false; const c = P.get(x, y); return dist3(c, skin) > 70 || lum(c) < skinL - 55; };
  // Largest connected lip-like component near the window centre.
  const seen = new Set(), comps = [];
  for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
    const k = key(x, y); if (seen.has(k) || !lipLike(x, y)) continue;
    const q = [k], pts = []; seen.add(k);
    while (q.length) { const [px, py] = q.pop().split(',').map(Number); pts.push([px, py]); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = px + dx, ny = py + dy, nk = key(nx, ny); if (nx >= wx0 && nx <= wx1 && ny >= wy0 && ny <= wy1 && !seen.has(nk) && lipLike(nx, ny)) { seen.add(nk); q.push(nk); } } }
    comps.push(pts);
  }
  comps.sort((a, b) => b.length - a.length);
  const pts = comps[0], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const cx = (bb.x0 + bb.x1) / 2, hw = (bb.x1 - bb.x0) / 2;
  // Centre line = the row with the most dark pixels.
  const darkPerRow = {}; for (const [x, y] of pts) if (lum(P.get(x, y)) < skinL * 0.62) darkPerRow[y] = (darkPerRow[y] || 0) + 1;
  const rowsD = Object.keys(darkPerRow).map(Number), yc = rowsD.length ? rowsD.sort((a, b) => darkPerRow[b] - darkPerRow[a])[0] : Math.round((bb.y0 + bb.y1) / 2);
  const above = pts.filter(p => p[1] < yc).map(p => P.get(p[0], p[1])), below = pts.filter(p => p[1] > yc).map(p => P.get(p[0], p[1]));
  const med3 = cols => cols.length ? [0, 1, 2].map(i => median(cols.map(c => c[i]))) : skin;
  const lineCols = pts.filter(p => p[1] === yc).map(p => P.get(p[0], p[1]));
  const lipU = med3(above), lipL = med3(below);
  const line = lineCols.length ? lineCols.reduce((a, c) => lum(c) < lum(a) ? c : a) : [60, 15, 24];
  const lipHi = below.length ? below.reduce((a, c) => lum(c) > lum(a) ? c : a) : lipL;
  return { bb, cx, hw, yc, skin, lipU, lipL, line, lipHi, comp: new Set(pts.map(p => key(p[0], p[1]))) };
}

/** Preset shapes, in units relative to the presenter's own closed-mouth half width. */
export const MOUTH_PRESETS = {
  smile:  { w: 1.0, open: 0, smile: 0.9 },
  closed: { w: 0.95, open: 0, smile: 0 },
  small:  { w: 0.9, open: 0.75 },
  wide:   { w: 1.1, open: 1.0, teeth: true, smile: 0.8 },
  ee:     { w: 1.2, open: 1.3, teeth: true, smile: 0.7 },
  O:      { w: 0.45, open: 1.9, round: true },
  A:      { w: 1.05, open: 1.7, teeth: true, tongue: true },
};

export function mouth(P, m, preset) {
  const out = P.clone(), s = typeof preset === 'string' ? MOUTH_PRESETS[preset] : preset;
  // Erase the old lips: each column above the centre line takes the skin above the mouth, below takes the skin beneath.
  for (let x = m.bb.x0 - 2; x <= m.bb.x1 + 2; x++) {
    const above = P.get(x, m.bb.y0 - 2), below = P.get(x, Math.min(P.h - 1, m.bb.y1 + 2));
    for (let y = m.bb.y0 - 1; y <= m.bb.y1 + 1; y++) if (P.has(x, y) && (m.comp.has(key(x, y)) || y === m.bb.y0 - 1 || y === m.bb.y1 + 1)) out.set(x, y, y <= m.yc ? above : below);
  }
  const hw = Math.max(2, Math.round(m.hw * (s.w ?? 1))), open = s.open ?? 0, smile = s.smile ?? 0;
  const inside = [58, 15, 24], teethC = [246, 240, 232], tongueC = [196, 84, 98];
  for (let dx = -hw; dx <= hw; dx++) {
    const t = dx / hw, x = Math.round(m.cx + dx), yc = m.yc - smile * t * t * 1.4;
    const up = s.round ? open * Math.sqrt(Math.max(0, 1 - t * t)) : open * (1 - t * t);
    const yT = Math.round(yc - up), yB = Math.round(yc + up);
    const rim = mix(m.line, m.lipU, 0.35), edge = Math.abs(t) > 0.78;     // warm dark red rim, not black
    const isOpen = open > 0.4, yU = isOpen ? yT - 1 : Math.round(yc), yL = isOpen ? yB + 1 : Math.round(yc);
    if (isOpen) for (let y = yT; y <= yB; y++) out.set(x, y, s.tongue && y >= yB - 1 && open > 2 ? tongueC : s.teeth && y <= yT + 1 ? teethC : inside);
    out.set(x, yU, rim); if (isOpen) out.set(x, yL, rim);
    // Lips: two rows thick in the middle, one at the corners; highlight on the lower lip.
    const th = isOpen || edge ? 1 : 2;   // thin lips around an opening, fuller when closed
    for (let k = 1; k <= th; k++) { out.set(x, yU - k, m.lipU); out.set(x, yL + k, k === 1 && Math.abs(dx) <= 2 && !edge && !isOpen ? m.lipHi : m.lipL); }
  }
  out.set(Math.round(m.cx - hw - 1), Math.round(m.yc - smile * 1.4), m.line); out.set(Math.round(m.cx + hw + 1), Math.round(m.yc - smile * 1.4), m.line);
  return out;
}
