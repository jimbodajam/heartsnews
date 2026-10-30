// Milestone 5: pre-render every bulletin line with its presenter's Kokoro voice.
// Usage: npm run voice [-- path/to/bulletin.json]   (default: site/public/bulletins/latest.json)
//
// Clips are named by a hash of model + voice + text, so re-running only renders new or changed lines.
// Set KOKORO_DTYPE=q8 for a smaller, faster (slightly rougher) model than the default fp32.

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KokoroTTS } from 'kokoro-js';
import type { Bulletin, Line, Presenter } from '../../shared/bulletin.ts';
import { loadPronunciations, pronouncer } from './pronounce.ts';
import { shortHash } from './text.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = (process.env.KOKORO_DTYPE ?? 'fp32') as 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
const AUDIO_DIR = 'audio';

type Voice = Parameters<KokoroTTS['generate']>[1] extends { voice?: infer V } | undefined ? V : string;

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

export const CLIP_EXT = hasFfmpeg ? 'mp3' : 'wav';

export async function loadKokoro(): Promise<KokoroTTS> {
  console.log(`Loading Kokoro (${DTYPE})…`);
  return KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: 'cpu' });
}

/** Speak `text` with a Kokoro voice into `file` (.mp3 when ffmpeg is available, else .wav). */
/** A phone line: voice squeezed to the band a landline carried, a touch of grit. */
export const PHONE_FILTER = 'highpass=f=350,lowpass=f=3200,acompressor=threshold=-18dB:ratio=4,volume=1.4';

