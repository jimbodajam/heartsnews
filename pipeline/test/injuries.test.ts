// The injury table (issue #107): what the brief request reads, and the dates worked out from our line-ups count.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fromReading,
  injuryFacts,
  injuryList,
  missingLine,
  parseInjuries,
  parseReturn,
  settle,
  type Injury,
  type InjuryReading,
  type LineUps,
  type ReadingContext,
} from '../src/injuries.ts';
import { injuryWrites, loadOpenInjuries, settleInjuries, type Store } from '../src/store.ts';
import { briefPrompt, injuryRows, parseBriefs, type Claim, type Storyline } from '../src/storylines.ts';
import { memoryD1 } from './d1.ts';

const d1store = (d1: ReturnType<typeof memoryD1>): Store => ({
  batch: async (statements) => (await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...(s.params ?? []))))).map((r) => (r.results ?? []) as Record<string, unknown>[]),
});

const game = (date: string, opp: string, home = true) => ({ id: `${date}|${home ? 'Hearts' : opp}|${home ? opp : 'Hearts'}`, date: `${date}T15:00:00.000Z` });
const G = {
  motherwell: game('2026-10-25', 'Motherwell', false),
  rangers: game('2026-10-28', 'Rangers'),
  hibs: game('2026-11-01', 'Hibernian'),
  thun: game('2026-11-05', 'Thun', false),
};
const lineUps = (played: Record<string, (keyof typeof G)[]>): LineUps => ({
  games: Object.values(G),
  played: new Map(Object.entries(played).map(([who, gs]) => [who, new Set(gs.map((g) => G[g].id))])),
  since: '2026-10-10',
});

const claim = (id: number, firstSeen: string, outlets: string[], over: Partial<Claim> = {}): Claim => ({
  id,
  text: `claim ${id}`,
  status: 'reported',
  firstSeen,
  sources: outlets.map((outlet, i) => ({ item: `i${id}-${i}`, outlet, corroboration: 0, at: firstSeen })),
  ...over,
});
const storyline = (claims: Claim[], over: Partial<Storyline> = {}): Storyline => ({
  id: 17,
  kind: 'person',
  entity: 'stephen-kingsley',
  category: 'injury',
  title: 'Stephen Kingsley injury',
  status: 'open',
  openedAt: claims[0].firstSeen,
  updatedAt: claims.at(-1)!.firstSeen,
  claims,
  ...over,
});
const reading = (over: Partial<InjuryReading> = {}): InjuryReading => ({ area: 'hamstring', type: 'muscle', status: 'out', byClub: false, claims: [1], ...over });
const ctx: ReadingContext = { clubOutlets: new Set(['official']), shows: new Set(['hearts-standard']) };
const NOW = new Date('2026-11-06T12:00:00Z');

test('a return period is counted from the claim that gave it', () => {
  const from = '2026-11-01T10:00:00.000Z';
  assert.deepEqual(parseReturn('out for four to six weeks', from), { from: '2026-11-29T10:00:00.000Z', to: '2026-12-13T10:00:00.000Z', band: 'medium', said: 'four to six weeks' });
  assert.deepEqual({ ...parseReturn('4-6 weeks', from), said: '' }, { ...parseReturn('four to six weeks', from), said: '' });
  assert.deepEqual(parseReturn('around a fortnight', from), { from: '2026-11-15T10:00:00.000Z', to: '2026-11-15T10:00:00.000Z', band: 'short', said: 'a fortnight' });
  assert.equal(parseReturn('10 days', from).band, 'short');
  assert.equal(parseReturn('expected to miss at least two months', from).band, 'long');
});

test('"until the New Year" and a month are a date', () => {
  const from = '2026-11-04T10:00:00.000Z';
  assert.deepEqual(parseReturn('will be out until the New Year after meniscus surgery', from), { from: '2027-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z', band: 'long', said: 'until the new year' });
  assert.equal(parseReturn('back in March', from).from, '2027-03-01T00:00:00.000Z');
  assert.equal(parseReturn('out until December', from).band, 'medium');
});

