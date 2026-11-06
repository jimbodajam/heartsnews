// Fixes from watching the 6 Nov post-Thun bulletin: a match story's card doesn't take a face from its summary, a quote
// card sits on the line that says it, a player's package has the expert name him, and a milestone still to come isn't
// said for a player who is out injured. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlineGraphic, quoteLine } from '../src/script/assemble.ts';
import { aboutThePerson } from '../src/script/llm.ts';
import { milestonesFor } from '../src/script/milestones.ts';
import type { Line } from '../../shared/bulletin.ts';
import type { Story } from '../src/stories.ts';

test('a match story takes no portrait from its summary, and keeps the ball card', () => {
  const s = { id: 's', title: 'Thun v Hearts', summary: 'Laurent Mendy was the only fit central midfielder.', category: 'match', sources: ['Daily Record'] } as unknown as Story;
  const g = headlineGraphic(s);
  assert.equal(g.type, 'headline');
  assert.equal(g.type === 'headline' && g.face, undefined);
  assert.equal(g.type === 'headline' && g.icon, 'ball');
});

test('a quote goes on the line that talks about it, or on none', () => {
  const line = (text: string): Line => ({ speaker: 'kirsty', text });
  const lines = [
    line('He pulled up with a hamstring issue against Thun and is likely to be sidelined.'),
    line('And Wouter Vrancken was quite frank about the wider picture, wasn\'t he?'),
    line('He was. The head coach admitted they were simply not good enough and lacked confidence.'),
  ];
  assert.equal(quoteLine(lines, 'Not good enough, simple in general.'), lines[2]);
  assert.equal(quoteLine(lines, 'We will go again on Sunday against Falkirk.'), undefined);
});

test("a player's package has the expert name him", () => {
  const story = { title: 'Tom Renaud injury', storyline: { kind: 'person' } } as unknown as Story;
  const lead = { role: 'lead' as const, text: 'Kirsty, Tom Renaud is among the long-term absentees.' };
  assert.equal(aboutThePerson(story, [lead, { role: 'expert', text: 'It was a difficult night on that artificial surface.' }]), false);
  assert.equal(aboutThePerson(story, [lead, { role: 'expert', text: 'Renaud has not trained since the summer.' }]), true);
  assert.equal(aboutThePerson({ ...story, storyline: { kind: 'club' } } as unknown as Story, [lead]), true);
});

test('a milestone still to come is not said for a player out injured; one reached still is', () => {
  const m = (over: object) => ({ id: 'milne', name: 'Harry Milne', kind: 'apps' as const, mark: 50, total: 49, reached: false, to: 1, ...over });
  const out = new Set(['milne']);
  assert.equal(milestonesFor('reaction', [m({})], out).length, 0);
  assert.equal(milestonesFor('preview', [m({})], out).length, 0);
  assert.equal(milestonesFor('reaction', [m({ reached: true, to: 0, total: 50 })], out).length, 1);
  assert.equal(milestonesFor('reaction', [m({})]).length, 1);
});
