// Story engine stage 1b (#30): every press and official article fetched into the store once, in full, retried a few
// times when a page fails, and tagged from its text. Through the real migrations on an in-memory SQLite, like
// store.test.ts. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { seedEntities } from '../src/entities.ts';
import {
  connectStore,
  ingestItems,
  MAX_ATTEMPTS,
  saveBuild,
  saveFetches,
  saveTextTags,
  untaggedArticles,
  type BuildRecord,
} from '../src/store.ts';
import { TAGGER_VERSION, tagItems } from '../src/tags.ts';
import type { ClubConfig, Item } from '../src/types.ts';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const entities = seedEntities(club, undefined, [
  [
    { name: 'Harry Milne', role: 'player' },
    { name: 'Craig Halkett', role: 'player' },
    { name: 'Lawrence Shankland', role: 'player' },
    { name: 'Wouter Vrancken', role: 'staff' },
  ],
]);

function setUp() {
  const d1 = memoryD1();
  const env = { DB: d1, STORE_TOKEN: 't' };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  return { d1, store: connectStore('t', 'https://store.test/store', fetchFn) };
}
const rows = (s: { d1: ReturnType<typeof memoryD1> }, sql: string) => s.d1.db.prepare(sql).all().map((r) => ({ ...r }));

const item = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id,
  sourceId: 'bbc',
  sourceName: 'BBC Sport',
  kind: 'press',
  title,
  summary: '',
  url: `https://example.com/${id}`,
  publishedAt: '2026-10-23T09:00:00.000Z',
  ...extra,
});

const ARTICLE = [
  'Hearts head coach Wouter Vrancken says Harry Milne faces around six weeks out with a hamstring injury, after the full-back limped off in the first half of Saturday’s defeat at Tynecastle.',
  'Vrancken added that Craig Halkett is close to a return, and that the squad was "ready for the Hibs game".',
  'Milne has been one of the side’s most consistent players this season. Lawrence Shankland scored twice last week.',
].join('\n');

test('an article is tagged from its opening and from names said more than once, not passing mentions', () => {
  const it = item('a', 'Hearts humiliated – but would Vrancken do anything differently?');
  const fromHeadline = tagItems([it], entities).get('a');
  const fromText = tagItems([it], entities, new Map([['a', ARTICLE]])).get('a');
  assert.deepEqual(fromHeadline?.people, ['wouter-vrancken']);
  assert.equal(fromHeadline?.category, 'news');
  // Milne and Vrancken are in the opening; Halkett and Shankland only once each, later on.
  assert.deepEqual(fromText?.people.sort(), ['harry-milne', 'wouter-vrancken']);
  assert.deepEqual(fromText?.about, ['harry-milne']);
  // The headline says nothing about what kind of story it is; the opening does.
  assert.equal(fromText?.category, 'injury');
});

test('the headline picks the category before the opening does', () => {
  const tags = tagItems([item('a', 'Hearts 2-0 Hibs: player ratings')], entities, new Map([['a', ARTICLE]]));
  assert.equal(tags.get('a')?.category, 'match');
});

test('every press and official article is fetched once; aggregators and videos are stored headline-only', async () => {
  const s = setUp();
  const t1 = new Date('2026-10-23T10:00:00Z');
  const items = [
    item('press', 'Milne ruled out'),
    item('official', 'Club statement', { kind: 'official', sourceId: 'hearts' }),
    item('gnews', 'Milne blow', { kind: 'aggregator', sourceId: 'gnews', url: 'https://news.google.com/rss/articles/x' }),
    item('video', 'Vrancken press conference', { kind: 'video', sourceId: 'yt', transcript: 'What was said' }),
    item('forum', 'Thoughts on Milne?', { kind: 'forum', sourceId: 'kickback' }),
  ];
  const queue = await ingestItems(s.store, items, entities, tagItems(items, entities), t1);
  assert.deepEqual(queue.map((q) => q.id).sort(), ['official', 'press']);
  assert.deepEqual(rows(s, "SELECT transcript FROM items WHERE id = 'video'"), [{ transcript: 'What was said' }]);
  assert.equal(rows(s, 'SELECT * FROM item_tags').length, 4);

  // The full text goes in, not a 4,000-character cut.
  const long = `${ARTICLE}\n${'More on the injury. '.repeat(400)}`;
  await saveFetches(s.store, [{ id: 'press', text: long }, { id: 'official', error: 'HTTP 403' }], t1);
  assert.deepEqual(rows(s, "SELECT length(body) AS n, fetch_status, attempts FROM items WHERE id = 'press'"), [
    { n: long.length, fetch_status: 'ok', attempts: 1 },
  ]);

  // Half an hour on, nothing's due: the article is in, and the failed page waits an hour before another go.
  const t2 = new Date('2026-10-23T10:30:00Z');
  assert.deepEqual(await ingestItems(s.store, items, entities, tagItems(items, entities), t2), []);

  // A bulletin's 4,000-character cut doesn't replace the article.
  const build: BuildRecord = {
    bulletin: { id: t2.toISOString(), phase: 'normal', runner: 'home' },
    items,
    bodies: new Map([['press', long.slice(0, 4000)]]),
    entities,
    tags: new Map(),
    remembered: { aired: [], takes: [], predictions: [] },
    settled: [],
    renames: [],
  };
  await saveBuild(s.store, build, t2);
  assert.deepEqual(rows(s, "SELECT length(body) AS n FROM items WHERE id = 'press'"), [{ n: long.length }]);
});

