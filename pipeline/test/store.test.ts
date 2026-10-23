// The channel's memory store: the pipeline's queries (pipeline/src/store.ts) through the Worker's /store endpoint
// (worker/src/store.ts) into the real migrations, on an in-memory SQLite standing in for D1. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { freshness, settlePredictions } from '../src/memory.ts';
import { buildWrites, connectStore, imported, importWrites, loadMemory, saveBuild, type BuildRecord, type Store } from '../src/store.ts';
import type { Story } from '../src/stories.ts';
import { TAGGER_VERSION, type Tags } from '../src/tags.ts';
import type { Item } from '../src/types.ts';
import { memoryD1 } from './d1.ts';

const TOKEN = 'test-token';

function setUp() {
  const d1 = memoryD1();
  const env = { DB: d1, STORE_TOKEN: TOKEN };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  return { d1, env, store: connectStore(TOKEN, 'https://store.test/store', fetchFn) };
}

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  sourceId: 'bbc',
  sourceName: 'BBC Sport',
  kind: 'press',
  title: `Story ${id}`,
  summary: `Summary ${id}`,
  url: `https://example.com/${id}`,
  publishedAt: '2026-10-23T09:00:00.000Z',
  ...extra,
});

const record = (at: Date, over: Partial<BuildRecord> = {}): BuildRecord => ({
  bulletin: { id: at.toISOString(), phase: 'normal', runner: 'home' },
  items: [item('a'), item('b', { transcript: 'What was said' })],
  bodies: new Map([['a', 'The article about Milne']]),
  tags: new Map(),
  entities: [
    { id: 'hearts', type: 'club', name: 'Heart of Midlothian', aliases: ['Hearts', 'Jambos'] },
    { id: 'harry-milne', type: 'player', name: 'Harry Milne', aliases: [] },
    { id: 'wouter-vrancken', type: 'staff', name: 'Wouter Vrancken', aliases: [] },
  ],
  remembered: {
    aired: [
      { title: 'Milne signs new deal', inDepth: true },
      { title: 'Hearts top the table', inDepth: false },
    ],
    takes: [{ presenter: 'fraser', topic: 'VAR', view: 'Ruining the game' }],
    predictions: [{ presenter: 'fraser', home: 'Hearts', away: 'Hibs', date: '2026-10-25T15:00:00.000Z', homeGoals: 2, awayGoals: 0, madeAt: at.toISOString() }],
  },
  settled: [],
  renames: [],
  ...over,
});

// Straight from the database, as plain objects (node:sqlite's rows have no prototype).
const rows = (s: { d1: ReturnType<typeof memoryD1> }, sql: string) => s.d1.db.prepare(sql).all().map((r) => ({ ...r }));

test('the endpoint wants the token, a POST and a list of statements', async () => {
  const { env } = setUp();
  const call = (init: RequestInit) => endpoint(new Request('https://store.test/store', init), env);
  const body = JSON.stringify({ statements: [{ sql: 'SELECT 1 AS one' }] });
  assert.equal((await call({ method: 'POST', body })).status, 401);
  assert.equal((await call({ method: 'POST', body, headers: { authorization: 'Bearer wrong-token' } })).status, 401);
  assert.equal((await call({ method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } })).status, 405);
  assert.equal((await call({ method: 'POST', body: '{"statements":[]}', headers: { authorization: `Bearer ${TOKEN}` } })).status, 400);
  const ok = await call({ method: 'POST', body, headers: { authorization: `Bearer ${TOKEN}` } });
  assert.deepEqual(await ok.json(), { results: [[{ one: 1 }]] });
  assert.equal((await endpoint(new Request('https://store.test/store', { method: 'POST', body }), {})).status, 503);
});

test('a build writes everything new, and the next build reads it back', async () => {
  const s = setUp();
  const t1 = new Date('2026-10-23T10:00:00Z');
  assert.deepEqual((await loadMemory(s.store, t1)).aired, []);
  await saveBuild(s.store, record(t1), t1);

  const t2 = new Date('2026-10-23T10:30:00Z');
  const m = await loadMemory(s.store, t2);
  assert.deepEqual(m.aired.map((a) => [a.title, a.times, a.inDepth, a.lastAired]).sort(), [
    ['Hearts top the table', 1, 0, t1.toISOString()],
    ['Milne signs new deal', 1, 1, t1.toISOString()],
  ]);
  assert.deepEqual(m.presenters.fraser.opinions, [{ topic: 'VAR', view: 'Ruining the game', at: t1.toISOString() }]);
  assert.equal(m.presenters.fraser.predictions[0].homeGoals, 2);
  assert.equal(m.presenters.fraser.predictions[0].outcome, undefined);
  // Just aired, so a story with nothing new is cooled down.
  const story = { title: 'Milne signs new deal', latest: '2026-10-23T09:00:00.000Z' } as Story;
  assert.ok(freshness(m, story, t2) < 0.6);

  assert.deepEqual(rows(s, 'SELECT id, runner, phase FROM bulletins'), [{ id: t1.toISOString(), runner: 'home', phase: 'normal' }]);
  assert.deepEqual(rows(s, 'SELECT id, first_seen, body, transcript FROM items ORDER BY id'), [
    { id: 'a', first_seen: t1.toISOString(), body: 'The article about Milne', transcript: null },
    { id: 'b', first_seen: t1.toISOString(), body: null, transcript: 'What was said' },
  ]);
  assert.deepEqual(rows(s, "SELECT aliases FROM entities WHERE id = 'hearts'"), [{ aliases: '["Hearts","Jambos"]' }]);
});

