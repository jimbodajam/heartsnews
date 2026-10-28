// Our own appearances and goals count (issue #35): seeded from London Hearts, then counted from BBC's final line-ups.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbcData } from '../../shared/bbc.ts';
import { playedIn } from '../../shared/live.ts';
import { parsePlayerRecords } from '../src/collectors/londonhearts.ts';
import type { Store } from '../src/store.ts';
import { auditTally, countGame, countGames, findMilestones, findPlayer, loadPlayers, loadTotals, seedTally, type RosterPlayer } from '../src/tally.ts';
import type { ClubConfig, Fixture } from '../src/types.ts';
import { admin, rosterData, runAudit } from '../../worker/src/admin.ts';
import { milestoneLine } from '../src/script/milestones.ts';
import { memoryD1 } from './d1.ts';

const d1store = (d1: ReturnType<typeof memoryD1>): Store => ({
  batch: async (statements) => (await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...(s.params ?? []))))).map((r) => (r.results ?? []) as Record<string, unknown>[]),
});
const club = { bbc: { team: 'heart-of-midlothian' } } as ClubConfig;
const NOW = new Date('2026-10-28T12:00:00Z');

const person = (shirt: string, first: string, number: number, urn = `urn:${shirt}`) => ({ urn, name: { first, shirt }, shirtNumber: number });
const bbcPage = (starters: ReturnType<typeof person>[], bench: (ReturnType<typeof person> & { substitutedOn?: object; substitutedOff?: object })[]): BbcData => ({
  'match-lineups?x': { data: { awayTeam: { name: { shortName: 'Hearts' }, players: { starters, substitutes: bench } }, homeTeam: { name: { shortName: 'Motherwell' }, players: { starters: [], substitutes: [] } } } },
});
const eleven = (offs: string[] = []) =>
  Array.from({ length: 11 }, (_, i) => ({ ...person(`Starter${i}`, `First${i}`, i + 1), ...(offs.includes(`Starter${i}`) ? { substitutedOff: { timeMin: 70 } } : {}) }));

const fixture = (over: Partial<Fixture> = {}): Fixture => ({
  date: '2026-10-25T14:00:00.000Z', home: 'Motherwell', away: 'Hearts', competition: 'Scottish Premiership', status: 'done', homeScore: 0, awayScore: 1,
  homeSlug: 'motherwell', awaySlug: 'heart-of-midlothian', link: '/sport/football/live/x', scorers: [{ side: 'away', player: 'First3 Starter3', minute: "30'" }], ...over,
});

const roster = (...names: string[]): RosterPlayer[] => names.map((name) => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, aliases: [] }));
const squad = roster(...Array.from({ length: 11 }, (_, i) => `First${i} Starter${i}`), 'Sub Player', 'Never Played');

async function seeded() {
  const d1 = memoryD1();
  const store = d1store(d1);
  for (const p of squad) await store.batch([{ sql: `INSERT OR IGNORE INTO entities (id, type, name, aliases, active) VALUES (?, 'player', ?, '[]', 1)`, params: [p.id, p.name] }]);
  const records = [
    { id: 'h1', name: 'First3 Starter3', last: '2026-10-10', apps: 99, goals: 24 },
    { id: 'h2', name: 'Sub Player', last: '2026-10-10', apps: 10, goals: 0 },
    { id: 'h3', name: 'First0 Starter0', last: '2026-10-10', apps: 48, goals: 1 },
    { id: 'h4', name: 'Never Played', last: '2026-05-01', apps: 3, goals: 0 },
  ];
  return { d1, store, records };
}

test('London Hearts rows: id, name, last game, apps and goals', () => {
  const row = `<tr><td><a href="../newplayers/h02600.html">JJ Williams</a></td><td>4</td><td>1</td><td>1998</td><td>Clovis</td><td>United States</td><td>2026</td>
    <td><a href="../games/202609031.html">2026-09-03 Thu</a></td><td><a href="../games/202610101.html">2026-10-10 Sat</a></td><td>00y 01m 08d</td><td>6</td><td>1</td></tr>`;
  assert.deepEqual(parsePlayerRecords(`<table>${row}</table>`), [{ id: 'h02600', name: 'JJ Williams', last: '2026-10-10', apps: 6, goals: 1 }]);
});

