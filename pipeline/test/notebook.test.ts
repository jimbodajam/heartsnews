// Story engine 3 (#26): presenter notebooks and beats. Who picks up a storyline, what each presenter is briefed with,
// and takes saved against the right storyline and person, through the real migrations like store.test.ts.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { emptyMemory, type Memory, type Opinion } from '../src/memory.ts';
import type { OnAirStoryline } from '../src/onair.ts';
import type { Draft } from '../src/script/draft.ts';
import { buildFacts, expertFor, type Channel } from '../src/script/facts.ts';
import { mergeDraft } from '../src/script/llm.ts';
import { beatFor, notebookLines, personIn } from '../src/script/notebook.ts';
import { remember } from '../src/script/remember.ts';
import { templateDraft } from '../src/script/draft.ts';
import { connectStore, loadMemory, saveBuild } from '../src/store.ts';
import type { Story } from '../src/stories.ts';
import type { ClubConfig } from '../src/types.ts';
import { memoryD1 } from './d1.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const NOW = new Date('2026-10-24T12:00:00Z');

const storyline = (id: number, kind: OnAirStoryline['kind'], known = ''): OnAirStoryline => ({
  id,
  kind,
  brief: { known, disputed: '', latest: '' },
  claims: [],
  isNew: true,
  newSinceInDepth: true,
  justIn: [],
});

const story = (id: string, title: string, over: Partial<Story> = {}): Story => ({
  id,
  title,
  summary: '',
  category: 'news',
  sources: ['BBC Sport'],
  latest: '2026-10-24T09:00:00.000Z',
  score: 1,
  items: [],
  people: [],
  ...over,
});

const milne = story('s1', 'Milne injury', { category: 'injury', people: ['harry-milne'], storyline: storyline(11, 'person', 'Harry Milne is out with a hamstring injury.') });
const signing = story('s2', 'Hearts close in on striker', { category: 'transfer', people: ['joe-bloggs'], storyline: storyline(12, 'person') });
const derby = story('s3', 'Hearts v Hibs', { category: 'match', storyline: storyline(13, 'match', 'Hearts host Hibs on Saturday.') });
const varRow = story('s4', 'Hearts v Hibs', { category: 'match', storyline: storyline(14, 'match', 'A VAR check ruled out the equaliser.') });
const academy = story('s5', 'Academy prospect handed debut', { people: ['kyle-young'], storyline: storyline(15, 'person') });
const women = story('s6', 'Hearts Women top the SWPL', { category: 'match' });
const stadium = story('s7', 'Tynecastle capacity plans', { people: ['harry-milne', 'wouter-vrancken'], storyline: storyline(16, 'club') });

const take = (over: Partial<Opinion>): Opinion => ({ topic: 'x', view: 'y', at: '2026-10-20T10:00:00.000Z', ...over });
const withTakes = (presenters: Record<string, Opinion[]>): Memory => ({
  ...emptyMemory(),
  presenters: Object.fromEntries(Object.entries(presenters).map(([id, opinions]) => [id, { opinions, predictions: [] }])),
});
const facts = (stories: Story[], memory = emptyMemory()) => buildFacts(club, channel, stories, [], undefined, NOW, memory);

test('beats: transfers to Ross, injuries to Kirsty, a VAR row and the academy to Fraser, Hearts Women to Kirsty', () => {
  assert.equal(beatFor(channel, signing), 'ross');
  assert.equal(beatFor(channel, milne), 'kirsty');
  assert.equal(beatFor(channel, derby), 'ross');
  assert.equal(beatFor(channel, varRow), 'fraser');
  assert.equal(beatFor(channel, academy), 'fraser');
  assert.equal(beatFor(channel, women), 'kirsty');
  assert.equal(beatFor(channel, stadium), undefined);
});

test('the same presenter takes a storyline every time it comes round, never the lead anchor', () => {
  const f = facts([milne]);
  const once = expertFor(f, milne);
  f.memory.aired.push({ title: 'Milne injury', firstAired: '', lastAired: '', times: 3, inDepth: 1 });
  assert.equal(expertFor(f, milne), once);
  assert.equal(once, 'kirsty');
});

test('a storyline with no beat goes to whoever has held the strongest view on the people in it', () => {
  const memory = withTakes({
    ross: [take({ entity: 'harry-milne', strength: 2, at: '2026-10-22T10:00:00.000Z' })],
    kirsty: [take({ entity: 'wouter-vrancken', strength: 3, at: '2026-10-01T10:00:00.000Z' })],
    isla: [take({ entity: 'harry-milne', strength: 3 })],
  });
  assert.equal(expertFor(facts([stadium], memory), stadium), 'kirsty');
  // With no past takes, the co-anchor picks it up as before.
  assert.equal(expertFor(facts([stadium]), stadium), 'fraser');
});

