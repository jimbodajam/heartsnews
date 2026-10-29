// The Kickback crawler (issue #62). The one thing that fetches from the forum, so no feature can multiply its traffic.
// It keeps a cursor per thread (the page to fetch next) and never refetches a page it has finished with; the last page
// is fetched again only to see what has been added. Polite: 2-3s between requests, a cap per run and per day, polling
// slower as a thread goes quiet. Any 403, 429 or 503 is the kill switch: the run stops at once, with no retry, and the
// forum is left alone for a cool-off (6h, doubling on each repeat within a week).

import { parseThreadPage, threadTitle } from './parse.ts';
import type { Db, Post, Thread } from './types.ts';

export const LIMITS = {
  /** Requests in one run, across all threads. A big backfill is spread over several runs. */
  perRun: 10,
  /** Requests in one UTC day. */
  perDay: 150,
  /** Between requests, with up to this much jitter on top. */
  gapMs: 2_000,
  jitterMs: 1_000,
  coolOffMs: 6 * 3_600_000,
  maxCoolOffMs: 7 * 86_400_000,
  /** A block this long ago no longer counts towards a longer cool-off. */
  strikesForgottenMs: 7 * 86_400_000,
};
/** What the forum answers when it wants us gone. */
export const BLOCKED = new Set([403, 429, 503]);

const MIN = 60_000;
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
export interface RunReport {
  at: string;
  requests: number;
  newPosts: number;
  /** Why it stopped early, if it did. */
  stopped?: string;
}

export interface Deps {
  fetchPage(url: string): Promise<{ status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }>;
  sleep(ms: number): Promise<void>;
  random(): number;
  now(): number;
}

type Row = Record<string, unknown>;
export const STATE_KEYS = { block: 'kickback_block', last: 'kickback_last_run', day: (d: string) => `kickback_requests:${d}` };