test('played means the starters and the subs who came on, and only when the page adds up', () => {
  const on = { substitutedOn: { timeMin: 70 } };
  const ok = playedIn(bbcPage(eleven(['Starter9']), [{ ...person('Sub', 'A', 12), ...on }, person('Unused', 'B', 13)]));
  assert.deepEqual(ok.away?.players.map((p) => [p.shirt, p.started]).slice(-2), [['Starter10', true], ['Sub', false]]);
  assert.equal(ok.away?.players.length, 12);
  // Someone went off and nobody is marked as coming on: not final, record nothing.
  assert.equal(playedIn(bbcPage(eleven(['Starter9']), [person('Unused', 'B', 13)])).away, undefined);
  assert.equal(playedIn(bbcPage(eleven().slice(0, 10), [])).away, undefined);
});

test('a BBC name finds the one squad member it belongs to, by full name, surname or squad number', () => {
  const r: RosterPlayer[] = [
    { id: 'a', name: 'Cláudio Braga', aliases: [] },
    { id: 'b', name: 'Beau Reus', aliases: [] },
    { id: 'c', name: 'Alex Lowry', aliases: [], number: 8 },
    { id: 'd', name: 'Craig Lowry', aliases: [] },
  ];
  assert.equal(findPlayer(r, { shirt: 'Cláudio Braga' })?.id, 'a');
  assert.equal(findPlayer(r, { shirt: 'Reus', first: 'Beau' })?.id, 'b');
  assert.equal(findPlayer(r, { shirt: 'Reus' })?.id, 'b');
  assert.equal(findPlayer(r, { shirt: 'Lowry' }), undefined);
  assert.equal(findPlayer(r, { shirt: 'Lowry', number: 8 })?.id, 'c');
});

test('seeding takes London Hearts totals once, and says who they do not list', async () => {
  const { store, records } = await seeded();
  const first = await seedTally(store, records, await loadPlayers(store), NOW);
  assert.equal(first?.since, '2026-10-10');
  assert.equal(await seedTally(store, [], await loadPlayers(store), NOW), undefined);
  const totals = await loadTotals(store);
  assert.deepEqual(totals.filter((t) => t.apps).map((t) => [t.name, t.apps, t.goals]), [['First0 Starter0', 48, 1], ['First3 Starter3', 99, 24], ['Never Played', 3, 0], ['Sub Player', 10, 0]]);
  assert.equal(first?.unlisted.length, 9);
});

test('a finished game is counted once: starters, the sub who came on, and the scorer', async () => {
  const { store, records } = await seeded();
  await seedTally(store, records, await loadPlayers(store), NOW);
  const page = bbcPage(eleven(['Starter9']), [{ ...person('Player', 'Sub', 12), substitutedOn: { timeMin: 70 } }, person('Played', 'Never', 13)]);
  const html = `<script>window.__INITIAL_DATA__ = ${JSON.stringify(JSON.stringify({ data: page }))};</script>`;

  assert.equal((await countGames(store, club, [fixture()], new Date('2026-10-25T15:00:00Z'), async () => html)).length, 0, 'not settled yet');
  const counted = await countGames(store, club, [fixture(), fixture({ date: '2026-10-03T14:00:00.000Z' }), fixture({ date: '2026-10-26T14:00:00.000Z', competition: 'Club Friendly' })], NOW, async () => html);
  assert.deepEqual(counted.map((g) => [g.id, g.played, g.scored, g.unmatched]), [['2026-10-25|Motherwell|Hearts', 12, 1, []]]);
  assert.equal((await countGames(store, club, [fixture()], NOW, async () => html)).length, 0, 'counted once');

  const t = new Map((await loadTotals(store)).map((x) => [x.name, x]));
  assert.deepEqual([t.get('First3 Starter3')?.apps, t.get('First3 Starter3')?.goals], [100, 25]);
  assert.equal(t.get('First0 Starter0')?.apps, 49);
  assert.equal(t.get('Sub Player')?.apps, 11);
  assert.equal(t.get('Never Played')?.apps, 3);
});

test('a player or scorer the squad list cannot place is reported, not dropped quietly', () => {
  const game = countGame(
    fixture({ scorers: [{ side: 'away', player: 'Nobody Known', minute: "5'" }, { side: 'away', player: 'First3 Starter3', minute: "9'", og: true }] }),
    club,
    playedIn(bbcPage(eleven(), [])),
    squad.slice(0, 10),
  );
  assert.deepEqual(game?.counted.unmatched, ['First10 Starter10', 'Nobody Known (scorer)']);
  assert.equal(game?.counted.scored, 1, 'an own goal is nobody\'s goal');
});

