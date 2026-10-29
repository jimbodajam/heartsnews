// Reads the starting XI off the club's own team-news graphic (issue #40): Hearts post it on X, Facebook and Instagram
// before BBC has the sheet (on 25 Oct, 13 minutes before; on 28 Oct, 10+), and BBC's early sheet can be wrong. One
// Gemini vision call per graphic; the answer is names as printed on it, to be matched against BBC's player ids later.
// Usage: npm run club-xi -- <image file> [--model gemini-flash-latest]

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { type ClubPost, fetchPosts, type InstagramAuth } from './club-post.ts';

export interface ClubXI {
  /** Names as printed, goalkeeper first, in the order the graphic reads (back to front). */
  starters: { name: string; number?: number; position?: string }[];
  bench: { name: string; number?: number }[];
  formation?: string;
  /** The team the graphic is for, if it says. */
  team?: string;
  opponent?: string;
  /** Anything the model couldn't read clearly. */
  unsure: string[];
}

const STR = { type: 'STRING' };
const PLAYER = { type: 'OBJECT', properties: { name: STR, number: { type: 'INTEGER' } }, required: ['name'] };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    team: STR,
    opponent: STR,
    formation: STR,
    starters: { type: 'ARRAY', items: { type: 'OBJECT', properties: { ...PLAYER.properties, position: STR }, required: ['name'] } },
    bench: { type: 'ARRAY', items: PLAYER },
    unsure: { type: 'ARRAY', items: STR },
  },
  required: ['starters', 'bench', 'unsure'],
};

const PROMPT = `This is a football club's team-news graphic. Read the starting XI and the substitutes off it.
- Starters: every player named in the starting line-up, goalkeeper first, then defenders, midfielders, forwards in the order
  the graphic lays them out. There should be eleven. Give the name exactly as printed (surname, or first name and surname if
  that is what is printed) and the shirt number if one is shown.
- Bench: the substitutes, if the graphic lists them.
- formation (e.g. "4-4-2") only if the graphic prints one. team and opponent only if it names them.
- Do not guess a name you cannot read, and do not add a player from your own knowledge: list anything unclear in "unsure".`;

export async function readClubXI(image: Buffer, mime = 'image/jpeg', model = 'gemini-flash-latest'): Promise<ClubXI> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: image.toString('base64') } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200).replace(/\s+/g, ' ')}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return JSON.parse(text) as ClubXI;
}

/** The post's image, saved at once. Falls back to a fresh read of the post if the signed URL has gone. */
export async function downloadPost(post: ClubPost, auth?: InstagramAuth, fetchFn: typeof fetch = fetch): Promise<{ image: Buffer; mime: string }> {
  const get = async (url: string) => {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`image: HTTP ${res.status}`);
    return { image: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg' };
  };
  try {
    if (post.mediaUrl) return await get(post.mediaUrl);
  } catch (err) {
    if (!auth) throw err;
  }
  if (!auth) throw new Error('the post has no image URL and there is no Instagram login to find it again');
  const fresh = (await fetchPosts(post.account, auth, 12, fetchFn)).find((p) => p.id === post.id);
  if (!fresh?.mediaUrl) throw new Error(`couldn't find the image for ${post.permalink} again`);
  return get(fresh.mediaUrl);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const envFile = new URL('../../.env', import.meta.url);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Usage: npm run club-xi -- <image file> [--model <name>]');
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : undefined;
  const mime = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
  console.log(JSON.stringify(await readClubXI(await readFile(file), mime, model), null, 2));
}
