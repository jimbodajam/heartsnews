// The announced team in the Match Centre and the Opposition Focus between the team news and kick-off (issue #36), against
// the recording of Trabzonspor v Hearts (22 Oct 2026), team out at 16:30 for a 16:45 kick-off. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { liveMatch, type TeamSheet } from '../../shared/live.ts';
import type { Announced } from '../src/announced.ts';
import { assemble } from '../src/script/assemble.ts';
import { templateDraft } from '../src/script/draft.ts';
import { buildFacts, type Channel } from '../src/script/facts.ts';
import { pageAt, type Recording } from '../src/trim-recording.ts';
import type { ClubConfig, Fixture, OpponentFocus } from '../src/types.ts';

const rec = JSON.parse(readFileSync(new URL('../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json', import.meta.url), 'utf8')) as Recording;
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;

const m = liveMatch(rec.teamEvent, 'heart-of-midlothian', pageAt(rec, Date.parse('2026-10-22T16:30:00Z')));
const ours = m.lineups!.away!;
const theirs = m.lineups!.home!;
const game: Fixture = { date: '2026-10-22T16:45:00.000Z', home: 'Trabzonspor', away: 'Hearts', competition: 'UEFA Conference League', status: 'pre' };
const now = new Date('2026-10-22T16:35:00Z');

// Last game's XI: the same but the keeper and the left back are different people.
const swap = (s: TeamSheet): TeamSheet => ({ ...s, rows: s.rows.map((r, i) => (i === 0 ? [{ ...r[0], urn: 'other-keeper', shirt: 'Clark' }] : r)) });
const announced: Announced = { ours, theirs, opponent: 'Trabzonspor', previous: { sheet: swap(ours), against: 'Motherwell' } };
const opponent: OpponentFocus = { fixture: game, opponent: 'Trabzonspor', results: [], confirmed: false };

const build = (a?: Announced) => {
  const f = buildFacts(club, channel, [], [], { next: [game], last: [], table: [], opponent }, now, undefined, undefined, undefined, a);
  return assemble(f, templateDraft(f), 'templates');
};

test('Match Centre reads the whole team, the shape as expected, the changes and the bench', () => {
  const mc = build(announced).segments.find((s) => s.id === 'match')!;
  const text = mc.lines.map((l) => l.text).join('\n');
  assert.equal(mc.lines.filter((l) => l.graphic?.type === 'player').length, 11);
  assert.match(text, /In goal, number 1, Beau Reus/);
  assert.match(text, /expected to line up in a 4-3-3, with one change from the side that started against Motherwell/);
  assert.doesNotMatch(text, /start with a 4-3-3|start in a 4-3-3/);
  const shape = mc.lines.find((l) => l.graphic?.type === 'formation');
  assert.ok(shape?.graphic?.type === 'formation' && shape.graphic.label === 'EXPECTED' && shape.graphic.ours);
  assert.deepEqual(shape.graphic.changes, ['Reus']);
  assert.equal(mc.lines.filter((l) => l.graphic?.type === 'bench').length, 1);
});

test('Match Centre has no team before it is announced', () => {
  const mc = build().segments.find((s) => s.id === 'match')!;
  assert.equal(mc.lines.filter((l) => ['player', 'bench'].includes(l.graphic?.type ?? '')).length, 0);
});

test('Opposition Focus says the shape as expected and shows our changes', () => {
  const opp = build(announced).segments.find((s) => s.id === 'opponent')!;
  const formations = opp.lines.flatMap((l) => (l.graphic?.type === 'formation' ? [{ l, g: l.graphic }] : []));
  assert.equal(formations.length, 2);
  for (const { g } of formations) assert.equal(g.label, 'EXPECTED');
  assert.match(formations[0].l.text, /^Trabzonspor are expected to go with/);
  assert.match(formations[1].l.text, /expected to line up in a 4-3-3, with one change/);
  assert.deepEqual(formations[1].g.changes, ['Reus']);
});

test('Opposition Focus uses our team before theirs is out', () => {
  const opp = build({ ...announced, theirs: undefined }).segments.find((s) => s.id === 'opponent')!;
  assert.equal(opp.lines.filter((l) => l.graphic?.type === 'formation').length, 1);
});
