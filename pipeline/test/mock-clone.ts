// Writes site/public/bulletins/clone-test/bulletin.json: the live bulletin with its speakers' voices refreshed from channel.json and adverts.json
// (so the cloned voices apply) and every line voiced through the real voiceLines(), to try cloned voices end to end with the graphics.
// Play it at ?bulletin=bulletins/clone-test/bulletin.json. Its own folder, so the live bulletin's clips are left alone.
// Usage: npx tsx pipeline/test/mock-clone.ts [path/to/bulletin.json]   (default: the live bulletin)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Bulletin, Presenter } from '../../shared/bulletin.ts';
import { dropUnusedClips, voiceLines } from '../src/voice.ts';

const rd = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const source = process.argv[2] ?? '../../site/public/bulletins/latest.json';
const bulletin = rd(source) as Bulletin;
const channel = rd('../../channel.json') as { presenters: Presenter[] };
const adverts = rd('../../adverts.json') as { voices: Presenter[] };

// The bulletin carries the voices it was built with; use today's.
const current = new Map([...channel.presenters, ...adverts.voices].map((p) => [p.id, p.tts]));
for (const p of bulletin.presenters) if (current.has(p.id)) p.tts = current.get(p.id);

const dir = fileURLToPath(new URL('../../site/public/bulletins/clone-test/', import.meta.url));
mkdirSync(dir, { recursive: true });
const lines = bulletin.segments.flatMap((s) => s.lines);
const started = Date.now();
const { rendered, reused } = await voiceLines(bulletin.presenters, lines, dir);
const seconds = (Date.now() - started) / 1000;
const stale = await dropUnusedClips(lines, dir);
writeFileSync(`${dir}bulletin.json`, `${JSON.stringify(bulletin, null, 2)}\n`);
console.log(`${lines.length} lines: ${rendered} rendered, ${reused} reused, ${stale} old clips removed, voicing took ${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`);
console.log('Play it at ?bulletin=bulletins/clone-test/bulletin.json');
