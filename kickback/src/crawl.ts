// The Kickback crawler (issue #62). The forum sits behind Cloudflare's bot check, which turns away Cloudflare's own Workers
// but lets a home connection through, so the fetching is done by a small loop on a home machine (tools/pi/kickback-fetch.sh)
// and every decision stays here. The loop asks `nextRequest` which page to fetch and when, fetches it, and hands what came
// back to `accept`, which stores the posts and moves the cursor. This is the one thing that decides what is fetched from the
// forum, so no feature can multiply its traffic: a cursor per thread (the last page is fetched again only to see what has
// been added), 2-3s between requests, a cap per five minutes and per day, polling slower as a thread goes quiet. Any 403,
// 429 or 503 is the kill switch: nothing more is handed out and the forum is left alone for a cool-off (6h, doubling on each
// repeat within a week).

import { parseThreadPage, threadTitle } from './parse.ts';
import type { Db, Post, Thread } from './types.ts';

const MIN = 60_000;
export const LIMITS = {
  /** Requests in any one window: a big backfill is spread over several. */
  perWindow: 10,
  windowMs: 5 * MIN,
  /** Requests in one UTC day. */
  perDay: 150,
  /** Between requests, with up to this much jitter on top. */
  gapMs: 2_000,
  jitterMs: 1_000,
  coolOffMs: 6 * 3_600_000,
  maxCoolOffMs: 7 * 86_400_000,
  /** A block this long ago no longer counts towards a longer cool-off. */
  strikesForgottenMs: 7 * 86_400_000,
  /** After a failure that isn't a refusal (network, odd page), nothing is handed out for this long. */
  errorPauseMs: 5 * MIN,
  /** A page handed out and never reported is given up on after this (and was counted when it was handed out). */
  pendingMs: 2 * MIN,
};
/** What the forum answers when it wants us gone. */
export const BLOCKED = new Set([403, 429, 503]);

/** How soon a thread is looked at again: while people are posting, often; once it has gone quiet, rarely. */
export function pollEvery(newestPostAt: string | undefined, now: number): number {
  const quiet = newestPostAt ? now - Date.parse(newestPostAt) : 0;
  return quiet < 2 * 3_600_000 ? 5 * MIN : quiet < 24 * 3_600_000 ? 30 * MIN : 6 * 3_600_000;
}

export interface Block {
  until: string;
  strikes: number;
  status: number;
  at: string;
  url: string;
  /** What the refusal looked like, to tell a Cloudflare challenge from the forum's own: a few headers and the start of the body. */
  detail?: { server?: string; cfRay?: string; cfMitigated?: string; contentType?: string; body?: string };
}
/** The last page reported back. */
export interface LastFetch {
  at: string;
  url: string;
  status: number;
  newPosts: number;
  /** Why the crawl stopped or paused, if this fetch made it. */
  stopped?: string;
}

interface Run {
  windowStart: number;
  count: number;
  lastRequestAt: number;
  pending?: { url: string; threadId: number; page: number; issuedAt: number };
}
interface Pause {
  until: string;
  why: string;
}

/** What the fetcher is told: a page to fetch after waiting, or that there is nothing to do yet. */
export type Next = { url: string; waitMs: number } | { idle: string; retryInSec: number };
/** What the fetcher reports. `status` 0 with an `error` means the request never got an answer. */
export interface Reply {
  url: string;
  status: number;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
}
export interface Outcome {
  accepted: boolean;
  newPosts: number;
  /** Set when the crawl will now hold off, and why. */
  stopped?: string;
}

type Row = Record<string, unknown>;
export const STATE_KEYS = { block: 'kickback_block', last: 'kickback_last', run: 'kickback_run', pause: 'kickback_pause', day: (d: string) => `kickback_requests:${d}` };

