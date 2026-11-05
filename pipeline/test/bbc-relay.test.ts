// BBC pages relayed from home (5 Nov 2026): when BBC refuses the Worker, it asks in the store, the agent fetches the page
// and stores its live blocks, and the Worker serves those. BBC and the clock are stand-ins; run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbcData } from '../../shared/bbc.ts';
import { relayed } from '../../worker/src/bbc-relay.ts';
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
