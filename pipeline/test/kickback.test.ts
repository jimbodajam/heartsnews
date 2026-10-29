// The Kickback crawler (issue #62): reading a thread page, a polite first pull then an incremental one, the caps, and the
// kill switch. The forum is a stand-in that serves pages we write here; run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crawl, LIMITS, nextBlock, pollEvery, readThread, type Deps } from '../../kickback/src/crawl.ts';
import { parseThreadPage, threadTitle } from '../../kickback/src/parse.ts';
import type { Db } from '../../kickback/src/types.ts';
import { admin, kickbackData, renderKickback } from '../../worker/src/admin.ts';
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

/** A thread of posts split into pages of `size`, served at the crawler's URLs. */
function forum(all: FakePost[], size = 3) {
  const requests: string[] = [];
  const pages = () => Math.max(1, Math.ceil(all.length / size));
  const state = { status: 200 };
  return {
    all,
    requests,
    state,
    fetchPage: async (url: string) => {
      requests.push(url);
      const n = Number(/page\/(\d+)\/$/.exec(url)?.[1] ?? 1);
      const html = state.status === 200 ? pageHtml('Official Match Thread', n, pages(), all.slice((n - 1) * size, n * size)) : '';
      const refused = '<html><script>x()</script><body><h1>Just a moment...</h1>  Checking your browser</body></html>';
      const headers = { get: (name: string) => ({ server: 'cloudflare', 'cf-mitigated': 'challenge' })[name as 'server'] ?? null };
      return { status: state.status, text: async () => (state.status === 200 ? html : refused), headers };
    },
  };
}

function deps(f: ReturnType<typeof forum>, clock: { t: number }, sleeps: number[] = []): Deps {
  return { fetchPage: f.fetchPage, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5, now: () => clock.t };
}

const fresh = () => {
  const d1 = memoryD1();
  const db: Db = { batch: async (statements) => (await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...(s.params ?? []))))).map((r) => (r.results ?? []) as Record<string, unknown>[]) };
  d1.db.exec(`DELETE FROM kickback_threads`);
  d1.db.prepare(`INSERT INTO kickback_threads (id, title, url) VALUES (9, 'Match thread', ?)`).run(BASE);
  return { d1, db };
};
const count = (d1: ReturnType<typeof memoryD1>) => Number((d1.db.prepare(`SELECT COUNT(*) AS n FROM kickback_posts`).get() as { n: number }).n);

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

