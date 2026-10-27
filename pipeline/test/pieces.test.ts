// Issue #51: each script piece is briefed with only what it needs: its own presenters, the style rules for its kind
// of piece, the match data its story calls for. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { emptyMemory } from '../src/memory.ts';
import { templateDraft } from '../src/script/draft.ts';
import { buildFacts, type Channel } from '../src/script/facts.ts';
import type { ScriptModel } from '../src/script/llm.ts';
import { writeInPieces } from '../src/script/pieces.ts';
import type { Story } from '../src/stories.ts';
import type { ClubConfig } from '../src/types.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const NOW = new Date('2026-10-24T12:00:00Z');

const text = 'Harry Milne is expected to return from his hamstring injury next week, the club has said. '.repeat(8);
const milne: Story = {
  id: 's1',
  title: 'Milne injury',
  summary: 'Milne is back next week.',
  category: 'injury',
  sources: ['BBC Sport'],
  latest: '2026-10-24T09:00:00.000Z',
  score: 1,
  items: [],
  people: ['harry-milne'],
  articles: [{ outlet: 'BBC Sport', text }],
  body: text,
};

/** Every prompt the pieces send, by piece id, with the model answering nothing (the templates stand in). */
async function prompts(stories: Story[]): Promise<Record<string, string>> {
  const f = buildFacts(club, channel, stories, [], undefined, NOW, emptyMemory());
  const model: ScriptModel = { name: 'test', generateJson: async () => ({}) };
  return (await writeInPieces(model, f, templateDraft(f))).prompts;
}

test('a package names only its own two presenters, and carries none of the rules for other pieces', async () => {
  const p = (await prompts([milne]))['story-s1'];
  assert.ok(p, 'the story gets a package');
  const names = channel.presenters.map((x) => x.name.split(' ')[0]);
  const cast = p.slice(p.indexOf('Presenters (stay in character'), p.indexOf('Style rules:'));
  assert.equal(names.filter((n) => cast.includes(`- ${n}`)).length, 2, cast);
  assert.ok(!p.includes('Fan forum posts'), 'forum rules are for the fan zone and debate');
  assert.ok(!p.includes('Hearts Standard is a Newsquest'), 'no Hearts Standard in this story');
  assert.ok(!p.includes('League table'), 'a story about an injury is not given the table');
});

test("a package asks for a quote or a match report's scorers only when its source could have them", async () => {
  const injury = await prompts([milne]);
  assert.ok(!injury['story-s1'].includes('quote is optional'));
  assert.ok(!injury['story-s1'].includes('result: only for a match report'));
  assert.ok(!injury['story-s1'].includes('covered in depth before'), 'a first package has no earlier one to refer to');

  const quoted = { ...milne, articles: [{ outlet: 'BBC Sport', text: `${text} "He looks sharp in training," said the boss.` }] };
  assert.ok((await prompts([quoted]))['story-s1'].includes('quote is optional'));
  assert.ok((await prompts([{ ...milne, category: 'match' }]))['story-s1'].includes('result: only for a match report'));
});

test('the fan zone and the debate keep the forum rules, and the headlines have a short look at the articles', async () => {
  const all = await prompts([milne]);
  assert.ok(all.fans.includes('Fan forum posts'));
  assert.ok(all.debate.includes('Fan forum posts'));
  assert.ok(!all.headlines.includes('Fan forum posts'));
  assert.ok(all.headlines.length < all['story-s1'].length + 2000);
});
