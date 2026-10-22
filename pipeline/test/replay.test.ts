// The Worker's code (worker/src/feed.ts) replayed through the recording of Trabzonspor v Hearts (22 Oct 2026) on a
// clock the tests move by hand: finding the match, keeping each read for its TTL, and the fallbacks when BBC fails.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import type { BbcData } from '../../shared/bbc.ts';
import type { LiveFeed, LiveMatch } from '../../shared/live.ts';
import { liveFeed } from '../../worker/src/feed.ts';
import { FIXTURE, openFixture, openRecording, type RecordedMatch } from '../src/recording.ts';

const TEAM = 'heart-of-midlothian';
const fixture = openFixture();

/** The Worker over a recording, with the clock at `clock.t` and every BBC read counted (or failed, if `fail` says so). */
function worker(rec: RecordedMatch = fixture, fail?: (path: string) => boolean) {
  const clock = { t: Date.parse('2026-10-22T16:30:00Z'), reads: 0 };
  const page = async (path: string): Promise<BbcData> => {
    clock.reads++;
    if (fail?.(path)) throw new Error(`BBC ${path}: HTTP 503`);
    return rec.page(path, clock.t);
  };
  return { clock, ...liveFeed({ team: TEAM, page, now: () => clock.t }) };
}

const at = (time: string) => Date.parse(`2026-10-22T${time}Z`);
const said = (m: LiveMatch | null) => (m ? `${m.status}${m.status === 'pre' ? '' : ` ${m.home.score}-${m.away.score}`}` : 'none');

test('the whole match, read every 20 seconds as the player would', async () => {
  const w = worker();
  const seen: string[] = [];
  for (w.clock.t = fixture.start; w.clock.t <= fixture.end; w.clock.t += 20_000) {
    const m = (await w.feed()).match;
    const now = `${said(m)}${m?.events.some((e) => e.kind === 'red') ? ' red' : ''}`;
    if (seen.at(-1) !== now) seen.push(now);
  }
  assert.deepEqual(seen, ['pre', 'live 0-0', 'live 1-0', 'ht 1-0', 'live 1-0', 'live 2-0', 'live 2-0 red', 'ft 2-0 red']);
});

test('served over HTTP as live.json, with CORS and a short cache', async () => {
  const w = worker();
  w.clock.t = at('17:20:11');
  const res = await w.respond(new Request('http://localhost/live.json'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=20');
  const feed = (await res.json()) as LiveFeed;
  assert.equal(feed.updated, '2026-10-22T17:20:11.000Z');
  assert.equal(said(feed.match), 'live 1-0');
  assert.match(feed.match!.events[0].post!.text[0], /Cool as you like/);

  assert.equal((await w.respond(new Request('http://localhost/other'))).status, 404);
});

test('keeps each read for its TTL: a minute before kick-off nears, 20s from then', async () => {
  const w = worker();
  await w.feed(); // 16:30: kick-off 15 minutes off, so kept for a minute
  assert.equal(w.clock.reads, 2); // team page and match page
  w.clock.t += 59_000;
  await w.feed();
  assert.equal(w.clock.reads, 2);
  w.clock.t += 1_000;
  await w.feed();
  assert.equal(w.clock.reads, 4);
  w.clock.t += 20_000; // now under 15 minutes to go
  await w.feed();
  assert.equal(w.clock.reads, 6);
});

test('requests that arrive during a read share it', async () => {
  const w = worker();
  const feeds = await Promise.all([w.feed(), w.feed(), w.feed()]);
  assert.equal(w.clock.reads, 2);
  assert.ok(feeds.every((f) => f === feeds[0]));
});

test('without the match page, falls back to the team page', async () => {
  const w = worker(fixture, (path) => !path.endsWith('/scores-fixtures'));
  w.clock.t = at('17:20:11');
  const m = (await w.feed()).match!;
  // The committed team page is as at the start; a real one would have the score.
  assert.equal(m.status, 'pre');
  assert.deepEqual(m.posts, []);
});

test('a BBC failure serves the last good feed, or a 502 if there is none', async () => {
  let down = true;
  const w = worker(fixture, () => down);
  let res = await w.respond(new Request('http://localhost/live.json'));
  assert.equal(res.status, 502);
  assert.match(((await res.json()) as { error: string }).error, /503/);

  down = false;
  w.clock.t = at('17:20:11');
  await w.feed();
  down = true;
  w.clock.t += 60_000;
  res = await w.respond(new Request('http://localhost/live.json'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(((await res.json()) as LiveFeed).updated, '2026-10-22T17:20:11.000Z');
});

test('no match on another day, kept for five minutes', async () => {
  const w = worker();
  w.clock.t = Date.parse('2026-10-23T12:00:00Z');
  assert.equal((await w.feed()).match, null);
  w.clock.t += 299_000;
  await w.feed();
  assert.equal(w.clock.reads, 1);
});

const RAW = new URL(`../out/recordings/${FIXTURE}`, import.meta.url);

test('a full recording (home PC only) replays the same as the fixture', { skip: !existsSync(RAW) && 'no full recording here' }, async () => {
  const raw = openRecording(FIXTURE);
  for (const time of ['16:30:00', '16:47:04', '17:20:11', '17:37:15', '18:10:23', '18:44:01', '19:00:00']) {
    const a = worker(fixture);
    const b = worker(raw);
    a.clock.t = b.clock.t = at(time);
    const [fa, fb] = [(await a.feed()).match!, (await b.feed()).match!];
    assert.equal(said(fb), said(fa), time);
    assert.deepEqual(
      fb.events.map((e) => `${e.kind} ${e.player} ${e.minute}`),
      fa.events.map((e) => `${e.kind} ${e.player} ${e.minute}`),
      time,
    );
  }
});