export async function renderClip(tts: KokoroTTS, text: string, voice: string, speed: number, file: string, filter?: 'phone'): Promise<void> {
  const audio = await tts.generate(text, { voice: voice as Voice, speed });
  if (!hasFfmpeg) return audio.save(file);
  const wav = file.replace(/\.mp3$/, '.wav');
  await audio.save(wav);
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, ...(filter ? ['-af', PHONE_FILTER] : []), '-b:a', '96k', file]);
  await rm(wav);
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr}`);
}

interface Job {
  text: string;
  voice: string;
  speed: number;
  filter?: 'phone';
  out: string;
}

const GPU_HOME = resolve(homedir(), '.cache/heartsnews-gpu');
const GPU_PYTHON = resolve(GPU_HOME, 'env/bin/python');

/** GPU voices are used when tools/gpu/setup.sh has been run, unless HEARTSNEWS_GPU=0. */
function gpuAvailable(): boolean {
  return process.env.HEARTSNEWS_GPU !== '0' && existsSync(GPU_PYTHON) && existsSync(resolve(GPU_HOME, 'models/kokoro-v1.0.onnx'));
}

/** Render every job in one batch on the GPU (tools/gpu/voices.py writes WAVs), then convert to MP3. */
async function renderOnGpu(jobs: Job[]): Promise<void> {
  const wav = (out: string) => out.replace(/\.mp3$/, '.wav');
  const res = spawnSync(GPU_PYTHON, ['-I', resolve(ROOT, 'tools/gpu/voices.py')], {
    input: JSON.stringify(jobs.map((j) => ({ ...j, out: wav(j.out) }))),
    stdio: ['pipe', 'inherit', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`tools/gpu/voices.py exited with ${res.status ?? res.signal}`);
  await encode(jobs);
}

/** Turn each job's WAV into its MP3 (through the phone filter for callers), when ffmpeg is there; otherwise the WAV is the clip. */
async function encode(jobs: { out: string; filter?: 'phone' }[]): Promise<void> {
  if (!hasFfmpeg) return;
  for (const j of jobs) {
    const wav = j.out.replace(/\.mp3$/, '.wav');
    const conv = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, ...(j.filter ? ['-af', PHONE_FILTER] : []), '-b:a', '96k', j.out]);
    await rm(wav, { force: true });
    if (conv.status !== 0) throw new Error(`ffmpeg failed: ${conv.stderr}`);
  }
}

const CLONE_PYTHON = resolve(GPU_HOME, 'env-qwen/bin/python');
const CLONE_REFS = process.env.HEARTSNEWS_VOICES ?? resolve(GPU_HOME, 'voices');
/** The most the clone renderer may take: whatever it has finished by then is used, and Kokoro speaks the rest. */
const CLONE_TIMEOUT_MS = 20 * 60_000;

type Clone = NonNullable<NonNullable<Presenter['tts']>['clone']>;

interface CloneJob {
  text: string;
  clone: Clone;
  filter?: 'phone';
  out: string;
  lines: Line[];
  /** What Kokoro would say for the same lines, used if the clone can't. */
  fallback: Job;
}

/** Cloned voices are used when tools/gpu/clone-setup.sh has been run and the speaker's clip (and its words) is in place, unless HEARTSNEWS_CLONE=0. */
function cloneAvailable(clone: Clone | undefined): clone is Clone {
  if (!clone || process.env.HEARTSNEWS_CLONE === '0' || !existsSync(CLONE_PYTHON)) return false;
  return existsSync(resolve(CLONE_REFS, `${clone.ref}.wav`)) && (!!clone.voiceOnly || existsSync(resolve(CLONE_REFS, `${clone.ref}.txt`)));
}

/** Replacing a reference clip re-renders every line in that voice. */
const refStamp = (ref: string) => Math.round(statSync(resolve(CLONE_REFS, `${ref}.wav`)).mtimeMs);

/**
 * Render every job in one go with tools/gpu/clone_voices.py (batched, with its own retries). A line it can't finish is simply not written; the
 * caller checks which clips exist. A crash or the timeout is not an error here: the lines already done stand and Kokoro covers the rest.
 */
async function renderClones(jobs: CloneJob[]): Promise<void> {
  const wav = (out: string) => out.replace(/\.mp3$/, '.wav');
  const res = spawnSync(CLONE_PYTHON, ['-I', resolve(ROOT, 'tools/gpu/clone_voices.py')], {
    input: JSON.stringify(jobs.map((j) => ({ text: j.text, ref: j.clone.ref, voiceOnly: j.clone.voiceOnly ?? false, out: wav(j.out) }))),
    env: { ...process.env, HEARTSNEWS_VOICES: CLONE_REFS },
    stdio: ['pipe', 'inherit', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
    timeout: CLONE_TIMEOUT_MS,
  });
  if (res.error || res.status !== 0) console.warn(`Clone voices stopped early (${res.error?.message ?? res.status ?? res.signal}): using the lines it finished, Kokoro for the rest`);
  await encode(jobs.filter((j) => existsSync(wav(j.out))));
}

/**
 * Render any missing clips for these lines into `<dir>/audio/`, and set each line's `audio` to its clip's path
 * relative to `dir`. Returns how many were rendered and reused.
 */
export async function voiceLines(presenters: Presenter[], lines: Line[], dir: string): Promise<{ rendered: number; reused: number }> {
  const outDir = resolve(dir, AUDIO_DIR);
  await mkdir(outDir, { recursive: true });
  const say = pronouncer(loadPronunciations());

  let reused = 0;
  const jobs: Job[] = [];
  const cloneJobs: CloneJob[] = [];
  for (const line of lines) {
    const p = presenters.find((x) => x.id === line.speaker);
    if (!p?.tts) {
      delete line.audio;
      continue;
    }
    const speed = p.tts.speed ?? 1;
    // The spoken text (with respellings) goes into the hash, so editing pronunciations re-renders affected lines.
    const spoken = say(line.text);
    const name = `${shortHash(`${MODEL}|${DTYPE}|${p.tts.voice}|${speed}${p.tts.filter ? `|${p.tts.filter}` : ''}|${spoken}`)}.${CLIP_EXT}`;
    const file = resolve(outDir, name);
    const kokoro: Job = { text: spoken, voice: p.tts.voice, speed, filter: p.tts.filter, out: file };

    // A presenter with a cloned voice is cloned where the home PC can; everywhere else (GitHub builds, a missing clip) it is Kokoro as always.
    const clone = p.tts.clone;
    if (cloneAvailable(clone)) {
      const cloneName = `${shortHash(`clone|${clone.ref}|${clone.voiceOnly ? 'voice' : 'words'}|${refStamp(clone.ref)}${p.tts.filter ? `|${p.tts.filter}` : ''}|${spoken}`)}.${CLIP_EXT}`;
      const cloneFile = resolve(outDir, cloneName);
      line.audio = `${AUDIO_DIR}/${cloneName}`;
      if (existsSync(cloneFile)) {
        reused++;
        continue;
      }
      let c = cloneJobs.find((j) => j.out === cloneFile);
      if (!c) cloneJobs.push((c = { text: spoken, clone, filter: p.tts.filter, out: cloneFile, lines: [], fallback: kokoro }));
      c.lines.push(line);
      continue;
    }

    line.audio = `${AUDIO_DIR}/${name}`;
    if (existsSync(file)) reused++;
    else if (!jobs.some((j) => j.out === file)) jobs.push(kokoro);
  }

  // Cloned voices first (tools/gpu/clone_voices.py). A line it couldn't do goes to Kokoro under Kokoro's own clip name, so the next build tries the clone again.
  let cloned = 0;
  if (cloneJobs.length) {
    const started = Date.now();
    await renderClones(cloneJobs);
    for (const c of cloneJobs) {
      if (existsSync(c.out)) {
        cloned++;
        continue;
      }
      for (const l of c.lines) l.audio = `${AUDIO_DIR}/${basename(c.fallback.out)}`;
      if (!existsSync(c.fallback.out) && !jobs.some((j) => j.out === c.fallback.out)) jobs.push(c.fallback);
    }
    console.log(`  ${cloned}/${cloneJobs.length} cloned clips in ${((Date.now() - started) / 1000).toFixed(1)}s${cloned < cloneJobs.length ? `, Kokoro covering ${cloneJobs.length - cloned}` : ''}`);
  }

  // The GPU does the whole batch in seconds when it's set up (tools/gpu/setup.sh); otherwise Kokoro runs on the CPU.
  let remaining = jobs;
  if (jobs.length && gpuAvailable()) {
    const started = Date.now();
    try {
      await renderOnGpu(jobs);
      remaining = [];
      console.log(`  ${jobs.length} clips on the GPU in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.warn(`GPU voices failed, using the CPU instead: ${(err as Error).message}`);
      remaining = jobs.filter((j) => !existsSync(j.out));
    }
  }
  let tts: KokoroTTS | undefined;
  for (const j of remaining) {
    tts ??= await loadKokoro();
    const started = Date.now();
    await renderClip(tts, j.text, j.voice, j.speed, j.out, j.filter);
    console.log(`  ${j.voice.padEnd(12)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${j.text.slice(0, 50)}…`);
  }
  return { rendered: jobs.length + cloned, reused };
}