test('the first pull takes the whole thread politely, then later runs fetch only what is new', async () => {
  const { d1, db } = fresh();
  const f = forum(Array.from({ length: 8 }, (_, i) => post(100 + i, i)));
  const clock = { t: T0 + 60 * 60_000 };
  const sleeps: number[] = [];

  const first = await crawl(db, deps(f, clock, sleeps));
  assert.equal(first.requests, 3);
  assert.equal(first.newPosts, 8);
  assert.equal(first.stopped, undefined);
  assert.equal(count(d1), 8);
  assert.deepEqual(f.requests, [BASE, `${BASE}page/2/`, `${BASE}page/3/`]);
  assert.deepEqual(sleeps, [2500, 2500]); // 2-3s between requests, none before the first or after the last

  // Straight away: nothing is due.
  clock.t += 60_000;
  assert.equal((await crawl(db, deps(f, clock))).requests, 0);
  assert.equal(f.requests.length, 3);

  // Five minutes on, with two new posts: only the last page is fetched again (it holds the first of them), then the new page.
  f.all.push(post(108, 62), post(109, 63));
  clock.t += 6 * 60_000;
  const second = await crawl(db, deps(f, clock));
  assert.deepEqual(f.requests.slice(3), [`${BASE}page/3/`, `${BASE}page/4/`]);
  assert.equal(second.newPosts, 2);
  assert.equal(count(d1), 10);

  const thread = await readThread(db, 9);
  assert.equal(thread!.title, 'Official Match Thread');
  assert.equal(thread!.pages, 4);
  assert.deepEqual(thread!.posts.map((p) => p.id), [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  assert.deepEqual((await readThread(db, 9, { after: 107 }))!.posts.map((p) => p.id), [108, 109]);
});

test('a big backfill is spread over several runs by the per-run cap', async () => {
  const { d1, db } = fresh();
  const f = forum(Array.from({ length: 36 }, (_, i) => post(200 + i, i)), 3); // 12 pages
  const clock = { t: T0 + 3 * 3_600_000 };
  const a = await crawl(db, deps(f, clock));
  assert.equal(a.requests, LIMITS.perRun);
  assert.match(a.stopped!, /per-run cap/);
  assert.equal(count(d1), 30);
  // The rest is still due at once: no waiting for a polling gap while there is backlog.
  clock.t += 60_000;
  const b = await crawl(db, deps(f, clock));
  assert.equal(b.requests, 2);
  assert.equal(count(d1), 36);
  assert.equal(f.requests.filter((u) => u === BASE).length, 1, 'page 1 was only fetched once');
});

test('the day cap stops the run', async () => {
  const { d1, db } = fresh();
  const f = forum([post(1, 0)]);
  const clock = { t: T0 + 3_600_000 };
  d1.db.prepare(`INSERT INTO state (key, value, updated_at) VALUES (?, ?, 'x')`).run('kickback_requests:2026-10-28', String(LIMITS.perDay));
  const r = await crawl(db, deps(f, clock));
  assert.equal(r.requests, 0);
  assert.match(r.stopped!, /day's cap/);
  assert.equal(f.requests.length, 0);
});

test('a 429 stops the whole run with no retry, and the forum is left alone for a cool-off that grows', async () => {
  const { d1, db } = fresh();
  const f = forum(Array.from({ length: 9 }, (_, i) => post(300 + i, i)));
  const clock = { t: T0 + 3_600_000 };

  f.state.status = 429;
  const hit = await crawl(db, deps(f, clock));
  assert.equal(hit.requests, 1);
  assert.match(hit.stopped!, /blocked \(HTTP 429\)/);
  assert.equal(f.requests.length, 1, 'no retry');
  const thread = d1.db.prepare(`SELECT last_error FROM kickback_threads WHERE id = 9`).get() as { last_error: string };
  assert.match(thread.last_error, /429/);
  const block = JSON.parse((d1.db.prepare(`SELECT value FROM state WHERE key = 'kickback_block'`).get() as { value: string }).value);
  assert.equal(block.until, new Date(clock.t + 6 * 3_600_000).toISOString());
  assert.equal(block.strikes, 1);
  assert.deepEqual(block.detail, { server: 'cloudflare', cfMitigated: 'challenge', body: 'Just a moment... Checking your browser' });
  assert.match(renderKickback(await kickbackData(d1, undefined, 1, clock.t)), /Just a moment/);

  // Even with the forum well again, nothing is fetched until the cool-off is over.
  f.state.status = 200;
  clock.t += 5 * 3_600_000;
  assert.equal((await crawl(db, deps(f, clock))).requests, 0);
  assert.equal(f.requests.length, 1);

  // Over, and it is refused again: 12 hours this time.
  clock.t += 2 * 3_600_000;
  f.state.status = 403;
  await crawl(db, deps(f, clock));
  const again = JSON.parse((d1.db.prepare(`SELECT value FROM state WHERE key = 'kickback_block'`).get() as { value: string }).value);
  assert.equal(again.strikes, 2);
  assert.equal(again.until, new Date(clock.t + 12 * 3_600_000).toISOString());

  // Welcome back after that: the crawl carries on from page 1 and the strikes are remembered, not the posts it never got.
  f.state.status = 200;
  clock.t += 13 * 3_600_000;
  const back = await crawl(db, deps(f, clock));
  assert.equal(back.stopped, undefined);
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

test('other errors stop the run without a cool-off, and a page with no posts is reported rather than stored', async () => {
  const { d1, db } = fresh();
  const f = forum([post(1, 0)]);
  const clock = { t: T0 + 3_600_000 };
  f.state.status = 500;
  const r = await crawl(db, deps(f, clock));
  assert.match(r.stopped!, /HTTP 500/);
  assert.equal(d1.db.prepare(`SELECT COUNT(*) AS n FROM state WHERE key = 'kickback_block'`).get()!.n, 0);

  const odd: Deps = { ...deps(f, clock), fetchPage: async () => ({ status: 200, text: async () => '<html>a login wall</html>' }) };
  clock.t += 10 * 60_000;
  assert.match((await crawl(db, odd)).stopped!, /no posts/);
  assert.equal(count(d1), 0);
});

test('a thread is looked at less often as it goes quiet', () => {
  const now = T0;
  assert.equal(pollEvery(new Date(now - 30 * 60_000).toISOString(), now), 5 * 60_000);
  assert.equal(pollEvery(new Date(now - 5 * 3_600_000).toISOString(), now), 30 * 60_000);
  assert.equal(pollEvery(new Date(now - 3 * 86_400_000).toISOString(), now), 6 * 3_600_000);
});

test('the admin Kickback view shows the crawler, a thread\'s posting rate and its posts, behind the token', async () => {
  const { d1, db } = fresh();
  const posts = [
    ...Array.from({ length: 12 }, (_, i) => post(400 + i, i, `<p>goal ${i}</p>`, 'Gundermann')),
    post(412, 20, `<blockquote data-ipsquote-contentcommentid="400"><p>goal 0</p></blockquote><p>Aye</p>`, 'Another'),
  ];
  const f = forum(posts, 5);
  const clock = { t: T0 + 3_600_000 };
  await crawl(db, deps(f, clock));

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

  const env = { DB: d1, ADMIN_TOKEN: 'secret' };
  assert.equal((await admin(new Request('https://w.test/admin?kickback=1'), env)).status, 401);
  const ok = await admin(new Request('https://w.test/admin?kickback=9', { headers: { cookie: 'admin=secret' } }), env);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Jambos Kickback crawler/);
  const asJson = await admin(new Request('https://w.test/admin.json?kickback=9', { headers: { authorization: 'Bearer secret' } }), env);
  assert.equal(((await asJson.json()) as { rate: { peak15: number } }).rate.peak15, 12);
});
