// Story engine stage 2b (#31): the bulletin built from the store's storylines. Stories come from storylines with their
// briefs and claims, weighted by kind and by what's new since they last aired; what the ingest hasn't read yet comes in
// from headlines. The store is the real migrations on an in-memory SQLite, like store.test.ts. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { seedEntities } from '../src/entities.ts';
import { airings, emptyMemory, freshness } from '../src/memory.ts';
import { storylineStories, type OnAirDesk, type StoredItem } from '../src/onair.ts';
import { buildFacts, type Channel } from '../src/script/facts.ts';
import { connectStore, ingestItems, loadMemory, loadOnAir, saveBriefs, saveBuild, saveFetches, siftWrites } from '../src/store.ts';
import type { Storyline } from '../src/storylines.ts';
import { tagItems } from '../src/tags.ts';
import type { ClubConfig, Fixture, Item } from '../src/types.ts';
import { memoryD1 } from './d1.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const entities = seedEntities(club, undefined, [
  [
    { name: 'Harry Milne', role: 'player' as const },
    { name: 'Wouter Vrancken', role: 'staff' as const },
  ],
]);

const CELTIC = { kickOff: '2026-10-18T15:00:00.000Z', fixture: '2026-10-18|Celtic|Hearts' };
const HIBS: Fixture = { date: '2026-10-25T15:00:00.000Z', home: 'Heart of Midlothian', away: 'Hibernian', competition: 'Scottish Premiership', homeScore: 1, awayScore: 0 };
const TEXT = (what: string) => `${what}. ${'More detail from the article. '.repeat(20)}`;

const item = (id: string, title: string, extra: Partial<StoredItem> = {}): StoredItem => ({
  id,
  sourceId: 'bbc',
  sourceName: 'bbc',
  kind: 'press',
  title,
  summary: '',
  url: `https://example.com/${id}`,
  publishedAt: '2026-10-18T17:00:00.000Z',
  ...extra,
});

const source = (itemId: string, at: string, corroboration = 0) => ({ item: itemId, outlet: 'bbc', corroboration, at });

/** The 7-1 at Celtic on 18 Oct, and Milne's injury from 22 Oct. */
function desk(over: { celticClaims?: Storyline['claims']; airings?: OnAirDesk['airings']; sifted?: string[] } = {}): OnAirDesk {
  const celtic: Storyline = {
    id: 1,
    kind: 'match',
    category: 'match',
    title: 'Celtic v Hearts',
    ...CELTIC,
    status: 'open',
    openedAt: '2026-10-17T10:00:00.000Z',
    updatedAt: '2026-10-18T17:00:00.000Z',
    brief: { known: 'Celtic beat Hearts 7-1 at Celtic Park.', disputed: '', latest: 'Celtic beat Hearts 7-1.' },
    claims: over.celticClaims ?? [
      { id: 1, text: 'Celtic 7-1 Hearts', status: 'reported', firstSeen: '2026-10-18T17:00:00.000Z', sources: [source('c1', '2026-10-18T17:30:00.000Z'), source('c2', '2026-10-18T17:30:00.000Z')] },
    ],
  };
  const milne: Storyline = {
    id: 2,
    kind: 'person',
    entity: 'harry-milne',
    category: 'injury',
    title: 'Harry Milne injury',
    status: 'open',
    openedAt: '2026-10-22T16:15:00.000Z',
    updatedAt: '2026-10-22T16:15:00.000Z',
    brief: { known: 'Harry Milne has an ACL injury and will miss the rest of the season.', disputed: '', latest: 'Milne is out for the season.' },
    claims: [{ id: 2, text: 'Milne: ACL injury, out for the season', status: 'confirmed', firstSeen: '2026-10-22T16:15:00.000Z', sources: [source('m1', '2026-10-22T17:00:00.000Z')] }],
  };
  return {
    storylines: [celtic, milne],
    items: new Map(
      [
        item('c1', 'Celtic 7-1 Hearts: report', { text: TEXT('Celtic thrashed Hearts 7-1') }),
        item('c2', 'Hearts humbled', { sourceId: 'daily-record', sourceName: 'daily-record', text: TEXT('Hearts were humbled') }),
        item('c3', 'Vrancken under pressure', { publishedAt: '2026-10-23T10:00:00.000Z', text: TEXT('Vrancken is under pressure') }),
        item('m1', 'Milne out for season', { publishedAt: '2026-10-22T16:15:00.000Z', text: TEXT('Milne has torn his ACL') }),
      ].map((it) => [it.id, it]),
    ),
    airings: over.airings ?? new Map(),
    sifted: new Set(over.sifted ?? []),
  };
}