test('a vague return period gets a band and no dates', () => {
  const from = '2026-11-01T10:00:00.000Z';
  assert.deepEqual(parseReturn('the rest of the season', from), { band: 'season', said: 'the rest of the season' });
  assert.deepEqual(parseReturn('months', from), { band: 'long', said: 'months' });
  assert.deepEqual(parseReturn('listed among long-term injury victims', from), { band: 'long', said: 'long-term' });
  assert.deepEqual(parseReturn('muscle injury, out for weeks', from), { band: 'medium', said: 'for weeks' });
  assert.deepEqual(parseReturn('a few days', from), { band: 'short', said: 'a few days' });
  assert.deepEqual(parseReturn('soon', from), {});
  assert.deepEqual(parseReturn(undefined, from), {});
});

test('an estimate the claims never gave is not used: the claims are read instead', () => {
  const s = storyline([claim(1, '2026-10-25T09:00:00.000Z', ['BBC Sport'], { text: 'Ageu expected to return next week' }), claim(2, '2026-10-28T09:00:00.000Z', ['BBC Sport'], { text: 'Ageu: muscle injury, out for weeks' })]);
  const row = fromReading(reading({ claims: [1, 2], estimate: 'four to six weeks', estimateClaim: 2 }), 1, s, ctx)!;
  assert.equal(row.returnEstimate, 'for weeks');
  assert.equal(row.returnBand, 'medium');
  assert.equal(row.returnFrom, undefined);
  // The newest claim's period wins over an older one ("next week" was before the scan).
  assert.equal(fromReading(reading({ claims: [1, 2], estimate: 'next week', estimateClaim: 1 }), 1, s, ctx)!.returnEstimate, 'for weeks');
  // The model's own words when no claim gives a period we can read, as long as they're a claim's.
  const vague = storyline([claim(3, '2026-11-04T09:00:00.000Z', ['BBC Sport'], { text: 'Magnusson out until after the international break' })]);
  const kept = fromReading(reading({ claims: [3], estimate: 'until after the international break' }), 1, vague, ctx)!;
  assert.deepEqual([kept.returnEstimate, kept.returnBand], ['until after the international break', undefined]);
  assert.equal(fromReading(reading({ claims: [3], estimate: 'six weeks' }), 1, vague, ctx)!.returnEstimate, undefined);
});

test('hurt in training: dated from the first report, not his last game', () => {
  const s = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['BBC Sport'])]);
  const i = settle(fromReading(reading({ inTraining: true }), 1, s, ctx)!, lineUps({ 'stephen-kingsley': ['motherwell'] }), NOW);
  assert.equal(i.dateBasis, 'first_report');
  assert.equal(i.injuredAt, '2026-10-27T09:00:00.000Z');
});

test('injured in his last game when the first report is within a week of it', () => {
  const s = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['BBC Sport'])]);
  const i = settle(fromReading(reading(), 1, s, ctx)!, lineUps({ 'stephen-kingsley': ['motherwell'] }), NOW);
  assert.equal(i.dateBasis, 'match');
  assert.equal(i.injuredMatchId, G.motherwell.id);
  assert.equal(i.injuredAt, G.motherwell.date);
  // Rangers, Hibs and Thun since, none played.
  assert.equal(i.gamesMissed, 3);
  assert.equal(i.status, 'out');
  assert.equal(i.returnedMatchId, undefined);
  assert.equal(i.daysOut, 12);
});

test('injured on the day of the first report when his last game was more than a week before', () => {
  const s = storyline([claim(1, '2026-11-03T09:00:00.000Z', ['BBC Sport'])]);
  const i = settle(fromReading(reading(), 1, s, ctx)!, lineUps({ 'stephen-kingsley': ['motherwell'] }), NOW);
  assert.equal(i.dateBasis, 'first_report');
  assert.equal(i.injuredAt, '2026-11-03T09:00:00.000Z');
  assert.equal(i.injuredMatchId, undefined);
  assert.equal(i.gamesMissed, 1); // Thun
});

test('a game the same day but after the first report is not where he got injured', () => {
  const s = storyline([claim(1, '2026-11-01T10:00:00.000Z', ['BBC Sport'])]);
  const i = settle(fromReading(reading(), 1, s, ctx)!, lineUps({ 'stephen-kingsley': ['rangers', 'hibs'] }), NOW);
  assert.equal(i.injuredMatchId, G.rangers.id);
  // He played against Hibs that afternoon: back.
  assert.equal(i.returnedMatchId, G.hibs.id);
});