test('a second build: first_seen and bodies stick, a new call replaces the old, results settle, leavers go inactive', async () => {
  const s = setUp();
  const t1 = new Date('2026-10-23T10:00:00Z');
  await saveBuild(s.store, record(t1), t1);

  const t2 = new Date('2026-10-26T10:00:00Z');
  const memory = await loadMemory(s.store, t2);
  const settled = settlePredictions(memory, [{ home: 'Hearts', away: 'Hibs', date: '2026-10-25T15:00:00.000Z', homeScore: 2, awayScore: 0 }]);
  assert.equal(settled.length, 1);
  await saveBuild(
    s.store,
    record(t2, {
      bulletin: { id: t2.toISOString(), phase: 'reaction', runner: 'github' },
      items: [item('a', { title: 'Updated headline' }), item('c')],
      bodies: new Map(),
      entities: [{ id: 'harry-milne', type: 'player', name: 'Harry Milne', aliases: [] }],
      remembered: {
        aired: [{ title: 'Milne signs new deal', inDepth: false }],
        takes: [],
        predictions: [{ presenter: 'ross', home: 'Hearts', away: 'Celtic', date: '2026-11-01T15:00:00.000Z', homeGoals: 1, awayGoals: 1, madeAt: t2.toISOString() }],
      },
      settled,
    }),
    t2,
  );

  assert.deepEqual(rows(s, "SELECT title, first_seen, body FROM items WHERE id = 'a'"), [
    { title: 'Updated headline', first_seen: t1.toISOString(), body: 'The article about Milne' },
  ]);
  assert.deepEqual(rows(s, 'SELECT id, active FROM entities ORDER BY id'), [
    { id: 'harry-milne', active: 1 },
    { id: 'hearts', active: 1 },
    { id: 'wouter-vrancken', active: 0 },
  ]);
  const m = await loadMemory(s.store, new Date('2026-10-26T11:00:00Z'));
  assert.deepEqual(m.aired.find((a) => a.title === 'Milne signs new deal'), {
    title: 'Milne signs new deal',
    firstAired: t1.toISOString(),
    lastAired: t2.toISOString(),
    times: 2,
    inDepth: 1,
  });
  assert.deepEqual(m.presenters.fraser.predictions.map((p) => [p.away, p.outcome, p.actual]), [['Hibs', 'exact', '2-0']]);
  assert.equal(m.presenters.ross.predictions[0].away, 'Celtic');

  // The same match called again replaces the earlier prediction.
  const t3 = new Date('2026-10-27T10:00:00Z');
  const again = record(t3);
  again.remembered.predictions = [{ presenter: 'ross', home: 'Hearts', away: 'Celtic', date: '2026-11-01T15:00:00.000Z', homeGoals: 3, awayGoals: 1, madeAt: t3.toISOString() }];
  await saveBuild(s.store, again, t3);
  assert.deepEqual(rows(s, "SELECT home_goals, bulletin_id FROM predictions WHERE presenter_id = 'ross'"), [{ home_goals: 3, bulletin_id: t3.toISOString() }]);
});