/** Delete the clips in `<dir>/audio/` that none of these lines use, so the deployed site only holds what's playing. */
export async function dropUnusedClips(lines: Line[], dir: string): Promise<number> {
  const outDir = resolve(dir, AUDIO_DIR);
  const keep = new Set(lines.map((l) => l.audio?.split('/').pop()));
  const stale = (await readdir(outDir)).filter((f) => !keep.has(f));
  await Promise.all(stale.map((f) => rm(resolve(outDir, f))));
  return stale.length;
}

/** Render any missing clips for a bulletin file and write the clip paths back into it. */
export async function renderVoices(bulletinPath: string): Promise<void> {
  const bulletin = JSON.parse(await readFile(bulletinPath, 'utf8')) as Bulletin;
  const dir = dirname(bulletinPath);
  const lines = bulletin.segments.flatMap((s) => s.lines);
  const { rendered, reused } = await voiceLines(bulletin.presenters, lines, dir);

  await writeFile(bulletinPath, `${JSON.stringify(bulletin, null, 2)}\n`);

  // Drop clips from earlier bulletins so the folder (and the deployed site) only holds what's playing.
  const stale = await dropUnusedClips(lines, dir);
  if (stale) console.log(`${stale} old clips removed`);
  console.log(`${rendered} clips rendered, ${reused} reused → ${resolve(dir, AUDIO_DIR)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  renderVoices(resolve(ROOT, process.argv[2] ?? 'site/public/bulletins/latest.json')).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
