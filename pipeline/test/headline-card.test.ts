// The headline card (#112): a story led by one of the four papers gets that paper's front page, any other source keeps
// the plain headline card, and a story with a portrait keeps the card that can show the face. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlineGraphic } from '../src/script/assemble.ts';
import type { Story } from '../src/stories.ts';

const story = (source: string, title = 'Board confirm stadium plans', summary = 'Plans for the ground.'): Story =>
  ({ id: 's1', title, summary, category: 'news', sources: [source] }) as unknown as Story;

test('a story led by a paper gets that paper\'s front page', () => {
  const cases: [string, string, string][] = [
    ['Daily Record', 'daily-record', 'Daily Record'],
    ['The Scotsman', 'scotsman', 'Scotsman'],
    ['Edinburgh Evening News', 'evening-news', 'Evening News'],
    ['The Herald', 'herald', 'Herald'],
  ];
  for (const [source, outlet, paper] of cases) {
    assert.deepEqual(headlineGraphic(story(source)), { type: 'frontpage', outlet, paper, headline: 'Board confirm stadium plans' }, source);
  }
});

test('any other lead source keeps the headline card', () => {
  const g = headlineGraphic(story('BBC Sport'));
  assert.equal(g.type, 'headline');
});

test('only the lead source counts, and a long headline is cut to fit', () => {
  const other = { ...story('BBC Sport'), sources: ['BBC Sport', 'Daily Record'] } as Story;
  assert.equal(headlineGraphic(other).type, 'headline');
  const long = headlineGraphic(story('Daily Record', 'x'.repeat(300)));
  assert.equal(long.type, 'frontpage');
  assert.ok(long.type === 'frontpage' && long.headline.length <= 140);
});