test("a notebook has the presenter's leanings and their own takes on the story, latest first", () => {
  const memory = withTakes({
    ross: [
      take({ topic: 'Milne', view: "He'll be back for the derby", storyline: 11, strength: 2, at: '2026-10-21T10:00:00.000Z' }),
      take({ topic: 'Milne', view: 'Best left-back in the league', entity: 'harry-milne', storyline: 11, strength: 3, at: '2026-10-23T10:00:00.000Z' }),
      take({ topic: 'xG', view: 'Underrated', at: '2026-10-22T10:00:00.000Z' }),
    ],
    fraser: [take({ topic: 'Milne', view: 'Overrated', entity: 'harry-milne' })],
  });
  const lines = notebookLines(facts([milne], memory), 'ross', [milne], (at) => at.slice(0, 10));
  assert.match(lines[0], /^leanings: trusts the numbers/);
  assert.equal(lines[1], `on Milne: "Best left-back in the league" (2026-10-23, staked their name on it); before that "He'll be back for the derby" (2026-10-21, firmly)`);
  assert.equal(lines[2], 'other recent views: xG: "Underrated" (2026-10-22)');
  assert.ok(!lines.join(' ').includes('Overrated'), "Fraser's take isn't in Ross's notebook");
});

test('takes are saved against their storyline and the person named in them', () => {
  const f = facts([milne, stadium]);
  const draft: Draft = {
    ...templateDraft(f),
    opinions: [
      { speaker: 'ross', storyId: 's1', topic: 'Milne', view: 'The side is weaker without him', strength: 3 },
      { speaker: 'kirsty', storyId: 's7', topic: 'Vrancken and the plans', view: 'Vrancken will want the bigger crowd', strength: 1 },
      { speaker: 'fraser', topic: 'VAR', view: 'Still ruining the game' },
    ],
  };
  assert.deepEqual(remember(f, draft).takes, [
    { presenter: 'ross', topic: 'Milne', view: 'The side is weaker without him', storyline: 11, entity: 'harry-milne', strength: 3 },
    { presenter: 'kirsty', topic: 'Vrancken and the plans', view: 'Vrancken will want the bigger crowd', storyline: 16, entity: 'wouter-vrancken', strength: 1 },
    { presenter: 'fraser', topic: 'VAR', view: 'Still ruining the game' },
  ]);
  assert.equal(personIn('Milne and Vrancken', stadium, [stadium]), undefined, 'two people named: no one person');
});

test("the lead anchor's opinions aren't kept, and a story id must be one on this bulletin", () => {
  const f = facts([milne]);
  const merged = mergeDraft(templateDraft(f), {
    opinions: [
      { speaker: 'isla', topic: 'Milne', view: 'Should start' },
      { speaker: 'ross', storyId: 's1 | injury', topic: 'Milne', view: 'Should start', strength: 7 },
      { speaker: 'fraser', storyId: 'nope', topic: 'Milne', view: 'Should not' },
    ],
  }, f);
  assert.deepEqual(merged.opinions, [
    { speaker: 'ross', storyId: 's1', topic: 'Milne', view: 'Should start', strength: 3 },
    { speaker: 'fraser', topic: 'Milne', view: 'Should not' },
  ]);
});

test('the store keeps the latest three takes on each storyline or person, and fifteen others', async () => {
  const d1 = memoryD1();
  const store = connectStore('t', 'https://store.test/store', (async (url: string | URL | Request, init?: RequestInit) =>
    endpoint(new Request(url, init), { DB: d1, STORE_TOKEN: 't' })) as typeof fetch);
  const entities = [{ id: 'harry-milne', type: 'player' as const, name: 'Harry Milne', aliases: [] }];
  d1.db.prepare(`INSERT INTO storylines (id, title, opened_at, updated_at) VALUES (11, 'Milne injury', ?, ?)`).run('2026-10-01', '2026-10-01');

  const save = (at: Date, takes: { presenter: string; topic: string; view: string; storyline?: number; entity?: string; strength?: number }[]) =>
    saveBuild(store, { bulletin: { id: at.toISOString(), phase: 'normal', runner: 'home' }, items: [], entities, tags: new Map(), remembered: { aired: [], takes, predictions: [] }, settled: [], renames: [] }, at);

  for (let i = 0; i < 5; i++) await save(new Date(Date.UTC(2026, 9, 1 + i)), [{ presenter: 'ross', topic: 'Milne', view: `view ${i}`, storyline: 11, entity: 'harry-milne', strength: 2 }]);
  for (let i = 0; i < 20; i++) await save(new Date(Date.UTC(2026, 9, 6, i)), [{ presenter: 'ross', topic: 'xG', view: `other ${i}` }]);
  // A storyline or person the store doesn't have isn't linked, but the take is kept.
  await save(new Date(Date.UTC(2026, 9, 7)), [{ presenter: 'ross', topic: 'Nobody', view: 'Who?', storyline: 99, entity: 'nobody' }]);
  // Over 90 days ago: out of the notebook.
  await save(new Date(Date.UTC(2026, 5, 1)), [{ presenter: 'ross', topic: 'Old', view: 'Long ago', entity: 'harry-milne' }]);

  const m = await loadMemory(store, NOW);
  const ross = m.presenters.ross.opinions;
  assert.deepEqual(ross.filter((t) => t.storyline === 11).map((t) => t.view), ['view 2', 'view 3', 'view 4']);
  assert.deepEqual(ross.find((t) => t.storyline === 11), { topic: 'Milne', view: 'view 2', at: '2026-10-03T00:00:00.000Z', storyline: 11, entity: 'harry-milne', strength: 2 });
  assert.equal(ross.filter((t) => t.storyline === undefined && t.entity === undefined).length, 15);
  assert.ok(ross.some((t) => t.view === 'Who?'));
  assert.ok(!ross.some((t) => t.view === 'Long ago'));
});

