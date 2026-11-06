// One read of BBC's fixtures and table, shared by every run (issue #105): the age limit, the kick-off window, the
// fallback when BBC fails, the Mac's half-hourly refresh, and finished matches' team sheets kept in the store.
// BBC is a stand-in and the store is SQLite in memory; run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TeamSheet } from '../../shared/live.ts';
import { finishedSheets, previousSheet, type Sheets } from '../src/collectors/bbc.ts';
import { matchFor, nearKickOff, refreshShared } from '../src/shared-match.ts';
import { loadSharedMatch, sharedMatchWrite, sheetCache, type Store } from '../src/store.ts';
import type { ClubConfig, Fixture, MatchData } from '../src/types.ts';
import { memoryD1 } from './d1.ts';

const TEAM = 'heart-of-midlothian';
const club = { name: 'Hearts', bbc: { team: TEAM, league: 'scottish-premiership' } } as unknown as ClubConfig;
const NOW = new Date('2026-11-07T12:00:00Z');
const mins = (n: number) => n * 60_000;
const later = (ms: number) => new Date(NOW.getTime() + ms);

function setup() {
  const d1 = memoryD1();
  const store: Store = { batch: async (s) => (await d1.batch(s.map((x) => d1.prepare(x.sql).bind(...(x.params ?? []))))).map((r) => (r.results ?? []) as Record<string, unknown>[]) };
  return { store };
}

const fixture = (date: string, status: Fixture['status'], link?: string): Fixture => ({ date, home: 'Hearts', away: 'Hibs', competition: 'Premiership', status, homeSlug: TEAM, awaySlug: 'hibernian', link });

/** BBC as a stand-in: counts its reads; the next game kicks off `ko`. */
function bbc(ko = '2026-11-14T15:00:00.000Z') {
  const reads = { n: 0, fail: false };
  const collect = async (): Promise<MatchData> => {
    reads.n++;
    if (reads.fail) throw new Error('HTTP 403');
    return { next: [fixture(ko, 'pre')], last: [fixture('2026-11-01T15:00:00.000Z', 'done')], table: [] };
  };
  return { reads, collect };
}

test('no copy yet: reads BBC and stores it; a run 20 minutes later uses the copy', async () => {
  const { store } = setup();
  const b = bbc();
  const first = await matchFor(store, club, NOW, { collect: b.collect });
  assert.equal(first.from, 'BBC');
  assert.ok(await loadSharedMatch(store));
  const second = await matchFor(store, club, later(mins(20)), { collect: b.collect });
  assert.equal(second.from, 'shared copy, 20 min old');
  assert.equal(b.reads.n, 1);
});

test('the age limit: a copy 64 minutes old is used, one 66 minutes old is read again', async () => {
  const { store } = setup();
  const b = bbc();
  await store.batch([sharedMatchWrite(await b.collect(), NOW)]);
  b.reads.n = 0;
  assert.match((await matchFor(store, club, later(mins(64)), { collect: b.collect })).from, /^shared copy/);
  assert.equal(b.reads.n, 0);
  assert.equal((await matchFor(store, club, later(mins(66)), { collect: b.collect })).from, 'BBC');
  assert.equal(b.reads.n, 1);
});

test('around kick-off a programme reads BBC fresh, from two hours before to three hours after; the ingest still shares', async () => {
  const ko = later(mins(60));
  const b = bbc(ko.toISOString());
  const match = await b.collect();
  const at = (offset: number) => new Date(ko.getTime() + offset);
  assert.equal(nearKickOff(match, at(mins(-121))), false);
  assert.equal(nearKickOff(match, at(mins(-119))), true);
  assert.equal(nearKickOff(match, at(mins(179))), true);
  assert.equal(nearKickOff(match, at(mins(181))), false);

  const { store } = setup();
  await store.batch([sharedMatchWrite(match, NOW)]);
  b.reads.n = 0;
  const now = later(mins(10));
  assert.equal((await matchFor(store, club, now, { collect: b.collect, freshNearKickOff: true })).from, 'BBC', 'a programme');
  await store.batch([sharedMatchWrite(match, NOW)]);
  assert.match((await matchFor(store, club, now, { collect: b.collect })).from, /^shared copy/, 'the ingest');
  assert.equal(b.reads.n, 1);
});

test("when BBC fails, a copy up to six hours old stands in; with none, the error goes to TheSportsDB's fallback", async () => {
  const { store } = setup();
  const b = bbc();
  await store.batch([sharedMatchWrite(await b.collect(), NOW)]);
  b.reads.fail = true;
  assert.match((await matchFor(store, club, later(mins(120)), { collect: b.collect })).from, /BBC failed: HTTP 403/);
  await assert.rejects(matchFor(store, club, later(mins(7 * 60)), { collect: b.collect }), /HTTP 403/);
  await assert.rejects(matchFor(setup().store, club, NOW, { collect: b.collect }), /HTTP 403/);
});

test("the Mac's refresh: nothing while the copy is under half an hour old, then a fresh read", async () => {
  const { store } = setup();
  const b = bbc();
  assert.ok(await refreshShared(store, club, NOW, b.collect));
  assert.equal(await refreshShared(store, club, later(mins(29)), b.collect), undefined);
  assert.equal(b.reads.n, 1);
  assert.ok(await refreshShared(store, club, later(mins(31)), b.collect));
  assert.equal(b.reads.n, 2);
});

const sheet = (team: string): TeamSheet => ({ team, formation: '4-4-2', rows: [[{ name: 'Craig Gordon', shirt: 'Gordon' }]], bench: [] }) as TeamSheet;

test("a finished match's sheets are read from BBC once, then from the store; a game just played is always read", async () => {
  const { store } = setup();
  const cache = sheetCache(store);
  let reads = 0;
  const read = async (): Promise<Sheets> => (reads++, { home: sheet('Hearts'), away: sheet('Hibs') });

  const old = fixture('2026-11-01T15:00:00.000Z', 'done', '/sport/football/live/old');
  assert.equal((await finishedSheets(old, cache, NOW.getTime(), read)).home?.team, 'Hearts');
  assert.equal((await finishedSheets(old, cache, NOW.getTime(), read)).away?.team, 'Hibs');
  assert.equal(reads, 1);

  const justPlayed = fixture(later(-mins(4 * 60)).toISOString(), 'done', '/sport/football/live/recent');
  await finishedSheets(justPlayed, cache, NOW.getTime(), read);
  await finishedSheets(justPlayed, cache, NOW.getTime(), read);
  assert.equal(reads, 3, 'four hours after kick-off is too soon to keep');

  const live = fixture(later(-mins(60)).toISOString(), 'live', '/sport/football/live/now');
  await finishedSheets(live, cache, NOW.getTime(), read);
  assert.equal(await cache.get('/sport/football/live/now'), undefined);
});

test("our last team from results we already have and the store's sheets: no BBC read at all", async () => {
  const { store } = setup();
  const cache = sheetCache(store);
  const link = '/sport/football/live/derby';
  await cache.set(link, { home: sheet('Hearts'), away: sheet('Hibs') });
  const results = [fixture('2026-11-01T15:00:00.000Z', 'done', link)];
  const previous = await previousSheet(TEAM, '2026-11-14T15:00:00.000Z', { cache, results, now: NOW.getTime() });
  assert.equal(previous?.sheet.team, 'Hearts');
  assert.equal(previous?.against, 'Hibs');
});
