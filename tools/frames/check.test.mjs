import test from 'node:test';
import assert from 'node:assert/strict';
import { Pix } from '../../site/spike-lib/pixel-derive.js';
import { checkFrame, solid } from './check.mjs';

const cfg = { grid: { w: 40, h: 60 }, headCut: 15, feetTop: 45, boxes: { h1: { mouth: [[10, 8, 20, 12]] } } };
const fig = () => { const P = new Pix(40, 60); for (let y = 0; y < 60; y++) for (let x = 10; x < 30; x++) P.set(x, y, [200, 150, 120]); return P; };
const paint = (P, x0, y0, x1, y1, c = [10, 10, 10]) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) P.set(x, y, c); return P; };

test('a change inside the area passes', () => {
  const r = checkFrame(paint(fig(), 12, 20, 22, 30), fig(), { name: 'b2', area: 'arm', parent: 'b1' }, cfg);
  assert.equal(r.ok, true);
});
test('a redrawn head on an arm frame is rejected, with where', () => {
  const r = checkFrame(paint(fig(), 12, 2, 22, 10), fig(), { name: 'b2', area: 'arm', parent: 'b1' }, cfg);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /outside its area \(arm\).*y 2-10/);
});
test('specks of drift outside the area are ignored, a mass is not', () => {
  const specks = fig(); for (let x = 11; x < 28; x += 3) specks.set(x, 3, [0, 0, 0]);
  assert.equal(solid([[1, 1], [5, 5]]).length, 0);
  assert.equal(checkFrame(paint(specks, 12, 20, 22, 30), fig(), { name: 'b2', area: 'arm', parent: 'b1' }, cfg).ok, true);
});
test('mouth frames may only change their box', () => {
  const f = { name: 'h1v1', area: 'mouth', parent: 'h1' };
  assert.equal(checkFrame(paint(fig(), 12, 9, 18, 11), fig(), f, cfg).ok, true);
  assert.equal(checkFrame(paint(fig(), 12, 0, 28, 11), fig(), f, cfg).ok, false);
});
test('an arm that goes the wrong way is rejected', () => {
  const f = { name: 'b7', area: 'arm', parent: 'b1' }, left = { dir: 'left', measure: 'changed' };
  assert.equal(checkFrame(paint(fig(), 25, 20, 38, 30), fig(), f, cfg, left).ok, false);
  assert.equal(checkFrame(paint(fig(), 1, 20, 14, 30), fig(), f, cfg, left).ok, true);
});
test('an unchanged frame is rejected', () => {
  assert.equal(checkFrame(fig(), fig(), { name: 'b2', area: 'arm', parent: 'b1' }, cfg).ok, false);
});
test('hands frames may only change rows from the desk edge down', () => {
  const f = { name: 'p1', area: 'hands', parent: 'b1' }, seated = { ...cfg, handsTop: 40 };
  assert.equal(checkFrame(paint(fig(), 12, 42, 28, 55), fig(), f, seated).ok, true);
  assert.equal(checkFrame(paint(fig(), 12, 20, 28, 55), fig(), f, seated).ok, false);
});
