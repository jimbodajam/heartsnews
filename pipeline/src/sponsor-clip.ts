// Renders the sponsor announcer's lines once, as static clips the player plays at the show open and around ad breaks:
// the "in association with" line. (The jingle is a recording, site/public/sponsor/jingle*.mp3.)
// Usage: npm run sponsor-clip [-- bm_lewis bm_fable]   (writes site/public/sponsor/marshalls-<voice>.mp3)

import { spawnSync } from 'node:child_process';
import { mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIP_EXT, loadKokoro, renderClip } from './voice.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SPONSOR_LINE = "Hearts News 24, in association with Marshall's Chunky Chicken.";

/** Kokoro pads its clips with silence; trim it so the line and the beat land where the card says. */
async function trim(file: string): Promise<void> {
  const tmp = file.replace(/(\.\w+)$/, '.trim$1');
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', 'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05,areverse', tmp]);
  if (res.status === 0) await rename(tmp, file);
}

async function main() {
  const voices = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!voices.length) voices.push('bm_lewis');
  const dir = resolve(ROOT, 'site/public/sponsor');
  await mkdir(dir, { recursive: true });
  const tts = await loadKokoro();
  for (const voice of voices) {
    for (const [name, text, speed] of [['marshalls', SPONSOR_LINE, 1]] as const) {
      const file = resolve(dir, `${name}-${voice}.${CLIP_EXT}`);
      await renderClip(tts, text, voice, speed, file);
      await trim(file);
    }
    console.log(`  ${voice} done`);
  }
}

await main();