const json = <T>(v: unknown): T | undefined => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
};
const setState = (key: string, value: unknown, at: string) => ({
  sql: `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  params: [key, JSON.stringify(value), at],
});
const pageUrl = (base: string, page: number) => (page <= 1 ? base : `${base}${base.endsWith('/') ? '' : '/'}page/${page}/`);

/** The cool-off after a refusal: 6h, then 12h, 24h… while refusals keep coming within a week of each other. */
export function nextBlock(prev: Block | undefined, status: number, url: string, now: number, detail?: Block['detail']): Block {
  const strikes = prev && now - Date.parse(prev.at) < LIMITS.strikesForgottenMs ? prev.strikes + 1 : 1;
  const wait = Math.min(LIMITS.coolOffMs * 2 ** (strikes - 1), LIMITS.maxCoolOffMs);
  return { until: new Date(now + wait).toISOString(), strikes, status, at: new Date(now).toISOString(), url, ...(detail ? { detail } : {}) };
}

/** One run: fetches what is due, within the caps, and says what it did. */
export async function crawl(db: Db, deps: Deps): Promise<RunReport> {
  const started = deps.now();
  const at = new Date(started).toISOString();
  const day = at.slice(0, 10);
  const report: RunReport = { at, requests: 0, newPosts: 0 };
  const finish = async (stopped?: string): Promise<RunReport> => {
    if (stopped) report.stopped = stopped;
    await db.batch([setState(STATE_KEYS.last, report, new Date(deps.now()).toISOString())]);
    return report;
  };

  const [state, threads] = await db.batch([
    { sql: `SELECT key, value FROM state WHERE key IN (?, ?)`, params: [STATE_KEYS.block, STATE_KEYS.day(day)] },
    { sql: `SELECT id, title, url, pages, next_page, newest_post_at, last_crawled_at FROM kickback_threads WHERE watching = 1` },
  ]);
  const block = json<Block>(state.find((r) => r.key === STATE_KEYS.block)?.value);
  if (block && Date.parse(block.until) > started) return finish(`cooling off until ${block.until} (HTTP ${block.status} on ${block.url})`);
  let today = Number(json<number>(state.find((r) => r.key === STATE_KEYS.day(day))?.value) ?? 0);

  // Catching up on a backlog is always due; a caught-up thread waits for its polling gap. The longest-waiting goes first.
  const due = threads
    .filter((t) => Number(t.next_page) < Number(t.pages) || !t.last_crawled_at || started - Date.parse(String(t.last_crawled_at)) >= pollEvery(t.newest_post_at as string | undefined, started))
    .sort((a, b) => String(a.last_crawled_at ?? '').localeCompare(String(b.last_crawled_at ?? '')));
  if (!due.length) return report;

  for (const t of due) {
    let page = Number(t.next_page);
    let pages = Number(t.pages);
    let title = String(t.title);
    let newest = (t.newest_post_at as string | undefined) ?? undefined;
    for (;;) {
      if (report.requests >= LIMITS.perRun) return finish(`per-run cap of ${LIMITS.perRun} requests`);
      if (today >= LIMITS.perDay) return finish(`day's cap of ${LIMITS.perDay} requests`);
      if (report.requests) await deps.sleep(LIMITS.gapMs + deps.random() * LIMITS.jitterMs);

      const url = pageUrl(String(t.url), page);
      report.requests++;
      today++;
      let res: Awaited<ReturnType<Deps['fetchPage']>>;
      try {
        res = await deps.fetchPage(url);
      } catch (err) {
        await recordError(db, t.id, `${url}: ${(err as Error).message}`, deps.now());
        return finish(`couldn't reach the forum: ${(err as Error).message}`);
      }
      if (BLOCKED.has(res.status)) {
        const next = nextBlock(block, res.status, url, deps.now(), await refusalDetail(res));
        await db.batch([setState(STATE_KEYS.block, next, next.at), setState(STATE_KEYS.day(day), today, at)]);
        await recordError(db, t.id, `HTTP ${res.status}: the forum refused us`, deps.now());
        return finish(`blocked (HTTP ${res.status}): cooling off until ${next.until}`);
      }
      if (res.status < 200 || res.status >= 300) {
        await db.batch([setState(STATE_KEYS.day(day), today, at)]);
        await recordError(db, t.id, `${url}: HTTP ${res.status}`, deps.now());
        return finish(`HTTP ${res.status} on ${url}`);
      }

      const html = await res.text();
      const parsed = parseThreadPage(html);
      if (!parsed.posts.length) {
        await db.batch([setState(STATE_KEYS.day(day), today, at)]);
        await recordError(db, t.id, `${url}: no posts found (has the forum's layout changed?)`, deps.now());
        return finish(`no posts on ${url}`);
      }
      pages = parsed.pages;
      title = (page === 1 ? threadTitle(html) : undefined) ?? title;
      const added = await save(db, Number(t.id), parsed.posts);
      report.newPosts += added;
      newest = parsed.posts.reduce((m, p) => (!m || p.ts > m ? p.ts : m), newest);
      // On to the next page while there is one; at the end the cursor stays on the last page, to see what is added to it.
      const next = Math.min(page + 1, pages);
      const now = new Date(deps.now()).toISOString();
      await db.batch([
        setState(STATE_KEYS.day(day), today, now),
        {
          sql: `UPDATE kickback_threads SET title = ?, pages = ?, next_page = ?, newest_post_at = ?, last_crawled_at = ?, last_new = ?, last_error = NULL WHERE id = ?`,
          params: [title, pages, next, newest ?? null, now, added, t.id],
        },
      ]);
      if (page >= pages) break;
      page = next;
    }
  }
  return finish();
}

/** The headers that say who refused us, and the first words of the page they sent (scripts, tags and runs of space dropped). */
async function refusalDetail(res: Awaited<ReturnType<Deps['fetchPage']>>): Promise<Block['detail']> {
  const header = (name: string) => res.headers?.get(name) ?? undefined;
  const body = await res.text().then(
    (t) => t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
    () => undefined,
  );
  const detail = { server: header('server'), cfRay: header('cf-ray'), cfMitigated: header('cf-mitigated'), contentType: header('content-type'), body: body || undefined };
  return Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined));
}

async function recordError(db: Db, id: unknown, message: string, now: number) {
  await db.batch([{ sql: `UPDATE kickback_threads SET last_error = ?, last_crawled_at = ? WHERE id = ?`, params: [message, new Date(now).toISOString(), id] }]);
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

/** The real forum, as the rest of the project fetches it. */
export const liveDeps = (): Deps => ({
  fetchPage: (url) => fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; HeartsNews24/0.1; hobby fan project)', accept: '*/*' }, signal: AbortSignal.timeout(15_000) }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
  now: Date.now,
});
