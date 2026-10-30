// Spike: render the lines of site/pixel-broadcast-spike.html with the presenters' Kokoro voices.
// Usage: npx tsx pipeline/src/spike-voice.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadKokoro, renderClip, CLIP_EXT } from './voice.ts';

const OUT = fileURLToPath(new URL('../../site/public/spike/audio/', import.meta.url));
const VOICES = { a: 'bf_emma', b: 'bm_george' } as const;
const LINES: { by: 'a' | 'b'; text: string }[] = [
  { by: 'a', text: 'Good evening, and welcome to Hearts News 24. I am Isla.' },
  { by: 'a', text: 'Our top story: Hearts will keep playing at Tynecastle for the foreseeable future.' },
  { by: 'b', text: 'That is right, Isla. A deal with the council was signed this afternoon, and the club say the pitch is safe.' },
  { by: 'a', text: 'Fraser, supporters have waited a long time for this. What does it mean for the squad?' },
  { by: 'b', text: 'Stability, mostly. The manager wants no distractions before the weekend, and this removes one.' },
  { by: 'a', text: 'We will have reaction from the fans later in the programme.' },
  { by: 'b', text: 'Stay with us. This is Hearts News 24.' },
];

await mkdir(OUT, { recursive: true });
const tts = await loadKokoro();
const files: { by: string; text: string; file: string }[] = [];
for (const [i, l] of LINES.entries()) {
  const file = `line${i}.${CLIP_EXT}`;
  await renderClip(tts, l.text, VOICES[l.by], 1, OUT + file);
  files.push({ ...l, file });
  console.log('rendered', file);
}
await writeFile(OUT + 'lines.json', JSON.stringify(files, null, 2));