test("a view that only says again what they've said isn't saved, but a change of mind is", () => {
  const memory = withTakes({
    ross: [take({ topic: 'Away win data', view: 'Advanced metrics and structured pressing fully compensate for missing players to guarantee an away win.' })],
    fraser: [take({ topic: 'Milne', view: "Milne will be back for the derby", storyline: 11 })],
  });
  const f = facts([milne], memory);
  const draft: Draft = {
    ...templateDraft(f),
    opinions: [
      { speaker: 'ross', topic: 'Data metrics', view: 'Advanced metrics and structured pressing fully cover for missing players and guarantee an away win.' },
      { speaker: 'fraser', topic: 'Fir Park approach', view: 'Traditional grit and a narrow one-nil win is all we need at Fir Park.' },
      { speaker: 'fraser', topic: 'Fir Park approach', view: 'Maintains that traditional grit and a narrow one-nil win is all we need at Fir Park.' },
      { speaker: 'fraser', storyId: 's1', topic: 'Milne', view: "Now thinks Milne won't be back for the derby after the scan" },
    ],
  };
  assert.deepEqual(remember(f, draft).takes.map((t) => `${t.presenter}: ${t.view}`), [
    'fraser: Traditional grit and a narrow one-nil win is all we need at Fir Park.',
    "fraser: Now thinks Milne won't be back for the derby after the scan",
  ]);
});

test('"now thinks" in front of the same view isn\'t a change of mind; the opposite view is, even without it', () => {
  // As Ross's takes went on 24 Oct: the same view with "now thinks" in front was saved every half hour.
  const memory = withTakes({
    ross: [take({ topic: 'Away win data', view: 'Advanced metrics and structured pressing fully compensate for missing players to guarantee an away win.' })],
    fraser: [take({ topic: 'Milne', view: 'Milne will be back for the derby', storyline: 11 })],
  });
  const f = facts([milne], memory);
  const draft: Draft = {
    ...templateDraft(f),
    opinions: [
      { speaker: 'ross', topic: 'Motherwell match tactics', view: 'now thinks advanced metrics and structured pressing fully compensate for missing players to guarantee an away win' },
      { speaker: 'fraser', storyId: 's1', topic: 'Milne', view: "Milne won't be back for the derby" },
      { speaker: 'ross', topic: 'Kirsty', view: 'Admits he was wrong: advanced metrics and structured pressing fully compensate for nothing' },
    ],
  };
  assert.deepEqual(remember(f, draft).takes.map((t) => `${t.presenter}: ${t.view}`), [
    "fraser: Milne won't be back for the derby",
    'ross: Admits he was wrong: advanced metrics and structured pressing fully compensate for nothing',
  ]);
});

test('a view said again and again shows once in the notebook, with how often', () => {
  const view = (n: number, v: string) => take({ topic: `Data ${n}`, view: v, at: `2026-10-24T0${n}:00:00.000Z` });
  const memory = withTakes({
    ross: [
      view(1, 'Structured pressing triggers and data metrics are vital to cover for injured players.'),
      view(2, 'Wilson is the best signing of the window.'),
      view(3, 'Structured pressing triggers and data metrics remain essential to cover for injured players.'),
      view(4, 'Advanced data metrics and structured pressing triggers are essential to cover for injured players.'),
    ],
  });
  const lines = notebookLines(facts([], memory), 'ross', [], (at) => at.slice(11, 16));
  assert.equal(
    lines.find((l) => l.startsWith('other recent views')),
    'other recent views: Data 4: "Advanced data metrics and structured pressing triggers are essential to cover for injured players." (04:00, said 3 times already); Data 2: "Wilson is the best signing of the window." (02:00)',
  );
});