test('a page that keeps failing is tried a few times, an hour apart, then given up on', async () => {
  const s = setUp();
  const items = [item('a', 'Milne ruled out')];
  let at = new Date('2026-10-23T10:00:00Z');
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const queue = await ingestItems(s.store, items, entities, new Map(), at);
    assert.deepEqual(queue.map((q) => q.id), ['a'], `try ${i}`);
    await saveFetches(s.store, [{ id: 'a', error: 'only 120 chars of text' }], at);
    at = new Date(at.getTime() + 61 * 60_000);
  }
  assert.deepEqual(rows(s, 'SELECT fetch_status, attempts, fetch_error, body FROM items'), [
    { fetch_status: 'gave_up', attempts: MAX_ATTEMPTS, fetch_error: 'only 120 chars of text', body: null },
  ]);
  assert.deepEqual(await ingestItems(s.store, items, entities, new Map(), at), []);
});

test('a headline-only source is never fetched: its articles are given up on at once, failed ones too', async () => {
  const s = setUp();
  const at = new Date('2026-10-23T10:00:00Z');
  const items = [item('a', 'Milne ruled out'), item('b', 'Halkett back', { sourceId: 'evening-news' }), item('c', 'Referee named', { sourceId: 'evening-news' })];
  // Before the flag: an earlier try at one of them was refused.
  await ingestItems(s.store, items, entities, new Map(), at);
  await saveFetches(s.store, [{ id: 'c', error: 'HTTP 403' }], at);
  const queue = await ingestItems(s.store, items, entities, new Map(), new Date(at.getTime() + 2 * 3_600_000), ['evening-news']);
  assert.deepEqual(queue.map((q) => q.id), ['a']);
  assert.deepEqual(rows(s, "SELECT id, fetch_status, attempts FROM items WHERE source = 'evening-news' ORDER BY id"), [
    { id: 'b', fetch_status: 'gave_up', attempts: 0 },
    { id: 'c', fetch_status: 'gave_up', attempts: 1 },
  ]);
});

test('fetched articles are tagged from their text once, and a bulletin’s headline tags never replace them', async () => {
  const s = setUp();
  const t1 = new Date('2026-10-23T10:00:00Z');
  const it = item('a', 'Hearts humiliated – but would Vrancken do anything differently?');
  await ingestItems(s.store, [it], entities, tagItems([it], entities), t1);
  await saveFetches(s.store, [{ id: 'a', text: ARTICLE }], t1);

  const due = await untaggedArticles(s.store, 100);
  assert.deepEqual(due.map((d) => [d.item.id, d.item.title, d.body]), [['a', it.title, ARTICLE]]);
  await saveTextTags(s.store, tagItems(due.map((d) => d.item), entities, new Map(due.map((d) => [d.item.id, d.body]))), t1);
  assert.deepEqual(await untaggedArticles(s.store, 100), []);

  const tagged = () => ({
    tags: rows(s, 'SELECT category, tagger_version, from_text FROM item_tags'),
    entities: rows(s, 'SELECT entity_id FROM item_entities ORDER BY entity_id').map((r) => r.entity_id),
  });
  const expected = { tags: [{ category: 'injury', tagger_version: TAGGER_VERSION, from_text: 1 }], entities: ['harry-milne', 'hearts', 'wouter-vrancken'] };
  assert.deepEqual(tagged(), expected);

  // The next bulletin tags it from its headline again, and the next ingest too: the text's tags stand.
  const t2 = new Date('2026-10-23T10:30:00Z');
  await saveBuild(
    s.store,
    {
      bulletin: { id: t2.toISOString(), phase: 'normal', runner: 'github' },
      items: [it],
      bodies: new Map(),
      entities,
      tags: tagItems([it], entities),
      remembered: { aired: [], takes: [], predictions: [] },
      settled: [],
      renames: [],
    },
    t2,
  );
  await ingestItems(s.store, [it], entities, tagItems([it], entities), new Date('2026-10-23T11:00:00Z'));
  assert.deepEqual(tagged(), expected);
});
