// BBC pages relayed from home (5 Nov 2026): when BBC refuses the Worker, it asks in the store, the agent fetches the page
// and stores its live blocks, and the Worker serves those. BBC and the clock are stand-ins; run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbcData } from '../../shared/bbc.ts';
import { REFUSED_FOR_MS, relayed } from '../../worker/src/bbc-relay.ts';
import { relayPage, wanted } from '../src/bbc-relay.ts';
import type { Store } from '../src/store.ts';
import { memoryD1 } from './d1.ts';

const PATH = '/sport/football/teams/heart-of-midlothian/scores-fixtures';
const data = { 'sport-data-scores-fixtures?x=1': { data: { eventGroups: [] } }, 'navigation-links': { data: { huge: 'x'.repeat(5000) } } };
const html = `<html><script>window.__INITIAL_DATA__=${JSON.stringify(JSON.stringify({ data }))};</script></html>`;

function setup() {
  const d1 = memoryD1();
  const store: Store = { batch: async (s) => (await d1.batch(s.map((x) => d1.prepare(x.sql).bind(...(x.params ?? []))))).map((r) => (r.results ?? []) as Record<string, unknown>[]) };
  let t = Date.parse('2026-11-05T16:00:00Z');
  const clock = { now: () => t, tick: (ms: number) => (t += ms) };
  const refused = async (): Promise<BbcData> => {
    throw new Error(`BBC ${PATH}: HTTP 403`);
  };
  const page = relayed(refused, () => d1, clock.now);
  const bbc = (async () => new Response(html)) as unknown as typeof fetch;
  return { d1, store, clock, page, bbc };
}

test('a refused page is asked for, fetched at home, then served from the store with only the live blocks', async () => {
  const { store, clock, page, bbc } = setup();
  await assert.rejects(page(PATH), /HTTP 403/);
  assert.deepEqual(await wanted(store, new Date(clock.now())), [PATH]);

  clock.tick(2000);
  await relayPage(store, PATH, () => new Date(clock.now()), bbc);
  assert.deepEqual(await wanted(store, new Date(clock.now())), [], 'nothing left to fetch until the Worker asks again');

  const got = await page(PATH);
  assert.deepEqual(Object.keys(got), ['sport-data-scores-fixtures?x=1']);
});

test('the agent fetches again only after the Worker asks again, and a stale copy is not served', async () => {
  const { store, clock, page, bbc } = setup();
  await page(PATH).catch(() => undefined);
  await relayPage(store, PATH, () => new Date(clock.now()), bbc);

  clock.tick(5000);
  await page(PATH); // asked again within 15s: no new request written
  assert.deepEqual(await wanted(store, new Date(clock.now())), []);

  clock.tick(20_000);
  await page(PATH); // a new request, served from the copy meanwhile
  assert.deepEqual(await wanted(store, new Date(clock.now())), [PATH]);

  clock.tick(11 * 60_000);
  await assert.rejects(page(PATH), /HTTP 403/, 'a copy older than 10 minutes is not served');
});

test('a page BBC serves the Worker never touches the store', async () => {
  const d1 = memoryD1();
  const page = relayed(async () => data as BbcData, () => d1);
  assert.equal(await page(PATH), data);
  assert.equal(d1.db.prepare("SELECT count(*) AS n FROM state WHERE key LIKE 'bbc_%'").get()?.n, 0);
});

test('after a refusal the Worker leaves BBC alone for half an hour, served from home, then tries once more', async () => {
  const { d1, store, clock, bbc } = setup();
  let tries = 0;
  let refusing = true;
  const read = async (): Promise<BbcData> => {
    tries++;
    if (refusing) throw new Error(`BBC ${PATH}: HTTP 403`);
    return data as BbcData;
  };
  const page = relayed(read, () => d1, clock.now);
  await assert.rejects(page(PATH), /HTTP 403/);
  await relayPage(store, PATH, () => new Date(clock.now()), bbc);

  clock.tick(20_000);
  await page(PATH);
  clock.tick(20_000);
  await page(PATH);
  assert.equal(tries, 1, 'no more tries of its own while refused');
  assert.deepEqual(await wanted(store, new Date(clock.now())), [PATH], 'still asks home for fresh copies');

  // Another instance, starting cold, learns of the refusal from the store.
  const other = relayed(read, () => d1, clock.now);
  await other(PATH);
  assert.equal(tries, 1);

  clock.tick(REFUSED_FOR_MS);
  refusing = false;
  assert.equal(await page(PATH), data, 'BBC let the Worker back in');
  assert.equal(tries, 2);
});

test('a timeout or a bad minute at BBC is not a refusal: the Worker keeps trying itself', async () => {
  const d1 = memoryD1();
  let tries = 0;
  const page = relayed(async () => {
    tries++;
    throw new Error(`BBC ${PATH}: HTTP 503`);
  }, () => d1);
  await assert.rejects(page(PATH), /HTTP 503/);
  await assert.rejects(page(PATH), /HTTP 503/);
  assert.equal(tries, 2);
});