const at = (iso: string) => new Date(iso);
const scores = (stories: { id: string; score: number }[]) => Object.fromEntries(stories.map((s) => [s.id, s.score]));
const onAir = (d: OnAirDesk, now: Date, extra: { items?: Item[]; played?: Fixture[] } = {}) =>
  storylineStories(d, { club, items: extra.items ?? [], tags: tagItems(extra.items ?? [], entities), played: extra.played ?? [], now });

test('a storyline is a story written from its brief, its claims and the stored text of their sources', () => {
  const celtic = onAir(desk(), at('2026-10-23T12:00:00Z')).find((s) => s.id === 'l1')!;
  assert.equal(celtic.id, 'l1');
  assert.equal(celtic.title, 'Celtic v Hearts');
  assert.equal(celtic.summary, 'Celtic beat Hearts 7-1 at Celtic Park.');
  assert.equal(celtic.category, 'match');
  // Outlets by their names in the club config; one article each.
  assert.deepEqual(celtic.sources, ['BBC Sport', 'Daily Record']);
  assert.deepEqual(celtic.articles?.map((a) => a.item), ['c1', 'c2']);
  assert.ok(celtic.body?.includes('Celtic thrashed Hearts 7-1') && celtic.body.includes('Celtic 7-1 Hearts'));
  assert.equal(celtic.storyline?.phase, 'fallout');
  assert.equal(celtic.storyline?.isNew, true, 'never aired, so all of it is new');
});

test("a summarised article reaches the writer as its summary, and quotes are still checked against its whole text", () => {
  const d = desk();
  const c1 = d.items.get('c1')!;
  d.items.set('c1', { ...c1, digest: '(Summary of the whole article.)\nWhat it reports:\n- Celtic won 7-1' });
  const celtic = onAir(d, at('2026-10-23T12:00:00Z')).find((s) => s.id === 'l1')!;
  assert.equal(celtic.articles?.find((a) => a.item === 'c1')?.text, d.items.get('c1')!.digest);
  assert.equal(celtic.articles?.find((a) => a.item === 'c2')?.text, d.items.get('c2')!.text, 'no summary: the text as before');
  assert.ok(celtic.body?.includes('Celtic thrashed Hearts 7-1'));
});

test('a match leads around the game, and five days on it does not lead unless something new has happened', () => {
  // The night of the game: it leads (Milne's injury hasn't happened yet, so its claim is in the future; ignore it).
  const night = scores(onAir(desk(), at('2026-10-18T19:00:00Z')));
  assert.ok(night.l1 > 1.5, `the result leads: ${night.l1}`);

  // Five days on, aired since, nothing new: Milne leads and the match is far down.
  const aired = new Map([[1, { title: 'Celtic v Hearts', firstAired: '2026-10-18T19:00:00.000Z', lastAired: '2026-10-22T09:00:00.000Z', times: 30, inDepth: 10 }]]);
  const quiet = onAir(desk({ airings: aired }), at('2026-10-23T12:00:00Z'));
  assert.equal(quiet[0].id, 'l2');
  assert.ok(scores(quiet).l1 < 0.25 * scores(quiet).l2, JSON.stringify(scores(quiet)));
  assert.equal(quiet.find((s) => s.id === 'l1')?.storyline?.isNew, false);

  // Something new in the fallout (read after it last aired): it's back up.
  const pressure = { id: 3, text: 'Vrancken under pressure after the 7-1', status: 'reported' as const, firstSeen: '2026-10-23T10:00:00.000Z', sources: [source('c3', '2026-10-23T10:30:00.000Z')] };
  const update = onAir(desk({ airings: aired, celticClaims: [...desk().storylines[0].claims, pressure] }), at('2026-10-23T12:00:00Z'));
  const celtic = update.find((s) => s.id === 'l1')!;
  assert.ok(celtic.score > 5 * scores(quiet).l1, `${celtic.score} against ${scores(quiet).l1}`);
  assert.deepEqual(celtic.storyline?.claims.map((c) => c.isNew), [false, true]);

  // A new article restating a claim that was already there is not news.
  const [first, ...rest] = desk().storylines[0].claims;
  const restated = { ...first, sources: [...first.sources, source('c3', '2026-10-23T10:30:00.000Z')] };
  const again = onAir(desk({ airings: aired, celticClaims: [restated, ...rest] }), at('2026-10-23T12:00:00Z')).find((s) => s.id === 'l1')!;
  assert.equal(again.storyline?.isNew, false);

  // Once the next match is played it drops away, new claims or not.
  const after = scores(onAir(desk({ airings: aired, celticClaims: [...desk().storylines[0].claims, pressure] }), at('2026-10-26T12:00:00Z'), { played: [HIBS] }));
  assert.ok(after.l1 < 0.1, `${after.l1}`);
});

