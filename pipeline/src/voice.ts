// Milestone 5: pre-render every bulletin line with its presenter's Kokoro voice.
// Usage: npm run voice [-- path/to/bulletin.json]   (default: site/public/bulletins/latest.json)
//
// Clips are named by a hash of model + voice + text, so re-running only renders new or changed lines.
// Set KOKORO_DTYPE=q8 for a smaller, faster (slightly rougher) model than the default fp32.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KokoroTTS } from 'kokoro-js';
import type { Bulletin } from '../../shared/bulletin.ts';
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
export async function renderClip(tts: KokoroTTS, text: string, voice: string, speed: number, file: string): Promise<void> {
  const audio = await tts.generate(text, { voice: voice as Voice, speed });
  if (!hasFfmpeg) return audio.save(file);
  const wav = file.replace(/\.mp3$/, '.wav');
  await audio.save(wav);
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-b:a', '96k', file]);
  await rm(wav);
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr}`);
}

/** Render any missing clips for a bulletin file and write the clip paths back into it. */
export async function renderVoices(bulletinPath: string): Promise<void> {
  const bulletin = JSON.parse(await readFile(bulletinPath, 'utf8')) as Bulletin;
  const outDir = resolve(dirname(bulletinPath), AUDIO_DIR);
  await mkdir(outDir, { recursive: true });
  const say = pronouncer(loadPronunciations());

  let tts: KokoroTTS | undefined;
  let rendered = 0;
  let reused = 0;

  for (const seg of bulletin.segments) {
    for (const line of seg.lines) {
      const p = bulletin.presenters.find((x) => x.id === line.speaker);
      if (!p?.tts) {
        delete line.audio;
        continue;
      }
      const speed = p.tts.speed ?? 1;
      // The spoken text (with respellings) goes into the hash, so editing pronunciations re-renders affected lines.
      const spoken = say(line.text);
      const name = `${shortHash(`${MODEL}|${DTYPE}|${p.tts.voice}|${speed}|${spoken}`)}.${CLIP_EXT}`;
      const file = resolve(outDir, name);
      line.audio = `${AUDIO_DIR}/${name}`;
      if (existsSync(file)) {
        reused++;
        continue;
      }

      tts ??= await loadKokoro();
      const started = Date.now();
      await renderClip(tts, spoken, p.tts.voice, speed, file);
      rendered++;
      console.log(`  ${p.name.padEnd(16)} ${p.tts.voice.padEnd(12)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${line.text.slice(0, 50)}…`);
    }
  }

  await writeFile(bulletinPath, `${JSON.stringify(bulletin, null, 2)}\n`);

  // Drop clips from earlier bulletins so the folder (and the deployed site) only holds what's playing.
  const keep = new Set(bulletin.segments.flatMap((s) => s.lines.map((l) => l.audio?.split('/').pop())));
  const stale = (await readdir(outDir)).filter((f) => !keep.has(f));
  await Promise.all(stale.map((f) => rm(resolve(outDir, f))));
  if (stale.length) console.log(`${stale.length} old clips removed`);
  console.log(`${rendered} clips rendered, ${reused} reused → ${outDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  renderVoices(resolve(ROOT, process.argv[2] ?? 'site/public/bulletins/latest.json')).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