test('he is back the first time he plays again, whatever the claims say, and the games in between are missed', () => {
  const s = storyline([claim(1, '2026-10-26T09:00:00.000Z', ['BBC Sport'])]);
  const i = settle(fromReading(reading({ status: 'out' }), 1, s, ctx)!, lineUps({ 'stephen-kingsley': ['motherwell', 'thun'] }), NOW);
  assert.equal(i.status, 'back');
  assert.equal(i.claimedStatus, 'out');
  assert.equal(i.returnedMatchId, G.thun.id);
  assert.equal(i.returnedAt, G.thun.date);
  assert.equal(i.gamesMissed, 2); // Rangers and Hibs
  assert.equal(i.daysOut, 11);
});

test('a game not yet played (after now) is not a return', () => {
  const s = storyline([claim(1, '2026-10-26T09:00:00.000Z', ['BBC Sport'])]);
  const i = settle(fromReading(reading(), 1, s, ctx)!, lineUps({ 'stephen-kingsley': ['motherwell', 'thun'] }), new Date('2026-11-04T12:00:00Z'));
  assert.equal(i.status, 'out');
  assert.equal(i.gamesMissed, 2);
});

test('settling again gives the same row, and moves the return when the line-ups change', () => {
  const s = storyline([claim(1, '2026-10-26T09:00:00.000Z', ['BBC Sport'])]);
  const first = settle(fromReading(reading(), 1, s, ctx)!, lineUps({ 'stephen-kingsley': ['motherwell', 'thun'] }), NOW);
  assert.deepEqual(settle(first, lineUps({ 'stephen-kingsley': ['motherwell', 'thun'] }), NOW), first);
  const again = settle(first, lineUps({ 'stephen-kingsley': ['motherwell'] }), NOW);
  assert.equal(again.returnedMatchId, undefined);
  assert.equal(again.status, 'out');
});

test('out is confirmed by the club or the manager, or two separate outlets; one outlet or a fan show is only reported', () => {
  const one = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['BBC Sport'])]);
  assert.equal(fromReading(reading(), 1, one, ctx)!.confirmed, false);
  assert.equal(fromReading(reading({ byClub: true }), 1, one, ctx)!.confirmed, true);
  const two = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['BBC Sport', 'Daily Record'])]);
  assert.equal(fromReading(reading(), 1, two, ctx)!.confirmed, true);
  const show = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['BBC Sport', 'hearts-standard'])]);
  assert.equal(fromReading(reading(), 1, show, ctx)!.confirmed, false);
  const club = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['official'])]);
  assert.equal(fromReading(reading(), 1, club, ctx)!.confirmed, true);
  const headline = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['BBC Sport'], { sources: [{ item: 'a', outlet: 'BBC Sport', corroboration: 0, at: '' }, { item: 'b', outlet: 'Daily Record', corroboration: 1, at: '' }] })]);
  assert.equal(fromReading(reading(), 1, headline, ctx)!.confirmed, false);
});

test('the first report is the earliest of the injury\'s own claims, and the estimate counts from its claim', () => {
  const s = storyline([claim(1, '2026-10-20T09:00:00.000Z', ['BBC Sport']), claim(2, '2026-10-27T09:00:00.000Z', ['BBC Sport'], { text: 'Kingsley out for four weeks' }), claim(3, '2026-11-01T09:00:00.000Z', ['BBC Sport'])]);
  const row = fromReading(reading({ claims: [2, 3], estimate: 'four weeks', estimateClaim: 2 }), 2, s, ctx)!;
  assert.equal(row.firstReportedAt, '2026-10-27T09:00:00.000Z');
  assert.equal(row.returnFrom, '2026-11-24T09:00:00.000Z');
  assert.equal(row.n, 2);
});

