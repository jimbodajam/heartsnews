// The Kickback crawler (issue #62): reading a thread page, the ask/fetch/report protocol the fetcher at home follows (a polite
// first pull, then an incremental one), the caps, the kill switch, and the endpoints and admin view. The forum is a stand-in
// that serves pages we write here; run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accept, LIMITS, nextBlock, nextRequest, pollEvery, readThread, type Reply } from '../../kickback/src/crawl.ts';
import { parseThreadPage, threadTitle } from '../../kickback/src/parse.ts';
import type { Db } from '../../kickback/src/types.ts';
import { admin, kickbackData, renderKickback } from '../../worker/src/admin.ts';
import { kickback } from '../../worker/src/kickback.ts';
import { memoryD1 } from './d1.ts';

const BASE = 'https://forum.test/topic/9-match-thread/';
const T0 = Date.parse('2026-10-28T20:00:00Z');

interface FakePost {
  id: number;
  at: number;
  by: string;
  html: string;
}
const post = (id: number, minute: number, html = `<p>Post ${id}</p>`, by = `fan${id}`): FakePost => ({ id, at: T0 + minute * 60_000, by, html });

/** A page the way Invision Community serves it. */
function pageHtml(title: string, page: number, pages: number, posts: FakePost[]): string {
  const articles = posts
    .map((p) => {
      const meta = JSON.stringify({ userid: 1, username: p.by, timestamp: Math.floor(p.at / 1000), contentid: 9, contentcommentid: p.id }).replace(/"/g, '&quot;');
      return `<article  id="elComment_${p.id}" class="cPost">
<div id='comment-${p.id}_wrap' data-commentID="${p.id}" data-quoteData='${meta}'><time datetime='${new Date(p.at).toISOString()}'>x</time>
<div data-role='commentContent' class='ipsType_richText'>${p.html}</div></div></article>
<a id="findComment-${p.id}"></a>`;
    })
    .join('\n');
  return `<html><head><title>${title} - Page ${page} - The Terrace - Jambos Kickback</title></head><body><ul data-pages='${pages}'></ul>${articles}</body></html>`;
}

const CHALLENGE = '<html><script>x()</script><body><h1>Just a moment...</h1>  Checking your browser</body></html>';

/** A thread of posts split into pages of `size`, as the fetcher at home would find it. */
function forum(all: FakePost[], size = 3) {
  const state = { status: 200 };
  return {
    all,
    state,
    requests: [] as string[],
    /** What the fetcher reports for a URL. */
    fetch(url: string): Reply {
      this.requests.push(url);
      const n = Number(/page\/(\d+)\/$/.exec(url)?.[1] ?? 1);
      if (state.status !== 200) return { url, status: state.status, headers: { server: 'cloudflare', 'cf-mitigated': 'challenge' }, body: CHALLENGE };
      return { url, status: 200, body: pageHtml('Official Match Thread', n, Math.max(1, Math.ceil(all.length / size)), all.slice((n - 1) * size, n * size)) };
    },
  };
}

const fresh = () => {
  const d1 = memoryD1();
  const db: Db = { batch: async (statements) => (await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...(s.params ?? []))))).map((r) => (r.results ?? []) as Record<string, unknown>[]) };
  d1.db.exec(`DELETE FROM kickback_threads`);
  d1.db.prepare(`INSERT INTO kickback_threads (id, title, url) VALUES (9, 'Match thread', ?)`).run(BASE);
  return { d1, db };
};
const count = (d1: ReturnType<typeof memoryD1>) => Number((d1.db.prepare(`SELECT COUNT(*) AS n FROM kickback_posts`).get() as { n: number }).n);
const stateOf = (d1: ReturnType<typeof memoryD1>, key: string) => {
  const row = d1.db.prepare(`SELECT value FROM state WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
};

/** The fetcher's loop: ask, wait, fetch, report; until the Worker says there is nothing to do. */
async function pull(db: Db, f: ReturnType<typeof forum>, clock: { t: number }, waits: number[] = []) {
  const out = { fetched: 0, newPosts: 0, idle: '' };
  for (;;) {
    const next = await nextRequest(db, clock.t, () => 0.5);
    if ('idle' in next) return { ...out, idle: next.idle };
    waits.push(next.waitMs);
    clock.t += next.waitMs;
    const r = await accept(db, f.fetch(next.url), clock.t);
    out.fetched++;
    out.newPosts += r.newPosts;
    if (r.stopped) return { ...out, idle: r.stopped };
  }
}

test('a thread page gives each post its id, time, author and words, with quotes taken out and the quoted post noted', () => {
  const quote = (id: number, inner: string) =>
    `<blockquote class="ipsQuote" data-ipsquote="" data-ipsquote-contentcommentid="${id}" data-ipsquote-username="Gundermann"><div>${inner}</div></blockquote>`;
  const html = pageHtml('Official Match Thread', 3, 38, [
    post(11, 0, '<p>Plain &amp; simple</p>'),
    post(12, 1, `${quote(11, `<p>Plain</p>${quote(5, '<p>deeper</p>')}`)}<p>Agreed, <b>mate</b>.</p>`),
    post(13, 2, quote(12, '<p>only a quote</p>')),
  ]);
  const { pages, posts } = parseThreadPage(html);
  assert.equal(pages, 38);
  assert.deepEqual(posts[0], { id: 11, ts: '2026-10-28T20:00:00.000Z', author: 'fan11', text: 'Plain & simple' });
  assert.deepEqual(posts[1], { id: 12, ts: '2026-10-28T20:01:00.000Z', author: 'fan12', text: 'Agreed, mate .', replyTo: 11 });
  assert.equal(posts[2].text, '');
  assert.equal(posts[2].replyTo, 12);
  assert.equal(threadTitle(html), 'Official Match Thread');
});

test('the first pull takes the whole thread politely, then later pulls fetch only what is new', async () => {
  const { d1, db } = fresh();
  const f = forum(Array.from({ length: 8 }, (_, i) => post(100 + i, i)));
  const clock = { t: T0 + 60 * 60_000 };
  const waits: number[] = [];

  const first = await pull(db, f, clock, waits);
  assert.equal(first.fetched, 3);
  assert.equal(first.newPosts, 8);
  assert.equal(count(d1), 8);
  assert.deepEqual(f.requests, [BASE, `${BASE}page/2/`, `${BASE}page/3/`]);
  assert.deepEqual(waits, [0, 2500, 2500]); // 2-3s between requests (jitter at its midpoint here), none before the first
  assert.equal(first.idle, 'nothing due');

  // A minute on: nothing is due.
  clock.t += 60_000;
  assert.equal((await pull(db, f, clock)).fetched, 0);

  // Six minutes on, with two new posts: only the last page is fetched again (it holds the first of them), then the new page.
  f.all.push(post(108, 62), post(109, 63));
  clock.t += 6 * 60_000;
  const second = await pull(db, f, clock);
  assert.deepEqual(f.requests.slice(3), [`${BASE}page/3/`, `${BASE}page/4/`]);
  assert.equal(second.newPosts, 2);
  assert.equal(count(d1), 10);

  const thread = await readThread(db, 9);
  assert.equal(thread!.title, 'Official Match Thread');
  assert.equal(thread!.pages, 4);
  assert.deepEqual(thread!.posts.map((p) => p.id), [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  assert.deepEqual((await readThread(db, 9, { after: 107 }))!.posts.map((p) => p.id), [108, 109]);
});

test('a big backfill is spread over several windows by the cap', async () => {
  const { d1, db } = fresh();
  const f = forum(Array.from({ length: 36 }, (_, i) => post(200 + i, i)), 3); // 12 pages
  const clock = { t: T0 + 3 * 3_600_000 };
  const a = await pull(db, f, clock);
  assert.equal(a.fetched, LIMITS.perWindow);
  assert.match(a.idle, /10 requests in 5 minutes/);
  assert.equal(count(d1), 30);
  // Still the same window: told when to come back, nothing handed out.
  const early = await nextRequest(db, clock.t + 1000);
  assert.ok('idle' in early && early.retryInSec > 60);
  // The next window takes the rest, without fetching page 1 again.
  clock.t += LIMITS.windowMs;
  const b = await pull(db, f, clock);
  assert.equal(b.fetched, 2);
  assert.equal(count(d1), 36);
  assert.equal(f.requests.filter((u) => u === BASE).length, 1);
});

test('the day cap stops the hand-out', async () => {
  const { d1, db } = fresh();
  d1.db.prepare(`INSERT INTO state (key, value, updated_at) VALUES (?, ?, 'x')`).run('kickback_requests:2026-10-28', String(LIMITS.perDay));
  const next = await nextRequest(db, T0 + 3_600_000);
  assert.ok('idle' in next && /day's cap/.test(next.idle));
});

test('a 429 stops everything with no retry, and the forum is left alone for a cool-off that grows', async () => {
  const { d1, db } = fresh();
  const f = forum(Array.from({ length: 9 }, (_, i) => post(300 + i, i)));
  const clock = { t: T0 + 3_600_000 };

  f.state.status = 429;
  const hit = await pull(db, f, clock);
  assert.equal(hit.fetched, 1);
  assert.match(hit.idle, /blocked \(HTTP 429\)/);
  assert.equal(f.requests.length, 1, 'no retry');
  assert.match((d1.db.prepare(`SELECT last_error FROM kickback_threads WHERE id = 9`).get() as { last_error: string }).last_error, /429/);
  const block = stateOf(d1, 'kickback_block');
  assert.equal(block.until, new Date(clock.t + 6 * 3_600_000).toISOString());
  assert.equal(block.strikes, 1);
  assert.deepEqual(block.detail, { server: 'cloudflare', cfMitigated: 'challenge', body: 'Just a moment... Checking your browser' });
  assert.match(renderKickback(await kickbackData(d1, undefined, 1, clock.t)), /Just a moment/);

  // Even with the forum well again, nothing is handed out until the cool-off is over.
  f.state.status = 200;
  clock.t += 5 * 3_600_000;
  assert.equal((await pull(db, f, clock)).fetched, 0);
  assert.equal(f.requests.length, 1);

  // Over, and it is refused again: 12 hours this time.
  clock.t += 2 * 3_600_000;
  f.state.status = 403;
  await pull(db, f, clock);
  const again = stateOf(d1, 'kickback_block');
  assert.equal(again.strikes, 2);
  assert.equal(again.until, new Date(clock.t + 12 * 3_600_000).toISOString());

  // After that the crawl carries on from where it was.
  f.state.status = 200;
  clock.t += 13 * 3_600_000;
  const back = await pull(db, f, clock);
  assert.equal(back.newPosts, 9);
  assert.equal(count(d1), 9);
});

test('503 is a block too, and a block a week old no longer lengthens the next', () => {
  const now = T0;
  const first = nextBlock(undefined, 503, 'u', now);
  assert.equal(first.strikes, 1);
  assert.equal(nextBlock(first, 429, 'u', now + 3_600_000).strikes, 2);
  assert.equal(nextBlock(first, 429, 'u', now + 8 * 86_400_000).strikes, 1);
  assert.equal(Date.parse(nextBlock({ ...first, strikes: 20 }, 429, 'u', now + 1000).until) - (now + 1000), LIMITS.maxCoolOffMs);
});

test('other failures pause the hand-out for a few minutes without a cool-off, and a page with no posts is reported rather than stored', async () => {
  const { d1, db } = fresh();
  const f = forum([post(1, 0)]);
  const clock = { t: T0 + 3_600_000 };

  f.state.status = 500;
  const r = await pull(db, f, clock);
  assert.match(r.idle, /HTTP 500/);
  assert.equal(stateOf(d1, 'kickback_block'), undefined);
  const paused = await nextRequest(db, clock.t + 60_000);
  assert.ok('idle' in paused && /paused until/.test(paused.idle));

  clock.t += LIMITS.errorPauseMs + 1000;
  const next = await nextRequest(db, clock.t, () => 0);
  assert.ok('url' in next, 'handed out again after the pause');
  const odd = await accept(db, { url: (next as { url: string }).url, status: 200, body: '<html>a login wall</html>' }, clock.t);
  assert.match(odd.stopped!, /no posts/);
  assert.equal(count(d1), 0);

  clock.t += LIMITS.errorPauseMs + 1000;
  const next2 = await nextRequest(db, clock.t, () => 0);
  assert.ok('url' in next2);
  const lost = await accept(db, { url: (next2 as { url: string }).url, status: 0, error: 'connection reset' }, clock.t);
  assert.match(lost.stopped!, /couldn't reach the forum: connection reset/);
});

test('only the page that was handed out is taken, and only once', async () => {
  const { d1, db } = fresh();
  const f = forum([post(1, 0), post(2, 1)]);
  const clock = { t: T0 + 3_600_000 };
  // Nothing handed out yet: a report is refused.
  assert.equal((await accept(db, f.fetch(BASE), clock.t)).accepted, false);
  const next = (await nextRequest(db, clock.t)) as { url: string };
  // Another page, or a second request while one is out, gets nothing.
  assert.equal((await accept(db, f.fetch(`${BASE}page/5/`), clock.t)).accepted, false);
  const waiting = await nextRequest(db, clock.t + 1000);
  assert.ok('idle' in waiting && /waiting for the last page/.test(waiting.idle));
  assert.equal(count(d1), 0);
  assert.equal((await accept(db, f.fetch(next.url), clock.t)).accepted, true);
  assert.equal((await accept(db, f.fetch(next.url), clock.t)).accepted, false, 'reported twice');
  assert.equal(count(d1), 2);
  // A page handed out and never reported is given up on, but was counted.
  clock.t += 6 * 60_000;
  await nextRequest(db, clock.t);
  clock.t += LIMITS.pendingMs + 1000;
  assert.ok('url' in (await nextRequest(db, clock.t)));
  assert.equal(stateOf(d1, `kickback_requests:${new Date(clock.t).toISOString().slice(0, 10)}`), 3);
});

test('a thread is looked at less often as it goes quiet', () => {
  const now = T0;
  assert.equal(pollEvery(new Date(now - 30 * 60_000).toISOString(), now), 5 * 60_000);
  assert.equal(pollEvery(new Date(now - 5 * 3_600_000).toISOString(), now), 30 * 60_000);
  assert.equal(pollEvery(new Date(now - 3 * 86_400_000).toISOString(), now), 6 * 3_600_000);
});

test('the endpoints want their own token and hand the fetcher one page at a time', async () => {
  const { d1, db } = fresh();
  const f = forum([post(1, 0), post(2, 1)]);
  const env = { DB: d1, KICKBACK_TOKEN: 'k' };
  const clock = T0 + 3_600_000;
  const call = (path: string, init: RequestInit = {}, token = 'k') => kickback(new Request(`https://w.test${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } }), env, clock);

  assert.equal((await call('/kickback/next', {}, 'wrong')).status, 401);
  assert.equal((await kickback(new Request('https://w.test/kickback/next'), env, clock)).status, 401);
  assert.equal((await kickback(new Request('https://w.test/kickback/next'), { DB: d1 }, clock)).status, 503);
  assert.equal((await call('/kickback/elsewhere')).status, 404);

  const next = (await (await call('/kickback/next')).json()) as { url: string; waitMs: number };
  assert.equal(next.url, BASE);
  const post1 = (reply: unknown) => call('/kickback/page', { method: 'POST', body: JSON.stringify(reply) });
  assert.equal((await post1({ nonsense: true })).status, 400);
  assert.equal((await post1(f.fetch(`${BASE}page/9/`))).status, 409);
  const ok = await post1(f.fetch(next.url));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { newPosts: number }).newPosts, 2);
  assert.equal(count(d1), 2);
  assert.equal(((await (await call('/kickback/next')).json()) as { idle: string }).idle, 'nothing due');
  void db;
});