test('an item is tagged once; an older tagger version is tagged again', async () => {
  const s = setUp();
  const tags = (entities: string[]): Tags => ({ category: 'injury', mood: 'bad', entities, people: entities, about: entities });
  const t1 = new Date('2026-10-23T10:00:00Z');
  await saveBuild(s.store, record(t1, { tags: new Map([['a', tags(['harry-milne'])]]) }), t1);
  assert.deepEqual(rows(s, 'SELECT item_id, category, mood, tagger_version, tagged_at FROM item_tags'), [
    { item_id: 'a', category: 'injury', mood: 'bad', tagger_version: TAGGER_VERSION, tagged_at: t1.toISOString() },
  ]);
  assert.deepEqual(rows(s, 'SELECT item_id, entity_id FROM item_entities'), [{ item_id: 'a', entity_id: 'harry-milne' }]);

  // Tagged differently next time (the squad changed, say): the first tags stand, and a new item is tagged.
  s.d1.db.prepare("INSERT INTO items (id, source, kind, title, first_seen) VALUES ('old', 'bbc', 'press', 'Old', ?)").run(t1.toISOString());
  s.d1.db.prepare("INSERT INTO item_tags (item_id, category, mood, tagger_version, tagged_at) VALUES ('old', 'news', 'neutral', 0, ?)").run(t1.toISOString());
  s.d1.db.prepare("INSERT INTO item_entities VALUES ('old', 'hearts')").run();
  const t2 = new Date('2026-10-23T10:30:00Z');
  await saveBuild(
    s.store,
    record(t2, {
      items: [item('a'), item('b'), item('old')],
      tags: new Map([['a', tags(['wouter-vrancken'])], ['b', tags(['wouter-vrancken'])], ['old', tags(['harry-milne'])]]),
    }),
    t2,
  );
  assert.deepEqual(rows(s, 'SELECT item_id, tagged_at FROM item_tags ORDER BY item_id'), [
    { item_id: 'a', tagged_at: t1.toISOString() },
    { item_id: 'b', tagged_at: t2.toISOString() },
    { item_id: 'old', tagged_at: t2.toISOString() },
  ]);
  assert.deepEqual(rows(s, 'SELECT item_id, entity_id FROM item_entities ORDER BY item_id'), [
    { item_id: 'a', entity_id: 'harry-milne' },
    { item_id: 'b', entity_id: 'wouter-vrancken' },
    { item_id: 'old', entity_id: 'harry-milne' },
  ]);
});

test('a failed batch writes nothing', async () => {
  const s = setUp();
  const t = new Date('2026-10-23T10:00:00Z');
  const statements = [...buildWrites(record(t), t), { sql: 'INSERT INTO nowhere VALUES (1)' }];
  await assert.rejects(s.store.batch(statements), /nowhere/);
  assert.deepEqual(rows(s, 'SELECT COUNT(*) AS n FROM items'), [{ n: 0 }]);
  assert.deepEqual(rows(s, 'SELECT COUNT(*) AS n FROM bulletins'), [{ n: 0 }]);
});

test('article text is pruned after 30 days; the item stays', async () => {
  const s = setUp();
  const t1 = new Date('2026-09-01T10:00:00Z');
  await saveBuild(s.store, record(t1), t1);
  const t2 = new Date('2026-10-05T10:00:00Z');
  await saveBuild(s.store, record(t2, { items: [], bodies: new Map() }), t2);
  assert.deepEqual(rows(s, 'SELECT id, title, body, transcript FROM items ORDER BY id'), [
    { id: 'a', title: 'Story a', body: null, transcript: null },
    { id: 'b', title: 'Story b', body: null, transcript: null },
  ]);
});

test('a renamed presenter keeps their takes and predictions', async () => {
  const s = setUp();
  const t1 = new Date('2026-10-23T10:00:00Z');
  const first = record(t1);
  first.remembered.takes = [{ presenter: 'ally', topic: 'xG', view: 'Underrated' }];
  first.remembered.predictions = first.remembered.predictions.map((p) => ({ ...p, presenter: 'ally' }));
  await saveBuild(s.store, first, t1);
  const t2 = new Date('2026-10-23T11:00:00Z');
  await saveBuild(s.store, record(t2, { remembered: { aired: [], takes: [], predictions: [] }, renames: [{ from: 'ally', to: 'ross' }] }), t2);
  const m = await loadMemory(s.store, t2);
  assert.equal(m.presenters.ally, undefined);
  assert.equal(m.presenters.ross.opinions[0].view, 'Underrated');
  assert.equal(m.presenters.ross.predictions.length, 1);
});

test('memory.json imports into the same shape it came from', async () => {
  const s = setUp();
  const store: Store = s.store;
  assert.equal(await imported(store), false);
  const now = new Date('2026-10-23T12:00:00Z');
  const aired = { title: 'Milne signs new deal', firstAired: '2026-10-22T08:00:00.000Z', lastAired: '2026-10-23T09:00:00.000Z', times: 4, inDepth: 2 };
  const prediction = { home: 'Hearts', away: 'Hibs', date: '2026-10-20T15:00:00.000Z', homeGoals: 1, awayGoals: 0, madeAt: '2026-10-19T10:00:00.000Z', outcome: 'right' as const, actual: '2-0' };
  await store.batch(
    importWrites({
      version: 1,
      updatedAt: now.toISOString(),
      aired: [aired],
      presenters: { fraser: { opinions: [{ topic: 'VAR', view: 'Ruining the game', at: '2026-10-22T08:00:00.000Z' }], predictions: [prediction] } },
    }),
  );
  assert.equal(await imported(store), true);
  const m = await loadMemory(store, now);
  assert.deepEqual(m.aired, [aired]);
  assert.deepEqual(m.presenters.fraser.opinions, [{ topic: 'VAR', view: 'Ruining the game', at: '2026-10-22T08:00:00.000Z' }]);
  assert.deepEqual(m.presenters.fraser.predictions, [prediction]);
});
