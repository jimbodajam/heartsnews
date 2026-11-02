// Timed mouth shapes for pre-rendered clips (#75). Runs Rhubarb Lip Sync on each clip, with the line's text as a hint,
// and writes `<clip>.mouth.json` beside it: Rhubarb's own shape letters (A-H, X) with start times, so the mapping on to a
// presenter's mouths stays in the player. Usage, from the repo root in WSL:
//   node tools/lipsync/lipsync.mjs site/public/spike/audio/lines.json
// RHUBARB points at the binary (default ~/tools/Rhubarb-Lip-Sync-1.14.0-Linux/rhubarb). ffmpeg must be on PATH.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const RHUBARB = process.env.RHUBARB || join(homedir(), 'tools/Rhubarb-Lip-Sync-1.14.0-Linux/rhubarb');
const list = resolve(process.argv[2] || 'site/public/spike/audio/lines.json');
const lines = JSON.parse(readFileSync(list, 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'lipsync-'));

for (const line of lines) {
  const clip = resolve(dirname(list), line.file), wav = join(tmp, 'clip.wav'), txt = join(tmp, 'clip.txt'), out = join(tmp, 'clip.json');
  const started = Date.now();
  // Rhubarb reads WAV or Ogg only.
  const conv = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip, '-ac', '1', '-ar', '16000', wav]);
  if (conv.status !== 0) { console.warn(`ffmpeg failed on ${line.file}: ${conv.stderr}`); continue; }
  writeFileSync(txt, line.text);
  const rh = spawnSync(RHUBARB, ['-q', '-f', 'json', '-d', txt, '-o', out, wav]);
  if (rh.status !== 0) { console.warn(`rhubarb failed on ${line.file}: ${rh.stderr || rh.error?.message}`); continue; }
  const { metadata, mouthCues } = JSON.parse(readFileSync(out, 'utf8'));
  // Each cue holds until the next one starts, so start times are enough.
  const cues = mouthCues.map((c) => [c.start, c.value]);
  writeFileSync(clip.replace(/\.\w+$/, '.mouth.json'), JSON.stringify({ duration: metadata.duration, cues }) + '\n');
  console.log(`${line.file.padEnd(12)} ${cues.length} cues in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
rmSync(tmp, { recursive: true, force: true });