test('the admin Kickback view shows the crawler, a thread\'s posting rate and its posts, behind the token', async () => {
  const { d1, db } = fresh();
  const posts = [
    ...Array.from({ length: 12 }, (_, i) => post(400 + i, i, `<p>goal ${i}</p>`, 'Gundermann')),
    post(412, 20, `<blockquote data-ipsquote-contentcommentid="400"><p>goal 0</p></blockquote><p>Aye</p>`, 'Another'),
  ];
  const f = forum(posts, 5);
  const clock = { t: T0 + 3_600_000 };
  await pull(db, f, clock);

  const d = await kickbackData(d1, 9, 1, clock.t);
  assert.equal(d.requestsToday, 3);
  assert.equal(d.threads[0].stored, 13);
  assert.equal(d.threads[0].replies, 1);
  assert.equal(d.rate.peak15, 12);
  assert.equal(d.rate.peak60, 13);
  assert.equal(d.posts.at(-1)!.replyAuthor, 'Gundermann');

  const html = renderKickback(d);
  assert.match(html, /Official Match Thread/);
  assert.match(html, /↩ Gundermann/);
  assert.match(html, /Busiest: <b>12<\/b> posts in 15 minutes/);
  assert.match(html, /Last page reported/);

  const env = { DB: d1, ADMIN_TOKEN: 'secret' };
  assert.equal((await admin(new Request('https://w.test/admin?kickback=1'), env)).status, 401);
  const ok = await admin(new Request('https://w.test/admin?kickback=9', { headers: { cookie: 'admin=secret' } }), env);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Jambos Kickback crawler/);
  const asJson = await admin(new Request('https://w.test/admin.json?kickback=9', { headers: { authorization: 'Bearer secret' } }), env);
  assert.equal(((await asJson.json()) as { rate: { peak15: number } }).rate.peak15, 12);
});
