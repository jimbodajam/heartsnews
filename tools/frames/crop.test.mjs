import test from 'node:test';
import assert from 'node:assert/strict';
import { Pix } from '../../site/spike-lib/pixel-derive.js';
import { frameFile, cropCells, readCrop } from '../bake/crop.mjs';

// a figure of textured cells on a 80x60 grid, its head crop (cells 10-50 by 10-40, drawn at 18 px a cell, as a 3x crop would be) and a mouth box in the middle
const cfg = { grid: { w: 80, h: 60, blk: 6 }, crop: { box: [60, 60, 240, 180], scale: 3 }, boxes: { h1: { mouth: [[24, 22, 33, 26]] } } };
const BG = [180, 40, 130], tex = (x, y) => [120 + ((x * 7 + y * 3) % 60), 100 + ((x * 5 + y * 11) % 70), 90 + ((x * 13 + y * 2) % 50)];
const parent = () => { const P = new Pix(80, 60); for (let y = 12; y < 38; y++) for (let x = 15; x < 45; x++) P.set(x, y, tex(x, y)); return P; };
const crop = (mouth, shift = 0) => {
  const [W, H] = [720, 540], data = Buffer.alloc(W * H * 4, 255), P = parent();
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = Math.floor((px - shift) / 18) + 10, y = Math.floor(py / 18) + 10, inMouth = x >= 24 && x <= 33 && y >= 22 && y <= 26, c = P.has(x, y) ? (inMouth && mouth ? mouth : tex(x, y)) : BG, i = (py * W + px) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
  }
  return { data, w: W, h: H };
};
const f = { name: 'h1v1', parent: 'h1', area: 'mouth', crop: true };

test('a crop frame has its own file name', () => {
  assert.equal(frameFile(f), 'h1v1-crop.jpg');
  assert.equal(frameFile({ name: 'h1v1' }), 'h1v1.jpg');
  assert.equal(frameFile({ name: 'h6', file: 'h6-redo.jpg' }), 'h6-redo.jpg');
  assert.deepEqual(cropCells(cfg), [10, 10, 50, 40]);
});
test('only the mouth box is taken from the crop', () => {
  const r = readCrop(crop([20, 20, 20]), parent(), cfg, f), P = parent();
  assert.deepEqual(r.P.get(28, 24).map(Math.round), [20, 20, 20]);
  assert.deepEqual(r.P.get(20, 14).map(Math.round), P.get(20, 14));
  assert.ok(Math.abs(r.scale - 1) < 0.04 && r.err < 10, `scale ${r.scale} error ${r.err}`);
});
test('a dark mouth that sits near the background colour is kept, not cut out', () => {
  const r = readCrop(crop([170, 60, 120]), parent(), cfg, f);
  assert.equal(r.P.has(28, 24), true);
});
test('a crop that came back a few pixels shifted still lands on the same cells', () => {
  const r = readCrop(crop([20, 20, 20], 6), parent(), cfg, f);
  assert.deepEqual(r.P.get(28, 24).map(Math.round), [20, 20, 20]);
  assert.deepEqual(r.P.get(18, 30).map(Math.round), parent().get(18, 30));
});
