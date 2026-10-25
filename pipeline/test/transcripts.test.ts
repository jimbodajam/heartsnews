// When a video's missing captions are tried again (pipeline/src/collectors/transcripts.ts). Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryDue } from '../src/collectors/transcripts.ts';

// The 25 Oct reaction video: published 17:49, first tried at 18:01 before YouTube had its captions.
const published = '2026-10-25T17:49:33.000Z';
const at = (iso: string) => new Date(iso);

test('a new video with no captions is tried again after an hour', () => {
  const cached = { text: '', triedAt: '2026-10-25T18:01:00.000Z' };
  assert.equal(retryDue(cached, published, at('2026-10-25T18:31:00.000Z')), false);
  assert.equal(retryDue(cached, published, at('2026-10-25T19:01:00.000Z')), true);
});

test('an empty entry from before retries were stamped is tried again while the video is new', () => {
  assert.equal(retryDue({ text: '' }, published, at('2026-10-25T22:00:00.000Z')), true);
});

test('a video over two days old is left alone, captions or not', () => {
  assert.equal(retryDue({ text: '' }, published, at('2026-10-27T18:00:00.000Z')), false);
});

test('a video with a transcript is never fetched again', () => {
  assert.equal(retryDue({ text: 'x'.repeat(300) }, published, at('2026-10-25T22:00:00.000Z')), false);
});

test('a clip whose captions are only a few words counts as none', () => {
  assert.equal(retryDue({ text: 'music', triedAt: '2026-10-25T18:01:00.000Z' }, published, at('2026-10-25T20:00:00.000Z')), true);
});
