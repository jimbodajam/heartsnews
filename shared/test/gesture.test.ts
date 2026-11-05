// Speech-led gesture planning (#97). Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatAt, kindOf, pausesFromCues, phrasesOf, planBeats, timeOfChar } from '../gesture.ts';

test('pauses come from long silent cues only', () => {
  const cues: [number, string][] = [[0, 'X'], [0.4, 'B'], [1, 'X'], [1.1, 'C'], [2, 'X']];
  assert.deepEqual(pausesFromCues(cues, 3), [[0, 0.4], [2, 3]]);
});

test('phrases split at sentences and commas, short pieces fold forward', () => {
  const p = phrasesOf('Well, Hearts won again. Lawrence Shankland scored twice, which was lovely.');
  assert.deepEqual(p.map((x) => x.text), ['Well, Hearts won again.', 'Lawrence Shankland scored twice,', 'which was lovely.']);
});

test('what stands out', () => {
  assert.equal(kindOf('But Rangers hit back', false), 'contrast');
  assert.equal(kindOf('they scored 3 goals', false), 'number');
  assert.equal(kindOf('and then Lawrence Shankland scored', false), 'name');
  assert.equal(kindOf('as you can see on the table', true), 'point');
  assert.equal(kindOf('as you can see on the table', false), undefined);
  assert.equal(kindOf('it was a quiet afternoon at the ground', false), undefined);
});

test('text time skips the silences', () => {
  const t = { duration: 10, pauses: [[0, 2], [6, 8]] as [number, number][] };
  assert.equal(timeOfChar(0, t), 2);
  assert.equal(timeOfChar(0.5, t), 5); // half of the 6 spoken seconds, after the 2s lead-in
});

test('beats sit at the start of phrases, settle at pauses, and never crowd each other', () => {
  const text = 'It was a long afternoon at the ground. But Hearts won 3-1, and Lawrence Shankland scored twice.';
  const timing = { duration: 12, pauses: [[4.4, 5.3]] as [number, number][] };
  const beats = planBeats(text, timing, false);
  assert.ok(beats.length >= 1 && beats.length <= 3);
  for (const b of beats) assert.ok(b.end - b.start <= 2.4 + 1e-9 && b.end > b.start);
  for (let i = 1; i < beats.length; i++) assert.ok(beats[i].start >= beats[i - 1].end + 1.6 - 1e-9);
  const contrast = beats.find((b) => b.kind === 'contrast');
  assert.ok(contrast && contrast.start >= 5.2 && contrast.start < 6.5, 'the "But" gesture starts as the sentence does, after the pause');
  assert.equal(beatAt(beats, 5.0), undefined, 'rest through the pause');
  assert.deepEqual(planBeats('It was a quiet one.', { duration: 2, pauses: [] }, false), [], 'nothing to stress, no gesture');
});

test('no screen, no pointing', () => {
  const beats = planBeats('Look at the table here, we are third.', { duration: 4, pauses: [] }, false);
  assert.ok(beats.every((b) => b.kind !== 'point'));
});
