// When the fan phone-in goes out (issue #9), and the glue to build it inside a programme build. Two a game, both only
// about that game: the evening one two hours after full-time, and the morning-after one on the show from 7 to noon.
// A programme build calls dueNow() with what the store says has aired; if one is due it reads the game's Kickback match
// thread from the store, builds the phone-in (phonein.ts) and, once the programme is saved, records it as aired.

import { buildPhoneIn, postsAfter, type Post, type PhoneIn } from './phonein.ts';
import type { ScriptModel } from './script/llm.ts';
import type { Store } from './store.ts';
import type { Fixture } from './types.ts';

export type PhoneInKind = 'evening' | 'morning';

export interface PhoneInDue {
  kind: PhoneInKind;
  /** The store key that says it has aired. */
  key: string;
  /** Posts from here on count: full time, or two hours after it for the morning. */
  from: Date;
  /** Hours since full time, for the writer ("a couple of hours ago"). */
  hoursAfter: number;
}

/** Full time is about 1h55 after kick-off (ninety minutes, the break and the added time). */
export const FULL_TIME_MS = 115 * 60_000;
const HOUR = 3_600_000;
/** The evening one can still go out up to this long after full time if a slot was missed. */
const EVENING_UNTIL_MS = 8 * HOUR;
/** The morning one airs between these London hours. */
const MORNING = [7, 12];

const london = (d: Date) => ({
  day: d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' }),
  hour: Number(d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false })) % 24,
});

/** Which phone-in, if any, is due now for this finished game, given the keys that have aired. */
export function dueNow(game: Fixture, now: Date, aired: Set<string>): PhoneInDue | undefined {
  const ko = Date.parse(game.date);
  if (!Number.isFinite(ko) || game.homeScore === undefined) return undefined;
  const ft = new Date(ko + FULL_TIME_MS);
  const since = now.getTime() - ft.getTime();
  const evening = `phonein:${game.date}:evening`;
  if (since >= 2 * HOUR && since < EVENING_UNTIL_MS && !aired.has(evening)) {
    return { kind: 'evening', key: evening, from: ft, hoursAfter: Math.round(since / HOUR) };
  }
  const morning = `phonein:${game.date}:morning`;
  const [today, then] = [london(now), london(ft)];
  const nextDay = new Date(`${then.day}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  if (today.day === nextDay.toISOString().slice(0, 10) && today.hour >= MORNING[0] && today.hour < MORNING[1] && !aired.has(morning)) {
    return { kind: 'morning', key: morning, from: new Date(ft.getTime() + 2 * HOUR), hoursAfter: Math.round(since / HOUR) };
  }
  return undefined;
}

export async function airedPhoneIns(store: Store): Promise<Set<string>> {
  const [rows] = await store.batch([{ sql: "SELECT key FROM state WHERE key LIKE 'phonein:%'" }]);
  return new Set(rows.map((r) => String(r.key)));
}

export async function markAired(store: Store, key: string, now: Date): Promise<void> {
  await store.batch([
    {
      sql: 'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      params: [key, JSON.stringify(true), now.toISOString()],
    },
  ]);
}

/** The game's posts from the crawler: its match thread is the one whose title names the opponent. */
/** Other names the forum uses for a club (BBC says "Hibernian", the fixtures list may say "Hibs"). */
const ALSO: Record<string, string> = { hibs: 'hibernian', hibernian: 'hibs', 'dundee utd': 'dundee united', 'dundee united': 'dundee utd' };

export async function loadGamePosts(store: Store, opponent: string): Promise<Post[]> {
  const name = opponent.toLowerCase().replace(/[%_]/g, '');
  const [rows] = await store.batch([
    {
      sql: `SELECT p.id, p.ts, p.text, p.reply_to FROM kickback_posts p JOIN kickback_threads t ON t.id = p.thread_id
            WHERE lower(t.title) LIKE '%match thread%' AND (lower(t.title) LIKE ? OR lower(t.title) LIKE ?) ORDER BY p.ts`,
      params: [`%${name}%`, `%${ALSO[name] ?? name}%`],
    },
  ]);
  return rows.map((r) => ({ id: Number(r.id), ts: String(r.ts), text: String(r.text), reply_to: r.reply_to == null ? null : Number(r.reply_to) }));
}

export const MIN_POSTS = 20;

/** Builds the due phone-in, or says why not (too few posts so far: tried again next slot). */
export async function buildDue(
  store: Store,
  model: ScriptModel,
  game: Fixture,
  opponent: string,
  due: PhoneInDue,
  now: Date,
  opts: { result: string; personas: string },
): Promise<PhoneIn | undefined> {
  const posts = postsAfter(await loadGamePosts(store, opponent), due.from, Math.max(1, (now.getTime() - due.from.getTime()) / 3_600_000));
  if (posts.length < MIN_POSTS) {
    console.log(`Phone-in (${due.kind}) due, but only ${posts.length} posts from the Kickback after full time: not yet`);
    return undefined;
  }
  console.log(`Phone-in (${due.kind}): ${posts.length} Kickback posts to build it from`);
  return buildPhoneIn(model, posts, { ...opts, hoursAfter: due.hoursAfter, callers: 5 });
}
