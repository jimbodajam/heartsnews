// Suggests face boxes for a set's mouth and blink crops (#89). The straight-head ones (`patch` frames, v1-v9) and, before any of their frames are approved, the
// turned heads' sets (h1v*, h2v*), which tools/bake/bake.mjs --boxes only reads once they are approved.
// Run from the repo root, in WSL: node tools/frames/face-boxes.mjs <set> [head]   (reads the staged crops in art/presenters/<set>/queue/staged/)
//   no head   the v frames against the master: EBL/EBR and eyeWin from v7 and v9, MB and mouthWin from the rest (`face.patch.boxes`, `face.heads.b1`)
//   h1, h2    that head's frames against the head: `boxes.<head>.eyes` from <head>v7, `boxes.<head>.mouth` from the rest
// Each crop is read over the whole head, so ignore the specks at the hair and ear edges. Copy the numbers into frames.json by hand, then `npm run frames -- recheck <set>`.
import fs from 'node:fs';
import path from 'node:path';
import { frameGrid, readRGBA } from '../bake/grid.mjs';
import { cropCells, readCrop } from '../bake/crop.mjs';
import { changedCells } from './check.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..'), [name, headName = 'b1'] = process.argv.slice(2);
const dir = path.join(ROOT, 'art/presenters', name), cfg0 = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
const [cx0, cy0, cx1] = cropCells(cfg0), head = [cx0 + 2, cy0 + 2, cx1 - 3, cfg0.headCut - 1];
const cfg = { ...cfg0, boxes: { [headName]: { eyes: [head], mouth: [head] } }, face: { ...cfg0.face, patch: { ...cfg0.face.patch, boxes: undefined }, heads: { b1: { eyeWin: head } } } };
const parent = frameGrid(await readRGBA(path.join(ROOT, cfg.src, headName + '.jpg')), cfg.grid, cfg.bg);
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
const eyes = [], mouths = [], isEyes = f => f.area === 'eyes' || f.name === 'v7' || f.name === 'v9';
for (const f of cfg.frames.filter(f => f.crop && (headName === 'b1' ? f.area === 'patch' : f.parent === headName))) {
  const file = ['.jpg', '.png'].map(e => path.join(dir, 'queue/staged', f.name + e)).find(fs.existsSync);
  if (!file) continue;
  const { P, err } = readCrop(await readRGBA(file), parent, cfg, f), boxes = groups(changedCells(P, parent)).map(bbox);
  console.log(f.name, `fit ${err.toFixed(1)}`, boxes.map(b => b.join(',')).join(' | '));
  (isEyes(f) ? eyes : mouths).push(...boxes);
}
const mid = Math.round((head[0] + head[2]) / 2), e = union(eyes), m = union(mouths.filter(b => b[1] > (e ? e[3] : 0)));
console.log('\nsuggested (grow by a cell if a frame clips):');
if (headName === 'b1') {
  if (e) console.log(' EBL', union(eyes.filter(b => b[2] <= mid)), ' EBR', union(eyes.filter(b => b[0] >= mid)), ' eyeWin', e);
  if (m) console.log(' MB', m, ' mouthWin', m);
} else console.log(` boxes.${headName}: eyes`, e, ' mouth', m);
