// Pastes the generated head crops back on to the master and writes the comparison numbers (#71).
// Run from the repo root: node tools/crop-test/paste.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import { BOX, SCALE } from './crop.mjs';
const D = 'site/public/spike/fraser/standing/', OUT = 'tools/crop-test/out/', PUB = 'site/public/spike/fraser/crop-test/';
const CELL = 848 / 144;                         // one grid cell in master pixels
const FACE = [336, 124, 536, 278];              // eyes and mouth window, master pixels (grid 57-91 x 21-47)
const HEAD = [236, 30, 612, 283];               // whole head above the collar (grid row 48)
const TESTS = [['v1', FACE], ['v7', FACE], ['h3', HEAD], ['h4', HEAD]];

const raw = async f => { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const master = await raw(D + 'b1.jpg');
fs.mkdirSync(PUB, { recursive: true });

// grid sample: colour at each cell centre, so scale and resampling differences wash out
const sample = (img, [x0, y0, x1, y1]) => {
  const out = [];
  for (let gy = Math.floor(y0 / CELL); gy * CELL < y1; gy++) for (let gx = Math.floor(x0 / CELL); gx * CELL < x1; gx++) {
    const x = Math.min(img.w - 1, Math.round((gx + 0.5) * CELL)), y = Math.min(img.h - 1, Math.round((gy + 0.5) * CELL)), i = (y * img.w + x) * 3;
    out.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  }
  return out;
};
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const colours = cells => new Set(cells.map(c => c.map(v => v >> 3).join(','))).size;
const changed = (a, b) => a.reduce((n, c, i) => n + (dist(c, b[i]) > 60 ? 1 : 0), 0);

const rows = [];
for (const [name, box] of TESTS) {
  // crop result: back to 1128x900, then 3x down by nearest to the master scale, pasted over the box only
  const gen = await sharp(OUT + `gen-${name}.jpg`).resize(BOX.width * SCALE, BOX.height * SCALE).resize(BOX.width, BOX.height, { kernel: 'lanczos3' }).raw().toBuffer();
  const pasted = Buffer.from(master.data);
  const bgGen = [gen[0], gen[1], gen[2]], at = (x, y) => ((y - BOX.top) * BOX.width + (x - BOX.left)) * 3;
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) {
    // snapping to the master's 144 grid was tried and is worse (the model draws on its own grid phase), so this is a plain resample; the generated background goes back to the master's
    const s = at(x, y), d = (y * master.w + x) * 3;
    const isBg = dist([gen[s], gen[s + 1], gen[s + 2]], bgGen) < 45;
    for (let k = 0; k < 3; k++) pasted[d + k] = isBg ? master.data[k] : gen[s + k];
  }
  await sharp(pasted, { raw: { width: master.w, height: master.h, channels: 3 } }).png().toFile(OUT + `paste-${name}.png`);
  const pastedImg = { data: pasted, w: master.w, h: master.h }, full = await raw(D + name + '.jpg');
  // drift: cells in the crop area outside the pasted box that differ from the master (should be none, we only take the box)
  const area = [BOX.left, BOX.top, BOX.left + BOX.width, BOX.top + BOX.height];
  // quality: cells changed against the master inside the box, and distinct colours, for crop result and for the full-figure frame
  const m = sample(master, box), c = sample(pastedImg, box), f = sample(full, box);
  // drift of the crop run in the part of the crop we throw away: how far the model redrew things we did not ask for
  const mArea = sample(master, area), canvas = Buffer.from(master.data);
  for (let y = 0; y < BOX.height; y++) for (let x = 0; x < BOX.width; x++) for (let k = 0; k < 3; k++) canvas[((y + BOX.top) * master.w + x + BOX.left) * 3 + k] = gen[(y * BOX.width + x) * 3 + k];
  const gArea = sample({ data: canvas, w: master.w, h: master.h }, area);
  const fArea = sample(full, area);
  rows.push({ name, cells: m.length, changedCrop: changed(c, m), changedFull: changed(f, m), coloursMaster: colours(m), coloursCrop: colours(c), coloursFull: colours(f), driftCrop: changed(gArea, mArea), driftFull: changed(fArea, mArea), areaCells: mArea.length });
  fs.copyFileSync(OUT + `paste-${name}.png`, PUB + `paste-${name}.png`);
  fs.copyFileSync(D + name + '.jpg', PUB + `full-${name}.jpg`);
}
fs.copyFileSync(D + 'b1.jpg', PUB + 'master.jpg');
console.table(rows);
fs.writeFileSync(OUT + 'numbers.json', JSON.stringify(rows, null, 1));