test('the reply is kept to the storyline\'s own claims and the values we know', () => {
  const s = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['BBC Sport']), claim(2, '2026-10-28T09:00:00.000Z', ['BBC Sport'])]);
  const got = parseInjuries(
    [
      { area: 'Hamstrings', type: 'muscle', side: 'left', status: 'out', byClub: 'true', estimate: 'six weeks', estimateClaim: 'c2', claims: ['c1', 'C2', 'c99'] },
      { area: 'elbow', type: 'sore', side: 'unknown', status: 'injured', claims: [] },
    ],
    s,
  );
  assert.deepEqual(got, [{ area: 'hamstring', type: 'muscle', side: 'left', status: 'out', byClub: true, estimate: 'six weeks', estimateClaim: 2, claims: [1, 2] }]);
  // A lone injury with no claims of its own gets the storyline's.
  assert.deepEqual(parseInjuries([{ area: 'unknown', status: 'doubt', claims: [] }], s), [{ type: 'unknown', status: 'doubt', byClub: false, claims: [1, 2] }]);
  assert.deepEqual(parseInjuries('nonsense', s), []);
});

test('the brief request asks for injuries only when an injury storyline is in the batch, and they come back with the brief', () => {
  const s = storyline([claim(1, '2026-10-27T09:00:00.000Z', ['BBC Sport'])]);
  const other = storyline([claim(2, '2026-10-27T09:00:00.000Z', ['BBC Sport'])], { id: 3, category: 'transfer', title: 'Kingsley contract' });
  assert.match(briefPrompt([s], new Map(), [], NOW, new Map([[17, 'Injury records so far: none.']])), /- injuries: only for a storyline marked "injury"/);
  assert.doesNotMatch(briefPrompt([other], new Map(), [], NOW, new Map()), /- injuries:/);
  const briefs = parseBriefs(
    { briefs: [{ storyline: 's17', title: 'Kingsley injury', known: 'Out.', disputed: '', latest: 'Out.', injuries: [{ area: 'knee', status: 'out', claims: ['c1'] }] }, { storyline: 's3', title: 'x', known: 'y', disputed: '', latest: '', injuries: [{ area: 'knee', status: 'out', claims: ['c2'] }] }] },
    [s, other],
  );
  assert.equal(briefs[0].injuries?.[0].area, 'knee');
  assert.equal(briefs[1].injuries, undefined);
});

test('a locked row is left alone; a new injury after a return is a row of its own', () => {
  const s = storyline([claim(1, '2026-10-26T09:00:00.000Z', ['BBC Sport']), claim(2, '2026-11-05T21:00:00.000Z', ['BBC Sport'])]);
  const ups = lineUps({ 'stephen-kingsley': ['motherwell', 'thun'] });
  const readings = [reading({ claims: [1] }), reading({ area: 'knee', type: 'ligament', claims: [2] })];
  const rows = injuryRows(s, readings, [], ups, ctx, NOW);
  assert.deepEqual(rows.map((r) => [r.n, r.area, r.status, r.dateBasis]), [[1, 'hamstring', 'back', 'match'], [2, 'knee', 'out', 'match']]);
  assert.equal(rows[1].injuredMatchId, G.thun.id);
  const locked = { ...rows[0], locked: true } as Injury;
  assert.deepEqual(injuryRows(s, readings, [locked], ups, ctx, NOW).map((r) => r.n), [2]);
  assert.deepEqual(injuryRows({ ...s, category: 'transfer' }, readings, [], ups, ctx, NOW), []);
});

test('the list gives one row per player, the counts, and "reported" for anyone not confirmed', () => {
  const s = storyline([claim(1, '2026-10-26T09:00:00.000Z', ['BBC Sport', 'Daily Record'], { text: 'Kingsley faces four to six weeks out' })]);
  const ups = lineUps({ 'stephen-kingsley': ['motherwell'], 'calvin-miller': ['rangers'] });
  const kingsley = { ...settle(fromReading(reading({ estimate: 'four to six weeks' }), 1, s, ctx)!, ups, NOW), name: 'Stephen Kingsley' };
  const miller = {
    ...settle(fromReading(reading({ area: 'knee', claims: [5] }), 1, storyline([claim(5, '2026-10-30T09:00:00.000Z', ['BBC Sport'])], { id: 37, entity: 'calvin-miller' }), ctx)!, ups, NOW),
    name: 'Calvin Miller',
  };
  const list = injuryList([kingsley, miller], NOW);
  assert.equal(list.current.length, 2);
  const text = injuryFacts(list, 'Hearts');
  assert.match(text, /Out: 2 \(1 confirmed by the club or two outlets, 1 only reported\); doubts: 0; by area: hamstring 1, knee 1/);
  assert.match(text, /Stephen Kingsley: hamstring, out \(confirmed\), injured against Motherwell on 25 October, expected back between 23 November and 7 December \("four to six weeks"\); 3 games missed so far/);
  assert.match(text, /Calvin Miller: knee, reported to be out/);
  assert.equal(missingLine(list), 'On the injury front, 2 players are out or reported to be out: Stephen Kingsley and Calvin Miller.');
  assert.equal(injuryFacts(undefined, 'Hearts'), '');
});

