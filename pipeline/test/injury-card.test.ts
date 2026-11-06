// The injury card (issue #108): built from a player's injury row, and put on a person injury storyline's package only.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { injuryGraphic, type Injury } from '../src/injuries.ts';
import { injuryCardFor } from '../src/script/assemble.ts';
import type { Story } from '../src/stories.ts';

const row = (over: Partial<Injury> = {}): Injury => ({
  storylineId: 1,
  n: 1,
  entity: 'stephen-kingsley',
  name: 'Stephen Kingsley',
  area: 'hamstring',
  side: 'left',
  type: 'muscle',
  claims: [1],
  inTraining: false,
  firstReportedAt: '2026-11-03T09:00:00.000Z',
  injuredMatchId: '2026-10-25|Motherwell|Hearts',
  injuredAt: '2026-10-25T15:00:00.000Z',
  dateBasis: 'match',
  claimedStatus: 'out',
  status: 'out',
  confirmed: true,
  locked: false,
  ...over,
});

test('a confirmed injury dated to a match, with a return period and games missed', () => {
  const g = injuryGraphic(row({ returnFrom: '2026-11-23T09:00:00.000Z', returnTo: '2026-12-07T09:00:00.000Z', gamesMissed: 3 }), 'Hearts', 'faces/stephen-kingsley.png');
  assert.deepEqual(g, {
    type: 'injury',
    name: 'Stephen Kingsley',
    face: 'faces/stephen-kingsley.png',
    injury: 'LEFT HAMSTRING',
    kind: 'MUSCLE',
    status: 'OUT',
    reported: false,
    since: 'Injured v Motherwell, 25 Oct',
    back: '23 Nov to 7 Dec',
    gamesMissed: 3,
  });
});

test('one outlet\'s word is REPORTED, and a first report is dated from the report', () => {
  const g = injuryGraphic(row({ confirmed: false, dateBasis: 'first_report', injuredMatchId: undefined }), 'Hearts');
  assert.equal(g.reported, true);
  assert.equal(g.since, 'First reported 3 Nov');
  assert.equal(g.face, undefined);
  assert.equal(g.gamesMissed, undefined);
});

test('each kind of return: one date, a band, or nothing', () => {
  const back = (over: Partial<Injury>) => injuryGraphic(row(over), 'Hearts').back;
  assert.equal(back({ returnFrom: '2026-11-23T09:00:00.000Z', returnTo: '2026-11-23T09:00:00.000Z' }), 'Around 23 Nov');
  assert.equal(back({ returnBand: 'short' }), 'Short-term');
  assert.equal(back({ returnBand: 'medium' }), 'Several weeks');
  assert.equal(back({ returnBand: 'long' }), 'Long-term');
  assert.equal(back({ returnBand: 'season' }), 'Season over');
  assert.equal(back({}), 'No date given');
  assert.equal(back({ returnEstimate: 'until after the international break' }), 'No date given');
});

test('area and type not reported: INJURY and no label; illness is not repeated; every status', () => {
  const g = injuryGraphic(row({ area: undefined, side: undefined, type: 'unknown' }), 'Hearts');
  assert.equal(g.injury, 'INJURY');
  assert.equal(g.kind, undefined);
  assert.equal(injuryGraphic(row({ area: 'illness', side: undefined, type: 'illness' }), 'Hearts').kind, undefined);
  const s = (status: Injury['status']) => injuryGraphic(row({ status }), 'Hearts').status;
  assert.deepEqual([s('out'), s('doubt'), s('back'), s('unknown')], ['OUT', 'DOUBT', 'BACK', 'UNCLEAR']);
});

const facts = { club: { shortName: 'Hearts' }, injuries: { current: [row()], back: [row({ entity: 'lawrence-shankland', name: 'Lawrence Shankland', status: 'back' })] } } as unknown as Parameters<typeof injuryCardFor>[0];
const story = (over: Partial<Story> & { kind?: string } = {}): Story =>
  ({ id: 'l1', title: 'Kingsley injury', category: 'injury', people: ['stephen-kingsley'], storyline: { kind: over.kind ?? 'person' }, ...over }) as unknown as Story;

test('only a person injury storyline with a row gets the card (a player just back included)', () => {
  assert.equal(injuryCardFor(facts, story())?.name, 'Stephen Kingsley');
  assert.equal(injuryCardFor(facts, story({ people: ['lawrence-shankland'] }))?.status, 'BACK');
  assert.equal(injuryCardFor(facts, story({ people: ['someone-else'] })), undefined);
  assert.equal(injuryCardFor(facts, story({ kind: 'club', people: [] })), undefined);
  assert.equal(injuryCardFor(facts, story({ category: 'transfer' })), undefined);
  assert.equal(injuryCardFor({ ...facts, injuries: undefined }, story()), undefined);
});