test('milestones: close to one, or reached in the last game', async () => {
  const { store, records } = await seeded();
  await seedTally(store, records, await loadPlayers(store), NOW);
  const html = `<script>window.__INITIAL_DATA__ = ${JSON.stringify(JSON.stringify({ data: bbcPage(eleven(), []) }))};</script>`;
  await countGames(store, club, [fixture()], NOW, async () => html);
  const found = findMilestones(await loadTotals(store)).map((m) => [m.name, m.kind, m.mark, m.reached, m.to]);
  assert.deepEqual(found, [
    ['First3 Starter3', 'apps', 100, true, 0],
    ['First3 Starter3', 'goals', 25, true, 0],
    ['First0 Starter0', 'apps', 50, false, 1],
  ]);
});

test('the audit compares our totals with theirs up to their latest game', async () => {
  const { store, records } = await seeded();
  await seedTally(store, records, await loadPlayers(store), NOW);
  const html = `<script>window.__INITIAL_DATA__ = ${JSON.stringify(JSON.stringify({ data: bbcPage(eleven(), []) }))};</script>`;
  await countGames(store, club, [fixture()], NOW, async () => html);
  // They catch up with the game, but credit the scorer's goal to someone else.
  const theirs = records.map((r) => (r.id === 'h1' ? { ...r, last: '2026-10-25', apps: 100, goals: 24 } : r.id === 'h3' ? { ...r, last: '2026-10-25', apps: 49 } : { ...r, last: r.last === '2026-10-10' ? '2026-10-25' : r.last }));
  const a = await auditTally(store, theirs);
  assert.equal(a.counted, 1);
  assert.deepEqual(a.drift, [{ name: 'First3 Starter3', field: 'goals', ours: 25, theirs: 24 }]);
});

test('the milestone line says what the count says, reached ones first', () => {
  const m = (over: object) => ({ id: 'x', name: 'Test Player', kind: 'apps' as const, mark: 100, total: 99, reached: false, to: 1, ...over });
  assert.equal(milestoneLine([]), undefined);
  assert.equal(
    milestoneLine([m({ reached: true, to: 0, total: 100 }), m({ name: 'Other One', kind: 'goals', mark: 25, to: 2 }), m({ name: 'Third' })]),
    'By our count: Test Player has now made one hundred appearances for Hearts. Other One needs two more goals to reach twenty-five for Hearts.',
  );
  assert.equal(milestoneLine([m({})]), 'By our count: Test Player needs one more appearance to reach one hundred for Hearts.');
});

const listing = (rows: { id: string; name: string; last: string; apps: number; goals: number }[]) =>
  `<table>${[...rows, ...Array.from({ length: 100 }, (_, i) => ({ id: `h9${String(i).padStart(4, '0')}`, name: `Old Timer${i}`, last: '1990-01-01', apps: 1, goals: 0 }))]
    .map((r) => `<tr><td><a href="../newplayers/${r.id}.html">${r.name}</a></td><td>1</td><td>1</td><td>1970</td><td>X</td><td>Y</td><td>1990</td><td>a</td><td>${r.last} Sat</td><td>l</td><td>${r.apps}</td><td>${r.goals}</td></tr>`)
    .join('')}</table>`;

test('the squad list shows our counts, and the audit button compares them with London Hearts', async () => {
  const { d1, store, records } = await seeded();
  await seedTally(store, records, await loadPlayers(store), NOW);
  const html = `<script>window.__INITIAL_DATA__ = ${JSON.stringify(JSON.stringify({ data: bbcPage(eleven(), []) }))};</script>`;
  await countGames(store, club, [fixture()], NOW, async () => html);

  const roster = await rosterData(d1);
  assert.equal(roster.tallySince, '2026-10-10');
  assert.deepEqual(roster.people.find((p) => p.name === 'First3 Starter3')?.tally, { apps: 100, goals: 25 });

  // London Hearts has caught up with the game but gives the goal to nobody.
  const theirs = listing(records.map((r) => ({ ...r, last: '2026-10-25', apps: r.name === 'First3 Starter3' ? 100 : r.name === 'First0 Starter0' ? 49 : r.apps, goals: r.name === 'First3 Starter3' ? 24 : r.goals })));
  const audit = await runAudit(d1, async () => theirs);
  assert.deepEqual(audit.drift, [{ name: 'First3 Starter3', field: 'goals', ours: 25, theirs: 24 }]);

  const env = { DB: d1, ADMIN_TOKEN: 'secret' };
  const refused = await admin(new Request('https://x.test/admin/audit', { method: 'POST', headers: { authorization: 'Bearer secret', origin: 'https://evil.test' } }), env);
  assert.equal(refused.status, 403);
  const page = await admin(new Request('https://x.test/admin?roster=1', { headers: { authorization: 'Bearer secret' } }), env);
  const body = await page.text();
  assert.match(body, /Run audit/);
  assert.match(body, /100 appearances, 25 goals/);
});
