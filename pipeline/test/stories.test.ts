// Story engine stage 1 (#24): tagging items by who and what they're about, grouping stories by it, and writing a
// story from several outlets. The fixture is the injury news collected on 22 and 23 Oct 2026. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { seedEntities, type Entity } from '../src/entities.ts';
import { addOwnText, buildStories } from '../src/stories.ts';
import { categorise, mood, tagItems } from '../src/tags.ts';
import type { ClubConfig, Item } from '../src/types.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/2026-10-22-milne-items.json', import.meta.url), 'utf8')) as Item[];
const NOW = new Date('2026-10-23T20:00:00Z');

const squad = [
  { name: 'Harry Milne', role: 'player' as const },
  { name: 'Christian Borchgrevink', role: 'player' as const },
  { name: 'Craig Halkett', role: 'player' as const },
  { name: 'Rogers Mato', role: 'player' as const },
  { name: 'James Wilson', role: 'player' as const },
  { name: 'Tom White', role: 'staff' as const },
  { name: 'Wouter Vrancken', role: 'staff' as const },
  { name: 'JJ Williams', role: 'player' as const },
  { name: 'Mikey Williams', role: 'staff' as const },
];
const entities = seedEntities(club, undefined, [squad]);

const item = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id,
  sourceId: 'bbc',
  sourceName: 'BBC Sport',
  kind: 'press',
  title,
  summary: '',
  url: `https://example.com/${id}`,
  publishedAt: '2026-10-22T12:00:00.000Z',
  ...extra,
});

test('a surname is an alias unless two people share it', () => {
  const byId = new Map<string, Entity>(entities.map((e) => [e.id, e]));
  assert.deepEqual(byId.get('harry-milne')?.aliases, ['Milne']);
  assert.deepEqual(byId.get('jj-williams')?.aliases, []);
  assert.deepEqual(byId.get('hearts')?.aliases, ['Hearts', 'Jambos', 'Jam Tarts']);
});

test('tags name people by full name, or by a capitalised surname, and pick a category and mood', () => {
  const tags = tagItems(
    [
      item('a', 'Milne ruled out for the season', { summary: 'A blow for Wouter Vrancken.' }),
      item('b', 'WOUTER VRANCKEN | Reason for so many injuries'),
      item('c', 'Hearts in white for the cup', { summary: 'Williams starts.' }),
      item('d', 'Fans react', { kind: 'forum' }),
    ],
    entities,
  );
  assert.deepEqual(tags.get('a'), {
    category: 'injury',
    mood: 'bad',
    entities: ['harry-milne', 'wouter-vrancken'],
    people: ['harry-milne', 'wouter-vrancken'],
    about: ['harry-milne'],
  });
  assert.deepEqual(tags.get('b')?.about, ['wouter-vrancken']);
  // "white" isn't Tom White, and "Williams" could be either of them.
  assert.deepEqual(tags.get('c')?.entities, ['hearts']);
  assert.equal(tags.has('d'), false);
});

test('categories: a new deal is a contract, not a transfer; a red card is discipline', () => {
  assert.equal(categorise('Shankland signs new contract until 2029'), 'contract');
  assert.equal(categorise('Hearts linked with Aberdeen striker'), 'transfer');
  assert.equal(categorise('Kingsley handed two-match ban after red card'), 'discipline');
  assert.equal(categorise('Hearts 3-1 Hibs: player ratings'), 'match');
  assert.equal(categorise('Club announces new kit'), 'news');
  assert.equal(mood('Hearts boosted as Shankland returns'), 'good');
});

test('the 22 Oct Milne injury news comes out as one story with several sources', () => {
  const stories = buildStories(fixture, club, NOW, tagItems(fixture, entities));
  const milne = stories.filter((s) => s.items.some((it) => /Milne/.test(it.title)));
  assert.equal(milne.length, 1, milne.map((s) => s.title).join(' / '));
  const [story] = milne;
  assert.equal(story.category, 'injury');
  assert.ok(story.sources.length >= 4, story.sources.join(', '));
  for (const title of ['Hearts rocked by Harry Milne injury blow', 'Wouter Vrancken reveals Hearts dressing room message after double injury blow']) {
    assert.ok(story.items.some((it) => it.title === title), title);
  }
  assert.ok(story.people.includes('harry-milne'));
  // Without tags it's how it used to be: headline words alone split it up.
  assert.ok(buildStories(fixture, club, NOW).filter((s) => s.items.some((it) => /Milne/.test(it.title))).length > 2);
});

test('the same person is a different story in another category, or days apart', () => {
  const items = [
    item('a', 'Milne ruled out with knee injury'),
    item('b', 'Milne signs new contract', { publishedAt: '2026-10-22T13:00:00.000Z' }),
    item('c', 'Milne hamstring setback', { publishedAt: '2026-10-26T12:00:00.000Z' }),
    item('d', 'Milne injury: what Vrancken said', { publishedAt: '2026-10-23T09:00:00.000Z' }),
  ];
  const stories = buildStories(items, club, NOW, tagItems(items, entities));
  assert.deepEqual(stories.map((s) => s.items.map((it) => it.id).sort().join('')).sort(), ['ad', 'b', 'c']);
});

test('a story from headlines alone is written from a transcript or its longest summary, never a fetched page', () => {
  const title = 'Harry Milne ruled out with knee injury';
  const [withVideo] = buildStories(
    [item('a', title, { summary: 'Short.' }), item('b', title, { kind: 'video', sourceName: 'Hearts TV', transcript: `Vrancken: ${'He is out. '.repeat(40)}` })],
    club,
    NOW,
  );
  const [withSummaries] = buildStories([item('c', title, { summary: 'Short.' }), item('d', title, { sourceName: 'Daily Record', summary: 'A much longer summary of it.' })], club, NOW);
  addOwnText([withVideo, withSummaries]);
  assert.deepEqual(withVideo.articles?.map((a) => a.outlet), ['Hearts TV']);
  assert.ok(withVideo.body?.startsWith('Vrancken'));
  assert.deepEqual(withSummaries.articles, [{ outlet: 'Daily Record', text: 'A much longer summary of it.' }]);
});