test('more coverage of the same claims adds sources, not weight', () => {
  const many = Array.from({ length: 20 }, (_, i) => source(`x${i}`, '2026-10-18T18:00:00.000Z'));
  const d = desk({
    celticClaims: [{ id: 1, text: 'Celtic 7-1 Hearts', status: 'reported', firstSeen: '2026-10-18T17:00:00.000Z', sources: many }],
  });
  for (let i = 0; i < 20; i++) d.items.set(`x${i}`, item(`x${i}`, `Report ${i}`, { publisher: `Outlet ${i}` }));
  const thursday = scores(onAir(d, at('2026-10-23T12:00:00Z')));
  const few = scores(onAir(desk(), at('2026-10-23T12:00:00Z')));
  assert.ok(thursday.l1 < 2 * few.l1, `${thursday.l1} against ${few.l1}`);
  assert.ok(thursday.l1 < thursday.l2, 'twenty pieces on the defeat still trail a newer storyline');
});

test("what the ingest hasn't read goes in from headlines, joining its storyline when it plainly belongs to one", () => {
  const now = at('2026-10-23T12:00:00Z');
  const fresh: Item[] = [
    { ...item('n1', 'Harry Milne ruled out for the season with injury', { publishedAt: '2026-10-23T11:45:00.000Z', sourceId: 'google-news', kind: 'aggregator', publisher: 'Sky Sports' }) },
    { ...item('n2', 'Hearts announce new stadium plans', { publishedAt: '2026-10-23T11:50:00.000Z', sourceId: 'google-news', kind: 'aggregator', publisher: 'STV' }) },
    // Read by the ingest already and gave no claim: not a story.
    { ...item('n3', 'Hearts tickets on sale for Hibs', { publishedAt: '2026-10-23T09:00:00.000Z' }) },
  ];
  const aired = new Map([[2, { title: 'Harry Milne injury', firstAired: '2026-10-22T18:00:00.000Z', lastAired: '2026-10-23T11:00:00.000Z', times: 4, inDepth: 1 }]]);
  const stories = onAir(desk({ airings: aired, sifted: ['n3'] }), now, { items: fresh });
  const milne = stories.find((s) => s.id === 'l2')!;
  assert.deepEqual(milne.storyline?.justIn, ['Harry Milne ruled out for the season with injury']);
  assert.equal(milne.storyline?.isNew, true);
  assert.ok(milne.sources.includes('Sky Sports'));
  const loose = stories.filter((s) => !s.storyline);
  assert.deepEqual(loose.map((s) => s.items.map((it) => it.id)), [['n2']]);
});

test("a headline naming the match's opponent joins it, tagged as match news or not", () => {
  const now = at('2026-10-18T19:00:00Z');
  const fresh: Item[] = [
    { ...item('v1', 'REACTION | Points over performance | Celtic 7-1 Hearts', { publishedAt: '2026-10-18T18:30:00.000Z', sourceId: 'hearts-standard', kind: 'video' }) },
  ];
  assert.equal(tagItems(fresh, entities).get('v1')?.category, 'news', 'the tagger calls it news');
  const stories = onAir(desk(), now, { items: fresh });
  assert.deepEqual(stories.find((s) => s.id === 'l1')?.storyline?.justIn, ['REACTION: Points over performance, Celtic 7-1 Hearts']);
  assert.deepEqual(stories.filter((s) => !s.storyline), []);
});

test('a storyline with nothing new since it aired is cooled for longer, and its package comes round less often', () => {
  const now = at('2026-10-23T12:00:00Z');
  const aired = new Map([[2, { title: 'Harry Milne injury', firstAired: '2026-10-22T18:00:00.000Z', lastAired: '2026-10-23T09:00:00.000Z', times: 4, inDepth: 2, lastInDepth: '2026-10-23T09:00:00.000Z' }]]);
  const [milne] = onAir(desk({ airings: aired }), now).filter((s) => s.id === 'l2');
  const [milneNew] = onAir(desk(), now).filter((s) => s.id === 'l2');
  assert.ok(freshness(emptyMemory(), milne, now) < 0.6 * freshness(emptyMemory(), { ...milneNew, storyline: { ...milneNew.storyline!, aired: aired.get(2), isNew: true } }, now));
  assert.equal(milne.storyline?.newSinceInDepth, false);

  // Two readable storylines at almost the same weight: the one with nothing new since its package goes second.
  const other = { ...milneNew, id: 'l9', score: milne.score * 0.9, storyline: { ...milneNew.storyline!, id: 9 } };
  const facts = buildFacts(club, channel, [milne, other], [], undefined, now);
  assert.deepEqual(facts.features.map((s) => s.id), ['l9', 'l2']);
});

