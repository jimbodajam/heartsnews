// The papers round-up's headlines (#110): each paper's last day of items from the store, tagged with outlet and
// whether they are about Hearts. Through the real migrations on an in-memory SQLite, like ingest.test.ts. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { loadPapersRoundup } from '../src/papers.ts';
import { connectStore, ingestItems } from '../src/store.ts';
import type { ClubConfig, Item } from '../src/types.ts';
import { memoryD1 } from './d1.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const now = new Date('2026-11-06T12:00:00.000Z');

const item = (id: string, sourceId: string, title: string, publishedAt: string, summary = ''): Item => ({
  id,
  sourceId,
  sourceName: sourceId,
  kind: 'press',
  title,
  summary,
  url: `https://example.com/${id}`,
  publishedAt,
});

test('papers round-up: the last 24 hours per paper, tagged with outlet and Hearts relevance', async () => {
  const d1 = memoryD1();
  const env = { DB: d1, STORE_TOKEN: 't' };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  const store = connectStore('t', 'https://store.test/store', fetchFn);
  await ingestItems(
    store,
    [
      item('dr1', 'daily-record', 'Hearts boss on injury boost', '2026-11-06T09:00:00.000Z'),
      item('dr2', 'daily-record', 'Rangers eye striker', '2026-11-06T08:00:00.000Z', 'Gers news with a Tynecastle link'),
      item('dr3', 'daily-record', 'Hearts old story', '2026-11-04T09:00:00.000Z'),
      item('sc1', 'scotsman', 'Celtic win again', '2026-11-05T20:00:00.000Z'),
      item('bbc1', 'bbc', 'Hearts on the BBC', '2026-11-06T10:00:00.000Z'),
      item('en1', 'evening-news', 'Jambos fan group plans march', '2026-11-06T11:00:00.000Z'),
    ],
    [],
    new Map(),
    now,
    ['scotsman', 'evening-news'],
  );

  const round = await loadPapersRoundup(store, club.keywords, now);
  assert.deepEqual(round['daily-record'].map((h) => [h.id, h.outlet, h.hearts]), [['dr1', 'daily-record', true], ['dr2', 'daily-record', true]]);
  assert.deepEqual(round.scotsman.map((h) => [h.id, h.hearts]), [['sc1', false]]);
  assert.deepEqual(round['evening-news'].map((h) => [h.id, h.hearts]), [['en1', true]]);
  assert.deepEqual(round.herald, []);

  // A wider window brings the older story in; no page was fetched for the headline-only papers.
  assert.equal((await loadPapersRoundup(store, club.keywords, now, 72))['daily-record'].length, 3);
  const gaveUp = d1.db.prepare(`SELECT id FROM items WHERE fetch_status = 'gave_up' ORDER BY id`).all().map((r) => String(r.id));
  assert.deepEqual(gaveUp, ['en1', 'sc1']);
});
