// Mouth timings (issue #75): a missing or broken Rhubarb never stops a bulletin, and the sidecar file is written beside the clip. Run with `npm test`.

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lipSync, mouthFile, toCues } from '../src/lipsync.ts';

const dir = mkdtempSync(join(tmpdir(), 'lipsync-test-'));
const clip = (name: string) => {
  const f = join(dir, name);
  writeFileSync(f, 'RIFF');
  return f;
};

test('the sidecar sits beside its clip', () => {
  assert.equal(mouthFile('audio/abc123.mp3'), 'audio/abc123.mouth.json');
});

test("Rhubarb's output is cut down to start times and letters", () => {
  const cues = toCues({ metadata: { duration: 1.2 }, mouthCues: [{ start: 0, value: 'X' }, { start: 0.17, value: 'B' }] });
  assert.deepEqual(cues, { duration: 1.2, cues: [[0, 'X'], [0.17, 'B']] });
});

test('no Rhubarb: every clip is skipped and nothing throws', async () => {
  process.env.RHUBARB = join(dir, 'missing');
  const a = clip('a.wav');
  const r = await lipSync(new Map([[a, 'Hello']]));
  assert.equal(r.timed, 0);
  assert.equal(existsSync(mouthFile(a)), false);
});

test('a working Rhubarb writes the timings; a failing one is skipped', { skip: process.platform === 'win32' }, async () => {
  // A stand-in Rhubarb: answers --version, writes fixed cues to -o, and fails on any clip named bad.wav.
  const fake = join(dir, 'rhubarb');
  writeFileSync(
    fake,
    `#!/bin/sh
[ "$1" = "--version" ] && exit 0
out=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; last="$a"; done
case "$last" in *bad.wav) echo broken >&2; exit 1;; esac
echo '{"metadata":{"duration":0.5},"mouthCues":[{"start":0,"end":0.2,"value":"X"},{"start":0.2,"end":0.5,"value":"D"}]}' > "$out"
`,
  );
  chmodSync(fake, 0o755);
  process.env.RHUBARB = fake;
  const good = clip('good.wav'), bad = clip('bad.wav');
  const r = await lipSync(new Map([[good, 'Hearts'], [bad, 'News']]));
  assert.deepEqual(r, { timed: 1, skipped: 1 });
  assert.deepEqual(JSON.parse(readFileSync(mouthFile(good), 'utf8')), { duration: 0.5, cues: [[0, 'X'], [0.2, 'D']] });
  assert.equal(existsSync(mouthFile(bad)), false);
  // Clips that already have timings are left alone.
  assert.deepEqual(await lipSync(new Map([[good, 'Hearts']])), { timed: 0, skipped: 0 });
});
