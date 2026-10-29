// The fan phone-in (issue #9), first prototype: a post-match segment built from the game's Kickback thread (issue #62).
// Posts after full-time are read into the positions fans are arguing, callers are shared out in proportion to how many
// posts each position has, and the presenters take the calls. Callers are made-up composites: no usernames, no quotes.
// Usage: npm run phonein -- <posts.json> --ft 2026-10-28T21:45:00Z --result "Hearts 2-2 Rangers" [--hours 2] [--callers 5] [--audio]
//   posts.json: the rows of kickback_posts ({ id, ts, text, reply_to }), or wrangler's --json output for them.

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { geminiFromEnv, type ScriptModel } from './script/llm.ts';

export interface Post {
  id: number;
  ts: string;
  text: string;
  reply_to?: number | null;
}

export interface Position {
  /** What these fans are saying, in a sentence. */
  view: string;
  /** How many of the posts lean this way. */
  posts: number;
  /** "furious", "fed up", "upbeat", "calm" … */
  mood: string;
  /** Specifics fans cite for it. */
  points: string[];
}

export interface Caller {
  name: string;
  from: string;
  sex: 'm' | 'f';
  /** Index into the positions. */
  position: number;
}

export interface PhoneInLine {
  /** A presenter id, or "caller:N" for the Nth caller. */
  speaker: string;
  text: string;
}

export interface PhoneIn {
  positions: Position[];
  callers: Caller[];
  lines: PhoneInLine[];
}

const STR = { type: 'STRING' };

/** The posts that count: after full-time, up to `hours` later, and long enough to hold an opinion. */
export function postsAfter(posts: Post[], ft: Date, hours: number): Post[] {
  const end = ft.getTime() + hours * 3_600_000;
  return posts.filter((p) => {
    const t = Date.parse(p.ts);
    return t >= ft.getTime() && t <= end && p.text.trim().length >= 25;
  });
}

/** Share `n` callers out between positions in proportion to their posts (d'Hondt), at most `cap` to a position. */
export function shareCallers(positions: Position[], n: number, cap = 3): number[] {
  const given = positions.map(() => 0);
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestScore = -1;
    positions.forEach((p, j) => {
      const score = given[j] >= cap ? -1 : p.posts / (given[j] + 1);
      if (score > bestScore) {
        best = j;
        bestScore = score;
      }
    });
    if (best < 0) break;
    given[best]++;
  }
  return given;
}

