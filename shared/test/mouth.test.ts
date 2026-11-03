// Rhubarb cue parsing and lookup for the live player's timed mouths. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMouthCues, shapeAt, withoutPress } from '../mouth.ts';

const cues = parseMouthCues({ duration: 2, cues: [[0, 'X'], [0.17, 'B'], [0.58, 'G'], [1, 'C'], [1.46, 'D'], [1.8, 'A'], [1.9, 'F']] })!;

test('each cue holds until the next one starts', () => {
  assert.equal(shapeAt(cues, 0), 'closed');
  assert.equal(shapeAt(cues, 0.17), 'small');
  assert.equal(shapeAt(cues, 0.6), 'small');
  assert.equal(shapeAt(cues, 1.2), 'wide');
  assert.equal(shapeAt(cues, 1.5), 'A');
  assert.equal(shapeAt(cues, 1.85), 'press');
  assert.equal(shapeAt(cues, 5), 'O');
});

test('before the first cue, or on an unknown letter, the mouth is closed', () => {
  assert.equal(shapeAt([[0.5, 'D']], 0.2), 'closed');
  assert.equal(shapeAt([[0, 'Z']], 1), 'closed');
});

test('bad files give no cues', () => {
  for (const bad of [null, undefined, 3, {}, { cues: [] }, { cues: 'x' }, { cues: [[0]] }, { cues: [['0', 'X']] }]) assert.equal(parseMouthCues(bad), undefined);
});

test('a real pipeline file parses', () => {
  const file = JSON.parse(readFileSync(new URL('../../site/public/test/audio/line0.mouth.json', import.meta.url), 'utf8'));
  const parsed = parseMouthCues(file);
  assert.ok(parsed && parsed.length > 5);
  assert.equal(shapeAt(parsed, 0.3), 'small');
});

test('press becomes closed for sets without it', () => {
  assert.equal(withoutPress('press'), 'closed');
  assert.equal(withoutPress('wide'), 'wide');
});