const json = <T>(v: unknown): T | undefined => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
};
const setState = (key: string, value: unknown, at: number) => ({
  sql: `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  params: [key, JSON.stringify(value), new Date(at).toISOString()],
});
const pageUrl = (base: string, page: number) => (page <= 1 ? base : `${base}${base.endsWith('/') ? '' : '/'}page/${page}/`);
const secondsUntil = (t: number, now: number) => Math.max(5, Math.ceil((t - now) / 1000));

/** The cool-off after a refusal: 6h, then 12h, 24h… while refusals keep coming within a week of each other. */
export function nextBlock(prev: Block | undefined, status: number, url: string, now: number, detail?: Block['detail']): Block {
  const strikes = prev && now - Date.parse(prev.at) < LIMITS.strikesForgottenMs ? prev.strikes + 1 : 1;
  const wait = Math.min(LIMITS.coolOffMs * 2 ** (strikes - 1), LIMITS.maxCoolOffMs);
  return { until: new Date(now + wait).toISOString(), strikes, status, at: new Date(now).toISOString(), url, ...(detail ? { detail } : {}) };
}

/** The page to fetch next and how long to wait before fetching it, or why there is nothing to fetch now. */
export async function nextRequest(db: Db, now: number, random: () => number = Math.random): Promise<Next> {
  const day = new Date(now).toISOString().slice(0, 10);
  const [state, threads] = await db.batch([
    { sql: `SELECT key, value FROM state WHERE key IN (?, ?, ?, ?)`, params: [STATE_KEYS.block, STATE_KEYS.run, STATE_KEYS.pause, STATE_KEYS.day(day)] },
    { sql: `SELECT id, url, next_page, caught_up, newest_post_at, last_crawled_at FROM kickback_threads WHERE watching = 1` },
  ]);
  const get = <T>(key: string) => json<T>(state.find((r) => r.key === key)?.value);
  const block = get<Block>(STATE_KEYS.block);
  if (block && Date.parse(block.until) > now) return { idle: `cooling off until ${block.until} (HTTP ${block.status})`, retryInSec: Math.min(secondsUntil(Date.parse(block.until), now), 600) };
  const pause = get<Pause>(STATE_KEYS.pause);
  if (pause && Date.parse(pause.until) > now) return { idle: `paused until ${pause.until}: ${pause.why}`, retryInSec: secondsUntil(Date.parse(pause.until), now) };
  const run = get<Run>(STATE_KEYS.run);
  if (run?.pending && now - run.pending.issuedAt < LIMITS.pendingMs) return { idle: 'waiting for the last page to be reported', retryInSec: 30 };

  const today = Number(get<number>(STATE_KEYS.day(day)) ?? 0);
  if (today >= LIMITS.perDay) return { idle: `day's cap of ${LIMITS.perDay} requests reached`, retryInSec: 3600 };
  const window = run && now - run.windowStart < LIMITS.windowMs ? run : { windowStart: now, count: 0, lastRequestAt: run?.lastRequestAt ?? 0 };
  if (window.count >= LIMITS.perWindow) return { idle: `${LIMITS.perWindow} requests in ${LIMITS.windowMs / MIN} minutes reached`, retryInSec: secondsUntil(window.windowStart + LIMITS.windowMs, now) };

  // A thread with pages still to fetch is always due; a caught-up thread waits for its polling gap. The longest-waiting goes first.
  const due = threads
    .filter((t) => !Number(t.caught_up) || !t.last_crawled_at || now - Date.parse(String(t.last_crawled_at)) >= pollEvery(t.newest_post_at as string | undefined, now))
    .sort((a, b) => String(a.last_crawled_at ?? '').localeCompare(String(b.last_crawled_at ?? '')))[0];
  if (!due) return { idle: 'nothing due', retryInSec: 60 };

  const page = Number(due.next_page);
  const url = pageUrl(String(due.url), page);
  const waitMs = Math.max(0, window.lastRequestAt + LIMITS.gapMs + random() * LIMITS.jitterMs - now);
  await db.batch([
    setState(STATE_KEYS.run, { windowStart: window.windowStart, count: window.count + 1, lastRequestAt: now + waitMs, pending: { url, threadId: Number(due.id), page, issuedAt: now } } satisfies Run, now),
    setState(STATE_KEYS.day(day), today + 1, now),
  ]);
  return { url, waitMs: Math.round(waitMs) };
}

/** The headers that say who refused us, and the first words of the page they sent (scripts, tags and runs of space dropped). */
function refusalDetail(reply: Reply): Block['detail'] {
  const header = (name: string) => reply.headers?.[name];
  const body = (reply.body ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const detail = { server: header('server'), cfRay: header('cf-ray'), cfMitigated: header('cf-mitigated'), contentType: header('content-type'), body: body || undefined };
  return Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined));
}

