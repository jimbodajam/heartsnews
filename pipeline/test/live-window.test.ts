// BBC read only around our kick-offs (issue #104): the Worker's feed (worker/src/feed.ts) with the ingest's schedule,
// over the recording of Trabzonspor v Hearts (22 Oct 2026, kick-off 16:45 UTC). Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbcData } from '../../shared/bbc.ts';
import { CLOSE_AFTER_FT_MS, inWindow, type Kept, liveFeed, type Schedule } from '../../worker/src/feed.ts';
import { openFixture } from '../src/recording.ts';
import { scheduleWrite } from '../src/store.ts';
import type { Fixture } from '../src/types.ts';

const TEAM = 'heart-of-midlothian';
const KO = '2026-10-22T16:45:00.000Z';
const at = (time: string, day = '22') => Date.parse(`2026-10-${day}T${time}Z`);
const fixture = openFixture();

/** The Worker with a schedule the ingest wrote `fresh` ago, and a store shared by every instance made on `shared`. */
function worker(kickOffs: string[], shared: { kept?: Kept } = {}, clock = { t: at('12:00:00'), reads: 0 }) {
  const page = async (path: string): Promise<BbcData> => {
    clock.reads++;
    return fixture.page(path, clock.t);
  };
  const schedule = async (): Promise<Schedule> => ({ kickOffs, at: new Date(clock.t - 10 * 60_000).toISOString() });
  const memory = { get: async () => shared.kept, set: async (k: Kept) => void (shared.kept = k) };
  return { clock, shared, ...liveFeed({ team: TEAM, page, now: () => clock.t, schedule, memory }) };
}

test('the window: two hours before kick-off until 15 minutes after full time, or four hours after kick-off', () => {
  const s = (now: number): Schedule => ({ kickOffs: [KO], at: new Date(now - 60_000).toISOString() });
  const open = (time: string, kept?: Kept) => inWindow(s(at(time)), kept, at(time));
  assert.equal(open('14:44:00'), false);
  assert.equal(open('14:46:00'), true);
  assert.equal(open('20:44:00'), true);
  assert.equal(open('20:46:00'), false);
  const ft: Kept = { feed: { updated: '', match: { kickOff: KO } as never }, until: 0, ftAt: at('18:40:00') };
  assert.equal(open('18:54:00', ft), true);
  assert.equal(open('18:56:00', ft), false);
  // No schedule, or one the ingest wrote over two hours ago: read as before.
  assert.equal(inWindow(undefined, undefined, at('03:00:00')), true);
  assert.equal(inWindow({ kickOffs: [], at: new Date(at('00:59:00')).toISOString() }, undefined, at('03:00:00')), true);
  assert.equal(inWindow({ kickOffs: [], at: new Date(at('01:01:00')).toISOString() }, undefined, at('03:00:00')), false);
});

test('a day without a match: not one BBC read all day', async () => {
  const w = worker(['2026-10-25T15:00:00.000Z']);
  for (w.clock.t = at('00:00:00', '23'); w.clock.t < at('00:00:00', '24'); w.clock.t += 60_000) assert.equal((await w.feed()).match, null);
  assert.equal(w.clock.reads, 0);
});

test('match day: nothing before the window, read from two hours before kick-off', async () => {
  const w = worker([KO]);
  w.clock.t = at('14:30:00');
  assert.equal((await w.feed()).match, null);
  assert.equal(w.clock.reads, 0);
  w.clock.t = at('16:30:00');
  assert.equal((await w.feed()).match?.status, 'pre');
  assert.equal(w.clock.reads, 2);
});

test('after full time: BBC goes quiet 15 minutes on, and the result stays up for the rest of the day', async () => {
  const w = worker([KO]);
  let ftAt: number | undefined;
  for (w.clock.t = fixture.start; w.clock.t <= fixture.end; w.clock.t += 60_000) {
    const m = (await w.feed()).match;
    if (m?.status === 'ft') ftAt ??= w.clock.t;
  }
  assert.ok(ftAt, 'the recording reaches full time');
  w.clock.t = ftAt + CLOSE_AFTER_FT_MS + 60_000;
  const reads = w.clock.reads;
  for (let i = 0; i < 60; i++, w.clock.t += 60_000) assert.equal((await w.feed()).match?.status, 'ft');
  assert.equal(w.clock.reads, reads);
});

test('each cron run starts afresh, but the last read in the store holds for its TTL', async () => {
  const shared: { kept?: Kept } = {};
  const clock = { t: at('16:30:00'), reads: 0 };
  await worker([KO], shared, clock).feed();
  assert.equal(clock.reads, 2);
  clock.t += 60_000;
  assert.equal((await worker([KO], shared, clock).feed()).match?.status, 'pre');
  assert.equal(clock.reads, 2);
});

test("the ingest's schedule: games coming up and just finished, not old ones or postponed ones", () => {
  const f = (date: string): Fixture => ({ date, home: 'Hearts', away: 'Rangers', competition: '', scorers: [] }) as Fixture;
  const now = new Date('2026-10-28T22:00:00Z');
  const w = scheduleWrite({ next: [f('2026-11-01T15:00:00.000Z')], last: [f('2026-10-28T19:45:00.000Z'), f('2026-10-25T15:00:00.000Z')] }, now);
  assert.deepEqual(JSON.parse(String(w.params![0])), { kickOffs: ['2026-10-28T19:45:00.000Z', '2026-11-01T15:00:00.000Z'], at: now.toISOString() });
});
