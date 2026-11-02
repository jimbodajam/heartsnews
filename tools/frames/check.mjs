// Checks on a generated standing frame against its parent (#72): did it change pixels outside its editable area, and did it go the way the prompt asked.
// Pure functions on the presenter grids from tools/bake/grid.mjs, so they can be tried without an image.

export const LIMITS = { thr: 60, group: 8, outside: 80 };

const l1 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Cells where `P` differs from `parent` by more than `thr`, or is filled where the parent is empty (or the other way round). */
export function changedCells(P, parent, thr = LIMITS.thr) {
  const out = [];
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if (P.has(x, y) !== parent.has(x, y) || (P.has(x, y) && l1(P.get(x, y), parent.get(x, y)) > thr)) out.push([x, y]);
  return out;
}

/** The face boxes a `patch` frame may change: the patch boxes, else the windows round the master's eyes and mouth. */
function patchBoxes(cfg) {
  const p = cfg.face?.patch?.boxes;
  if (p) return Object.values(p);
  const h = cfg.face?.heads?.[cfg.face?.patch?.base || 'b1'] || {};
  return [h.eyeWin, h.mouthWin].filter(Boolean);
}

/** Whether a cell is inside the area the frame is allowed to change (the same areas tools/bake/bake.mjs clamps to). */
export function inArea(cfg, frame) {
  const { headCut, feetTop } = cfg;
  const inBox = boxes => (x, y) => boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  switch (frame.area) {
    case 'head': return (x, y) => y < headCut;
    case 'legs': return (x, y) => y >= feetTop;
    case 'arm': return (x, y) => y >= headCut;
    case 'mouth': case 'eyes': return inBox(cfg.boxes?.[frame.parent]?.[frame.area] || [])
    case 'patch': { const b = patchBoxes(cfg); return b.length ? inBox(b) : () => true; }
    default: return () => true;
  }
}

/** One box per eye for the glance check: the patch eye boxes, else the master's eye window split down the middle. */
function eyeBoxes(cfg) {
  const p = cfg.face?.patch?.boxes;
  if (p?.EBL && p?.EBR) return [p.EBL, p.EBR];
  const [x0, y0, x1, y1] = cfg.face?.heads?.[cfg.face?.patch?.base || 'b1']?.eyeWin || [0, 0, cfg.grid.w, cfg.headCut], mid = Math.round((x0 + x1) / 2);
  return [[x0, y0, mid - 1, y1], [mid, y0, x1, y1]];
}

/** The cells that sit in solid groups (8-way) of at least `min`: generator drift is scattered specks, a redrawn arm or hem is a mass. */
export function solid(cells, min = LIMITS.group) {
  const on = new Set(cells.map(([x, y]) => x + ',' + y)), out = [];
  while (on.size) {
    const [s] = on; on.delete(s); const q = [s], group = [];
    while (q.length) {
      const [x, y] = q.pop().split(',').map(Number); group.push([x, y]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = (x + dx) + ',' + (y + dy); if (on.delete(k)) q.push(k); }
    }
    if (group.length >= min) out.push(...group);
  }
  return out;
}

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * Which way a frame moved things, in cells of the viewer's left (negative) or right (positive).
 * `changed`: new pixels (an arm) against the middle of the figure. `dark`: the dark pixels (pupils) in each eye against the parent's, read from the full-size images `imgs` ({ cand, parent } as raw RGBA).
 */
export function direction(P, parent, cfg, frame, expect, imgs = null) {
  if (expect.measure === 'dark') {
    // pupils are a cell or two wide on the grid, so this reads the full-size images: where the dark pixels sit in each eye, against the parent
    if (!imgs) return null;
    const k = cfg.grid.blk || 5.865, at = (im, [x0, y0, x1, y1]) => { let s = 0, n = 0; for (let y = Math.round((y0 - 1) * k); y <= Math.round((y1 + 1) * k); y++) for (let x = Math.round(x0 * k); x <= Math.round(x1 * k); x++) { const i = (y * im.w + x) * 4; if (lum(im.data.slice(i, i + 3), 0) < 60) { s += x; n++; } } return n ? s / n / k : null; };
    const shifts = (expect.region ? [expect.region] : eyeBoxes(cfg)).map(b => { const a = at(imgs.cand, b), c = at(imgs.parent, b); return a === null || c === null ? null : a - c; });
    return shifts.includes(null) ? null : mean(shifts);
  }
  const inside = inArea(cfg, frame), mid = (() => { const xs = []; for (let y = 0; y < parent.h; y++) for (let x = 0; x < parent.w; x++) if (parent.has(x, y)) xs.push(x); return mean(xs); })();
  const xs = changedCells(P, parent).filter(([x, y]) => inside(x, y) && P.has(x, y)).map(([x]) => x);
  return xs.length < 12 ? null : mean(xs) - mid;
}

/**
 * Checks one frame. Returns `{ ok, reasons, stats }`; every reason is a sentence that goes in the queue next to the rejected frame.
 * `expect` is `{ dir: 'left' | 'right', measure: 'changed' | 'dark', min?: cells, region?: box }` from prompts.json.
 */
export function checkFrame(P, parent, frame, cfg, expect = null, limits = LIMITS, imgs = null) {
  const inside = inArea(cfg, frame), changed = changedCells(P, parent, limits.thr), reasons = [];
  const outside = solid(changed.filter(([x, y]) => !inside(x, y)));
  const stats = { changed: changed.length, outside: outside.length };
  if (outside.length > limits.outside) {
    const ys = outside.map(c => c[1]), xs = outside.map(c => c[0]);
    reasons.push(`${outside.length} cells changed outside its area (${frame.area}), around x ${Math.min(...xs)}-${Math.max(...xs)}, y ${Math.min(...ys)}-${Math.max(...ys)}`);
  }
  if (changed.length - outside.length < 3) reasons.push('nothing changed inside its area');
  if (expect) {
    const d = direction(P, parent, cfg, frame, expect, imgs), min = expect.min ?? (expect.measure === 'dark' ? 0.3 : 4);
    stats.direction = d === null ? null : +d.toFixed(2);
    if (d === null) reasons.push(`could not measure the ${expect.dir} direction`);
    else if (Math.abs(d) < min) reasons.push(`moved ${d.toFixed(2)} cells, too little to tell it went ${expect.dir}`);
    else if ((d < 0) !== (expect.dir === 'left')) reasons.push(`went the wrong way: wanted the viewer's ${expect.dir}, moved ${d < 0 ? 'left' : 'right'} (${d.toFixed(2)} cells)`);
  }
  return { ok: !reasons.length, reasons, stats };
}