/** Takes what the fetcher got for the page it was handed: stores the posts and moves the cursor, or holds off. */
export async function accept(db: Db, reply: Reply, now: number): Promise<Outcome> {
  const [state] = await db.batch([{ sql: `SELECT key, value FROM state WHERE key IN (?, ?)`, params: [STATE_KEYS.block, STATE_KEYS.run] }]);
  const run = json<Run>(state.find((r) => r.key === STATE_KEYS.run)?.value);
  const pending = run?.pending;
  // Only the page that was handed out is taken: nothing else gets stored, whoever is asking.
  if (!run || !pending || pending.url !== reply.url) return { accepted: false, newPosts: 0 };
  const at = new Date(now).toISOString();
  const cleared = setState(STATE_KEYS.run, { ...run, pending: undefined } satisfies Run, now);
  const last = (status: number, newPosts: number, stopped?: string) => setState(STATE_KEYS.last, { at, url: reply.url, status, newPosts, ...(stopped ? { stopped } : {}) } satisfies LastFetch, now);
  const fail = async (message: string, stopped: string): Promise<Outcome> => {
    await db.batch([
      cleared,
      last(reply.status, 0, stopped),
      setState(STATE_KEYS.pause, { until: new Date(now + LIMITS.errorPauseMs).toISOString(), why: message } satisfies Pause, now),
      { sql: `UPDATE kickback_threads SET last_error = ?, last_crawled_at = ? WHERE id = ?`, params: [message, at, pending.threadId] },
    ]);
    return { accepted: true, newPosts: 0, stopped };
  };

  if (BLOCKED.has(reply.status)) {
    const block = nextBlock(json<Block>(state.find((r) => r.key === STATE_KEYS.block)?.value), reply.status, reply.url, now, refusalDetail(reply));
    const stopped = `blocked (HTTP ${reply.status}): cooling off until ${block.until}`;
    await db.batch([
      cleared,
      setState(STATE_KEYS.block, block, now),
      last(reply.status, 0, stopped),
      { sql: `UPDATE kickback_threads SET last_error = ?, last_crawled_at = ? WHERE id = ?`, params: [`HTTP ${reply.status}: the forum refused us`, at, pending.threadId] },
    ]);
    return { accepted: true, newPosts: 0, stopped };
  }
  if (reply.error || reply.status < 200 || reply.status >= 300) {
    const what = reply.error ? `couldn't reach the forum: ${reply.error}` : `HTTP ${reply.status}`;
    return fail(`${reply.url}: ${what}`, what);
  }

  const parsed = parseThreadPage(reply.body ?? '');
  if (!parsed.posts.length) return fail(`${reply.url}: no posts found (has the forum's layout changed?)`, 'no posts on the page');

  const [thread] = await db.batch([{ sql: `SELECT title, newest_post_at FROM kickback_threads WHERE id = ?`, params: [pending.threadId] }]);
  const title = (pending.page === 1 ? threadTitle(reply.body ?? '') : undefined) ?? String(thread[0]?.title ?? '');
  const newest = parsed.posts.reduce((m, p) => (!m || p.ts > m ? p.ts : m), thread[0]?.newest_post_at as string | undefined);
  const added = await save(db, pending.threadId, parsed.posts);
  // On to the next page while there is one; at the end the cursor stays on the last page, to see what is added to it.
  await db.batch([
    cleared,
    last(reply.status, added),
    {
      sql: `UPDATE kickback_threads SET title = ?, pages = ?, next_page = ?, caught_up = ?, newest_post_at = ?, last_crawled_at = ?, last_new = ?, last_error = NULL WHERE id = ?`,
      params: [title, parsed.pages, Math.min(pending.page + 1, parsed.pages), pending.page >= parsed.pages ? 1 : 0, newest ?? null, at, added, pending.threadId],
    },
  ]);
  return { accepted: true, newPosts: added };
}

/** Stores a page's posts; the ones we already have are left as they are. Returns how many were new. */
async function save(db: Db, threadId: number, posts: Post[]): Promise<number> {
  const count = { sql: `SELECT COUNT(*) AS n FROM kickback_posts WHERE thread_id = ?`, params: [threadId] };
  const inserts = posts.map((p) => ({
    sql: `INSERT OR IGNORE INTO kickback_posts (id, thread_id, ts, author, text, reply_to) VALUES (?, ?, ?, ?, ?, ?)`,
    params: [p.id, threadId, p.ts, p.author ?? null, p.text, p.replyTo ?? null],
  }));
  const results = await db.batch([count, ...inserts, count]);
  return Number(results[results.length - 1][0]?.n ?? 0) - Number(results[0][0]?.n ?? 0);
}

/** A thread and its posts, oldest first: the contract the rest of the project reads. `after` is a post id, for just what came later. */
export async function readThread(db: Db, id: number, opts: { after?: number; limit?: number } = {}): Promise<Thread | undefined> {
  const [thread, posts] = await db.batch([
    { sql: `SELECT id, title, url, pages FROM kickback_threads WHERE id = ?`, params: [id] },
    { sql: `SELECT id, ts, author, text, reply_to FROM kickback_posts WHERE thread_id = ? AND id > ? ORDER BY ts, id LIMIT ?`, params: [id, opts.after ?? 0, opts.limit ?? 5000] },
  ]);
  const t: Row | undefined = thread[0];
  if (!t) return undefined;
  return {
    id: Number(t.id),
    title: String(t.title),
    url: String(t.url),
    pages: Number(t.pages),
    posts: posts.map((p) => ({ id: Number(p.id), ts: String(p.ts), ...(p.author ? { author: String(p.author) } : {}), text: String(p.text), ...(p.reply_to ? { replyTo: Number(p.reply_to) } : {}) })),
  };
}