function setUp() {
  const d1 = memoryD1();
  const env = { DB: d1, STORE_TOKEN: 'test-token' };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  return { d1, store: connectStore('test-token', 'https://store.test/store', fetchFn) };
}

test('the build reads its storylines from the store, and saves airings against them', async () => {
  const { d1, store } = setUp();
  const t0 = at('2026-10-22T17:00:00Z');
  const items: Item[] = [
    item('m1', 'Milne out for season', { publishedAt: '2026-10-22T16:15:00.000Z' }),
    item('m2', 'Milne blow for Hearts', { sourceId: 'google-news', kind: 'aggregator', publisher: 'Sky Sports', publishedAt: '2026-10-22T16:30:00.000Z' }),
    item('q1', 'Unread headline', { publishedAt: '2026-10-22T16:50:00.000Z' }),
  ];
  await ingestItems(store, items, entities, new Map(), t0);
  await saveFetches(store, [{ id: 'm1', text: TEXT('Milne has torn his ACL') }], t0);
  await store.batch(
    siftWrites(
      {
        storylines: [{ id: 1, kind: 'person', entity: 'harry-milne', category: 'injury', title: 'Harry Milne injury', openedAt: '2026-10-22T16:15:00.000Z' }],
        claims: [{ id: 1, storylineId: 1, text: 'Milne: ACL injury, out for the season', status: 'reported', firstSeen: '2026-10-22T16:15:00.000Z' }],
        sources: [{ claimId: 1, itemId: 'm1' }, { claimId: 1, itemId: 'm2', corroboration: true }],
        statuses: [],
        touched: [{ id: 1, at: '2026-10-22T16:15:00.000Z' }],
        resolved: [],
        sifted: ['m1', 'm2'],
      },
      0,
      t0,
    ),
  );
  await saveBriefs(store, [{ id: 1, title: 'Harry Milne injury', brief: { known: 'Milne is out for the season.', disputed: '', latest: 'Milne is out.' } }], 0, t0);

  const t1 = at('2026-10-22T18:00:00Z');
  const d = await loadOnAir(store, items.map((it) => it.id), t1);
  assert.deepEqual([...d.sifted].sort(), ['m1', 'm2']);
  assert.deepEqual([...d.items.keys()].sort(), ['m1', 'm2']);
  assert.ok(d.items.get('m1')?.text?.startsWith('Milne has torn his ACL'));
  assert.equal(d.items.get('m2')?.text, undefined);
  assert.equal(d.storylines[0].brief?.known, 'Milne is out for the season.');

  const stories = storylineStories(d, { club, items, tags: new Map(), played: [], now: t1 });
  const milne = stories.find((s) => s.storyline)!;
  assert.deepEqual(milne.sources, ['BBC Sport', 'Sky Sports']);
  assert.deepEqual(milne.articles?.map((a) => a.item), ['m1']);
  assert.ok(stories.some((s) => !s.storyline && s.items.some((it) => it.id === 'q1')), 'the unread headline is a story of its own');

  // It airs, in depth: the airing is saved against the storyline, and comes back with it, not as a headline story.
  const aired = airings(emptyMemory(), [milne], new Set([milne.id]));
  assert.deepEqual(aired, [{ title: 'Harry Milne injury', storyline: 1, inDepth: true }]);
  await saveBuild(
    store,
    { bulletin: { id: t1.toISOString(), phase: 'normal', runner: 'home' }, items: [], entities, tags: new Map(), remembered: { aired, takes: [], predictions: [] }, settled: [], renames: [] },
    t1,
  );
  assert.deepEqual(d1.db.prepare('SELECT story, storyline_id, in_depth FROM airings').all().map((r) => ({ ...r })), [{ story: 'Harry Milne injury', storyline_id: 1, in_depth: 1 }]);
  assert.deepEqual((await loadMemory(store, t1)).aired, []);
  const again = await loadOnAir(store, [], at('2026-10-22T19:00:00Z'));
  assert.deepEqual(again.airings.get(1), {
    title: 'Harry Milne injury',
    firstAired: t1.toISOString(),
    lastAired: t1.toISOString(),
    times: 1,
    inDepth: 1,
    lastInDepth: t1.toISOString(),
  });
  const [later] = storylineStories(again, { club, items: [], tags: new Map(), played: [], now: at('2026-10-22T19:00:00Z') });
  assert.equal(later.storyline?.isNew, false, 'nothing new since it aired');
});
