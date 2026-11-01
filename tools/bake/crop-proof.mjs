// Proves crop registration on the #71 test crops: fits each to Fraser's master, reads it at the master's cells, snaps it to the locked palette and pastes the editable area back.
// Run from the repo root, after a bake: node tools/bake/crop-proof.mjs   Writes tools/bake/out/crop-proof.png: full-figure frame, old plain resample, registered crop.
import fs from 'node:fs';
import sharp from 'sharp';
import { readRGBA, frameGrid, registerCrop, cropToGrid } from './grid.mjs';
import { snapPix, snapper } from './palette.mjs';

const cfg = JSON.parse(fs.readFileSync('art/presenters/fraser/frames.json', 'utf8')), palette = JSON.parse(fs.readFileSync('art/presenters/fraser/palette.json', 'utf8'));
const CELL = 848 / 144, BOX = { left: 236, top: 30, width: 376, height: 300 }, SCALE = 3, OUT = 'tools/crop-test/out/';
const box = [Math.round(BOX.left / CELL), Math.round(BOX.top / CELL), Math.round((BOX.left + BOX.width) / CELL), Math.round((BOX.top + BOX.height) / CELL)];
// [frame, editable box in grid cells: the face for mouths and blinks, the whole head for a nod]
const TESTS = [['v1', [57, 21, 91, 47]], ['v7', [57, 21, 91, 47]], ['h3', [40, 5, 104, 47]], ['h4', [40, 5, 104, 47]]];
const master = frameGrid(await readRGBA(cfg.src + 'b1.jpg'), cfg.grid, cfg.bg), snap = snapper(palette), S = 3, W = box[2] - box[0], H = box[3] - box[1];
const columns = 3, buf = Buffer.alloc(columns * W * S * TESTS.length * H * S * 4, 255);
const put = (P, col, row) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const has = P.has(x + box[0], y + box[1]), c = has ? P.get(x + box[0], y + box[1]).map(Math.round) : [40, 46, 80]; for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { const k = (((row * H + y) * S + a) * columns * W * S + (col * W + x) * S + b) * 4; buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; buf[k + 3] = 255; } } };

for (const [row, [name, area]] of TESTS.entries()) {
  const img = await readRGBA(`${OUT}gen-${name}.jpg`), nominal = [CELL * SCALE * img.w / (BOX.width * SCALE), CELL * SCALE * img.h / (BOX.height * SCALE)];
  // the face or head is meant to change, so the fit scores the hair, collar and shoulders round it (a nod moves the whole head, so it scores the shoulders)
  const fit = registerCrop(img, master, box, nominal, area), P = cropToGrid(img, fit, box, cfg.grid), paste = master.clone();
  for (let y = area[1]; y <= area[3]; y++) for (let x = area[0]; x <= area[2]; x++) if (P.has(x, y)) paste.set(x, y, P.get(x, y)); else if (!master.has(x, y)) paste.d[paste.idx(x, y) + 3] = 0;
  const plain = frameGrid(await readRGBA(`${OUT}paste-${name}.png`), cfg.grid, cfg.bg);
  put(snapPix(frameGrid(await readRGBA(cfg.src + name + '.jpg'), cfg.grid, cfg.bg), palette, snap), 0, row);
  put(plain, 1, row);
  put(snapPix(paste, palette, snap), 2, row);
  console.log(name, 'scale', (fit.sx / nominal[0]).toFixed(3), 'shift', fit.ox, fit.oy, 'match error', fit.e.toFixed(1));
}
await sharp(buf, { raw: { width: columns * W * S, height: TESTS.length * H * S, channels: 4 } }).png().toFile('tools/bake/out/crop-proof.png');
