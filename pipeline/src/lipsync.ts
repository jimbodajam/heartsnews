// Timed mouth shapes for each presenter clip (#75). Rhubarb Lip Sync reads the clip, with the spoken text as a hint, and
// `<clip>.mouth.json` goes beside it: Rhubarb's shape letters (A-H, X) with start times. The HD presenters map the letters
// on to their mouths; a clip without the file falls back to loudness, so nothing here can stop a bulletin.
//
// Rhubarb is found from RHUBARB, then PATH, then ~/tools/Rhubarb-Lip-Sync-1.14.0-Linux/rhubarb. Without it, or
// without ffmpeg for MP3 clips, this step is skipped. HEARTSNEWS_LIPSYNC=0 turns it off.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** The most the whole step may take. Clips not done by then play on loudness. */
const BUDGET_MS = 4 * 60_000;

export interface MouthCues {
  duration: number;
  /** [start seconds, Rhubarb shape]; each holds until the next starts. */
  cues: [number, string][];
}

/** The sidecar file for a clip: `abc.mp3` → `abc.mouth.json`. */
export const mouthFile = (clip: string) => clip.replace(/\.\w+$/, '.mouth.json');

function findRhubarb(): string | undefined {
  const candidates = [process.env.RHUBARB, 'rhubarb', resolve(homedir(), 'tools/Rhubarb-Lip-Sync-1.14.0-Linux/rhubarb')];
  return candidates.find((c) => c && spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
}

/** Run a program to the end; resolves with its exit code (or null when killed) and stderr. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((done) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: Math.max(1, timeoutMs) });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (err) => done({ code: null, stderr: err.message }));
    p.on('close', (code) => done({ code, stderr }));
  });
}

/** Rhubarb's JSON output cut down to what the player needs. */
export function toCues(rhubarb: { metadata: { duration: number }; mouthCues: { start: number; value: string }[] }): MouthCues {
  return { duration: rhubarb.metadata.duration, cues: rhubarb.mouthCues.map((c) => [c.start, c.value]) };
}

/**
 * Write `<clip>.mouth.json` for each clip that hasn't got one. `clips` maps a clip's full path to the words spoken in it.
 * Clips run in parallel (Rhubarb uses one core each). Failures are logged and skipped.
 */
export async function lipSync(clips: Map<string, string>, budgetMs = BUDGET_MS): Promise<{ timed: number; skipped: number }> {
  const todo = [...clips].filter(([clip]) => existsSync(clip) && !existsSync(mouthFile(clip)));
  if (!todo.length || process.env.HEARTSNEWS_LIPSYNC === '0') return { timed: 0, skipped: 0 };
  const rhubarb = findRhubarb();
  if (!rhubarb) {
    console.log(`  no Rhubarb: ${todo.length} clips will lip sync on loudness`);
    return { timed: 0, skipped: todo.length };
  }
  const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  const tmp = await mkdtemp(join(tmpdir(), 'lipsync-'));
  const deadline = Date.now() + budgetMs;
  const started = Date.now();
  let timed = 0;

  const one = async ([clip, text]: [string, string], i: number) => {
    const wav = clip.endsWith('.wav') ? clip : join(tmp, `${i}.wav`), txt = join(tmp, `${i}.txt`), out = join(tmp, `${i}.json`);
    try {
      // Rhubarb reads WAV or Ogg only.
      if (wav !== clip) {
        if (!hasFfmpeg) return;
        const conv = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip, '-ac', '1', '-ar', '16000', wav], deadline - Date.now());
        if (conv.code !== 0) throw new Error(`ffmpeg: ${conv.stderr.trim() || 'stopped'}`);
      }
      await writeFile(txt, text);
      const res = await run(rhubarb, ['-q', '--threads', '1', '-f', 'json', '-d', txt, '-o', out, wav], deadline - Date.now());
      if (res.code !== 0) throw new Error(res.code === null ? 'out of time' : `rhubarb: ${res.stderr.trim()}`);
      await writeFile(mouthFile(clip), `${JSON.stringify(toCues(JSON.parse(await readFile(out, 'utf8'))))}\n`);
      timed++;
    } catch (err) {
      if (Date.now() < deadline) console.warn(`  lip sync skipped ${clip}: ${(err as Error).message}`);
    }
  };

  // A small pool: each worker takes the next clip until none are left or time is up.
  let next = 0;
  const worker = async () => {
    while (next < todo.length && Date.now() < deadline) {
      const i = next++;
      await one(todo[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(todo.length, Math.max(1, cpus().length)) }, worker));
  await rm(tmp, { recursive: true, force: true });
  const skipped = todo.length - timed;
  console.log(`  ${timed}/${todo.length} clips lip synced in ${((Date.now() - started) / 1000).toFixed(1)}s${skipped ? `, ${skipped} on loudness` : ''}`);
  return { timed, skipped };
}