function readPositions(posts: Post[]): { prompt: string; schema: object } {
  const list = posts.map((p) => `- ${p.text.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
  return {
    prompt: `These are fans' posts from a football supporters' forum after Hearts' match. Work out the 4 to 6 distinct
things fans are actually arguing or feeling, most popular first. For each: "view" is one plain sentence in your own words
(not a quote), "posts" is roughly how many of these ${posts.length} posts lean that way (the counts should add up to about
${posts.length} at most; a post can only count once), "mood" is one or two words, "points" is two or three specific things fans cite for it (a moment, a player, a stat), in your own words. Do not name any poster.

POSTS:
${list}`,
    schema: {
      type: 'OBJECT',
      properties: {
        positions: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { view: STR, posts: { type: 'INTEGER' }, mood: STR, points: { type: 'ARRAY', items: STR } }, required: ['view', 'posts', 'mood', 'points'] },
        },
      },
      required: ['positions'],
    },
  };
}

function writeCalls(positions: Position[], callers: Caller[], result: string, hoursAfter: number, personas: string): { prompt: string; schema: object } {
  const roster = callers.map((c, i) => `  caller:${i} ${c.name} from ${c.from}: ${positions[c.position].view} (mood: ${positions[c.position].mood}; they bring up: ${positions[c.position].points.join("; ")})`).join('\n');
  return {
    prompt: `Write the post-match phone-in on Hearts News 24, a Hearts fan TV channel. The game was ${result}; it finished about ${hoursAfter} hours ago.
The show is hosted by Isla (id "isla") with the pundits Fraser (id "fraser") and Ross (id "ross") taking calls.

${personas}

The callers, each phoning in to give the view shown (they are made-up fans: invent nothing about them beyond a name and
a bit of banter, and never use real usernames or quote anyone):
${roster}

Write 14 to 20 lines in order. Isla opens by welcoming viewers to the phone-in and saying what the lines are lit up about,
then goes to the first caller by name and place ("Davie from Gorgie, you're on Hearts News 24"). Each caller speaks 2 or 3
lines in all (speaker "caller:N"), the pundits answering them in character with Fraser and Ross disagreeing with each other
and sometimes with a caller; callers can answer back. Callers talk like Edinburgh fans on the phone: short, passionate,
sweary only mildly (no f-words, no slurs, nothing sectarian, no abuse of named people beyond blunt football criticism).
Callers must put it in their own words, never repeating the view sentence, and two callers sharing a view must raise different points or disagree on details. Keep it to what the views say, and facts only from the result above. Isla thanks the last caller and closes the segment
with a sentence; no sign-off for the whole show. Each line at most 45 words, plain speech, no stage directions.`,
    schema: {
      type: 'OBJECT',
      properties: { lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { speaker: STR, text: STR }, required: ['speaker', 'text'] } } },
      required: ['lines'],
    },
  };
}

const NAMES: [string, string, 'm' | 'f'][] = [
  ['Davie', 'Gorgie', 'm'],
  ['Senga', 'Saughton', 'f'],
  ['Kev', 'Wester Hailes', 'm'],
  ['Morag', 'Leith', 'f'],
  ['Big Tam', 'Dalry', 'm'],
  ['Shona', 'Tollcross', 'f'],
];

export async function buildPhoneIn(model: ScriptModel, posts: Post[], opts: { result: string; hoursAfter: number; callers: number; personas: string }): Promise<PhoneIn> {
  const read = readPositions(posts);
  const found = (await model.generateJson(read.prompt, read.schema, 'phonein-positions')) as { positions: Position[] };
  const positions = found.positions.filter((p) => p.view && p.posts > 0).sort((a, b) => b.posts - a.posts);
  const shares = shareCallers(positions, opts.callers);
  const callers: Caller[] = [];
  positions.forEach((_, position) => {
    for (let k = 0; k < shares[position]; k++) {
      const [name, from, sex] = NAMES[callers.length % NAMES.length];
      callers.push({ name, from, sex, position });
    }
  });
  const write = writeCalls(positions, callers, opts.result, opts.hoursAfter, opts.personas);
  const script = (await model.generateJson(write.prompt, write.schema, 'phonein-script')) as { lines: PhoneInLine[] };
  const valid = new Set(['isla', 'fraser', 'ross', ...callers.map((_, i) => `caller:${i}`)]);
  return { positions, callers, lines: script.lines.filter((l) => valid.has(l.speaker) && l.text.trim()) };
}

// A phone line: voice squeezed to the band a landline carried, a touch of grit.
export const PHONE_FILTER = 'highpass=f=350,lowpass=f=3200,acompressor=threshold=-18dB:ratio=4,volume=1.4';

/** Spare Kokoro voices for callers, none of them a presenter's. */
export const CALLER_VOICES = { m: ['am_adam', 'bm_fable', 'am_michael'], f: ['bf_lily', 'af_nicole', 'af_sarah'] };

/** Render the segment to one mp3 per line (callers through the phone filter), into `dir`. */
export async function renderPhoneIn(p: PhoneIn, dir: string, presenterVoices: Record<string, string>): Promise<string[]> {
  const { loadKokoro, renderClip } = await import('./voice.ts');
  const tts = await loadKokoro();
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const [i, l] of p.lines.entries()) {
    const caller = /^caller:(\d+)$/.exec(l.speaker);
    const c = caller ? p.callers[Number(caller[1])] : undefined;
    const voice = c ? CALLER_VOICES[c.sex][p.callers.slice(0, Number(caller![1])).filter((x) => x.sex === c.sex).length % 3] : presenterVoices[l.speaker];
    const file = resolve(dir, `${String(i).padStart(2, '0')}-${l.speaker.replace(':', '')}.mp3`);
    await renderClip(tts, l.text, voice, 1, file);
    if (caller) {
      const raw = file.replace(/\.mp3$/, '-raw.mp3');
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', PHONE_FILTER, raw]);
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-b:a', '96k', file]);
    }
    files.push(file);
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
  const file = args.find((a) => !a.startsWith('--') && args.indexOf(a) === 0);
  if (!file || !flag('ft') || !flag('result')) throw new Error('usage: phonein <posts.json> --ft <ISO time> --result "Hearts 2-2 Rangers" [--hours 2] [--callers 5] [--audio]');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const posts: Post[] = Array.isArray(raw) && raw[0]?.results ? raw[0].results : raw;
  const hours = Number(flag('hours') ?? 2);
  const window = postsAfter(posts, new Date(flag('ft')!), hours);
  if (window.length < 20) throw new Error('too few posts after full-time to build a phone-in');
  console.log(`${window.length} posts in the ${hours} hours after full-time`);
  // Flash-Lite alone: Flash's free daily quota is for the bulletins.
  const model = geminiFromEnv([120_000], ['gemini-flash-lite-latest']);
  if (!model) throw new Error('GEMINI_API_KEY is not set');
  const channel = JSON.parse(await readFile(resolve(import.meta.dirname, '../../channel.json'), 'utf8')) as {
    presenters: { id: string; name: string; persona: string; tts: { voice: string } }[];
  };
  const cast = channel.presenters.filter((p) => ['isla', 'fraser', 'ross'].includes(p.id));
  const personas = cast.map((p) => `${p.name} (id "${p.id}"): ${p.persona}`).join('\n');
  const dir = resolve(import.meta.dirname, '../../.cache/phonein');
  const out: PhoneIn = args.includes('--again') ? JSON.parse(await readFile(resolve(dir, 'phonein.json'), 'utf8')) : await buildPhoneIn(model, window, { result: flag('result')!, hoursAfter: hours, callers: Number(flag('callers') ?? 5), personas });
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'phonein.json'), JSON.stringify(out, null, 2));
  for (const c of out.callers) c.sex ??= NAMES.find((n) => n[0] === c.name)?.[2] ?? 'm';
  console.log(JSON.stringify(out.positions, null, 2));
  console.log(out.callers.map((c, i) => `caller:${i} ${c.name}, ${c.from} -> position ${c.position}`).join('\n'));
  for (const l of out.lines) console.log(`${l.speaker.padEnd(9)} ${l.text}`);
  if (args.includes('--audio')) {
    const voices = Object.fromEntries(cast.map((p) => [p.id, p.tts.voice]));
    console.log((await renderPhoneIn(out, dir, voices)).length, 'clips in', dir);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
