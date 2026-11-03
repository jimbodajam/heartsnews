// Suggests the face boxes for a set's straight-head mouth and blink frames (`patch` crops, v1-v9), which tools/bake/bake.mjs --boxes does not cover (#89).
// Run from the repo root, in WSL: node tools/frames/face-boxes.mjs <set>   (reads the staged crops in art/presenters/<set>/queue/staged/)
// Each crop is read over the whole head and compared with the master; the eye frames (v7, v9) give EBL/EBR and eyeWin, the mouths give MB and mouthWin.
// Copy the numbers into frames.json (`face.patch.boxes`, `face.heads.b1`) by hand, then `npm run frames -- recheck <set>`.
import fs from 'node:fs';
import path from 'node:path';
import { frameGrid, readRGBA } from '../bake/grid.mjs';
import { cropCells, readCrop } from '../bake/crop.mjs';
import { changedCells } from './check.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..'), name = process.argv[2];
const dir = path.join(ROOT, 'art/presenters', name), cfg0 = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
const [cx0, cy0, cx1] = cropCells(cfg0), head = [cx0 + 2, cy0 + 2, cx1 - 3, cfg0.headCut - 1];
const cfg = { ...cfg0, boxes: {}, face: { ...cfg0.face, patch: { ...cfg0.face.patch, boxes: undefined }, heads: { b1: { eyeWin: head } } } };
const master = frameGrid(await readRGBA(path.join(ROOT, cfg.src, 'b1.jpg')), cfg.grid, cfg.bg);
// groups of touching changed cells, the small ones (generator specks) dropped
function groups(cells, min = 3) {
  const on = new Set(cells.map(([x, y]) => x + ',' + y)), out = [];
  while (on.size) {
    const [s0] = on; on.delete(s0); const q = [s0], g = [];
    while (q.length) { const [x, y] = q.pop().split(',').map(Number); g.push([x, y]); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = (x + dx) + ',' + (y + dy); if (on.delete(k)) q.push(k); } }
    if (g.length >= min) out.push(g);
  }
  return out;
}
const bbox = cells => [Math.min(...cells.map(c => c[0])), Math.min(...cells.map(c => c[1])), Math.max(...cells.map(c => c[0])), Math.max(...cells.map(c => c[1]))];
const union = bs => bs.length ? [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))] : null;
const eyes = [], mouths = [];
for (const f of cfg.frames.filter(f => f.area === 'patch')) {
  const file = ['.jpg', '.png'].map(e => path.join(dir, 'queue/staged', f.name + e)).find(fs.existsSync);
  if (!file) continue;
  const { P, err } = readCrop(await readRGBA(file), master, cfg, f), boxes = groups(changedCells(P, master)).map(bbox);
  console.log(f.name, `fit ${err.toFixed(1)}`, boxes.map(b => b.join(',')).join(' | '));
  (f.name === 'v7' || f.name === 'v9' ? eyes : mouths).push(...boxes);
}
const mid = Math.round((head[0] + head[2]) / 2), e = union(eyes), m = union(mouths.filter(b => b[1] > (e ? e[3] : 0)));
console.log('\nsuggested (grow by a cell if a frame clips):');
if (e) console.log(' EBL', union(eyes.filter(b => b[2] <= mid)), ' EBR', union(eyes.filter(b => b[0] >= mid)), ' eyeWin', e);
if (m) console.log(' MB', m, ' mouthWin', m);