test('the rows go into the store, a locked one is never overwritten, and settling marks a return', async () => {
  const d1 = memoryD1();
  const store = d1store(d1);
  d1.db.exec(`INSERT INTO entities (id, type, name) VALUES ('stephen-kingsley', 'player', 'Stephen Kingsley'), ('calvin-miller', 'player', 'Calvin Miller');
    INSERT INTO storylines (id, kind, entity_id, category, title, opened_at, updated_at) VALUES (17, 'person', 'stephen-kingsley', 'injury', 'Kingsley injury', '2026-10-26', '2026-10-26'),
      (37, 'person', 'calvin-miller', 'injury', 'Miller injury', '2026-10-30', '2026-10-30');
    INSERT INTO tally_runs (match_id, date, counted_at) VALUES ('${G.motherwell.id}', '${G.motherwell.date}', ''), ('${G.rangers.id}', '${G.rangers.date}', ''), ('${G.hibs.id}', '${G.hibs.date}', '');
    INSERT INTO tally_games (match_id, entity_id, started) VALUES ('${G.motherwell.id}', 'stephen-kingsley', 1), ('${G.rangers.id}', 'calvin-miller', 1);`);
  const ups = lineUps({ 'stephen-kingsley': ['motherwell'], 'calvin-miller': ['rangers'] });
  ups.games = [G.motherwell, G.rangers, G.hibs];
  const before = new Date('2026-11-02T12:00:00Z');
  const k = settle(fromReading(reading(), 1, storyline([claim(1, '2026-10-26T09:00:00.000Z', ['BBC Sport'])]), ctx)!, ups, before);
  const m = settle(fromReading(reading({ area: 'knee', claims: [5] }), 1, storyline([claim(5, '2026-10-30T09:00:00.000Z', ['BBC Sport'])], { id: 37, entity: 'calvin-miller' }), ctx)!, ups, before);
  await store.batch(injuryWrites([k, m], before));
  d1.db.exec(`UPDATE injuries SET locked = 1, area = 'calf' WHERE storyline_id = 37`);
  // Written again (a later brief): Miller's locked row keeps the admin's area.
  await store.batch(injuryWrites([k, { ...m, area: 'knee' }], before));
  assert.equal(d1.db.prepare(`SELECT area FROM injuries WHERE storyline_id = 37`).get()?.area, 'calf');

  // Kingsley plays against Thun: the next ingest's settling marks him back.
  d1.db.exec(`INSERT INTO tally_runs (match_id, date, counted_at) VALUES ('${G.thun.id}', '${G.thun.date}', '');
    INSERT INTO tally_games (match_id, entity_id, started) VALUES ('${G.thun.id}', 'stephen-kingsley', 0);`);
  const changed = await settleInjuries(store, NOW);
  assert.deepEqual(changed.map((c) => [c.entity, c.status, c.gamesMissed]), [['stephen-kingsley', 'back', 2]]);
  const row = d1.db.prepare(`SELECT status, returned_match_id, games_missed, days_out FROM injuries WHERE storyline_id = 17`).get();
  assert.deepEqual({ ...row }, { status: 'back', returned_match_id: G.thun.id, games_missed: 2, days_out: 11 });

  const open = await loadOpenInjuries(store, NOW);
  assert.deepEqual(open.map((i) => [i.name, i.status, i.area]), [['Stephen Kingsley', 'back', 'hamstring'], ['Calvin Miller', 'out', 'calf']]);
  const list = injuryList(open, NOW);
  assert.deepEqual(list.current.map((i) => i.name), ['Calvin Miller']);
  assert.deepEqual(list.back.map((i) => i.name), ['Stephen Kingsley']);
});
