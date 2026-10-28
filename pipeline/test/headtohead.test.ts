// Head to head (#34): reading London Hearts' page for Rangers (the real one, as of the 2026-05-04 game) and working
// out the record. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pageSlug, parseTeamPage } from '../src/collectors/headtohead.ts';
import { headToHead } from '../src/headtohead.ts';
import { headToHeadGraphic, headToHeadLine } from '../src/script/opponent.ts';

const games = parseTeamPage(readFileSync(new URL('./fixtures/londonhearts-teamcut-rangers.html', import.meta.url), 'utf8'));

test('every Rangers game on the page, oldest first, the abandoned one left out', () => {
  assert.equal(games.length, 428);
  assert.deepEqual(games[0], { date: '1880-04-24', competition: 'Friendly', round: '', venue: 'home', score: [0, 0], result: 'd', crowd: 3000 });
  assert.deepEqual(games.at(-1), { date: '2026-05-04', competition: 'Premiership', round: '35 of 38', venue: 'home', score: [2, 1], result: 'w', crowd: 18831 });
});

test('the record counts competitive games only', () => {
  const h = headToHead('Rangers', games, 'home')!;
  assert.equal(h.all.played, h.all.won + h.all.drawn + h.all.lost);
  assert.ok(h.all.played < games.length && h.all.played > 350);
  assert.equal(h.last?.date, '2026-05-04');
  assert.equal(h.lastWin?.date, '2026-05-04');
  assert.equal(h.recent.length, 5);
  assert.deepEqual(h.recent.map((g) => g.date), [...h.recent.map((g) => g.date)].sort().reverse());
  assert.ok(h.atVenue.played < h.all.played);
});

test('the biggest win is by margin, then goals, then the most recent', () => {
  const g = (date: string, a: number, b: number) => ({ date, competition: 'Premiership', round: '', venue: 'home' as const, score: [a, b] as [number, number], result: (a > b ? 'w' : a < b ? 'l' : 'd') as 'w' | 'd' | 'l' });
  const h = headToHead('X', [g('2001-01-01', 2, 0), g('2010-01-01', 3, 1), g('2015-01-01', 3, 0), g('2020-01-01', 3, 0), g('2021-01-01', 0, 1)], 'away')!;
  assert.equal(h.biggestWin?.date, '2020-01-01');
  assert.equal(h.lastWin?.date, '2020-01-01');
  assert.equal(h.lastWinAtVenue, undefined);
  assert.deepEqual(h.atVenue, { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0 });
});

test('too few competitive meetings and there is no record to read out', () => {
  assert.equal(headToHead('X', games.filter((x) => x.competition === 'Friendly'), 'home'), undefined);
});

test("their page names: the feeds' spellings map to London Hearts'", () => {
  assert.equal(pageSlug('St Mirren'), 'stmirren');
  assert.equal(pageSlug('Dundee Utd'), 'dundeeunited');
  assert.equal(pageSlug('Hibs'), 'hibernian');
  assert.equal(pageSlug('Rangers'), 'rangers');
  assert.equal(pageSlug('Kilmarnock FC'), 'kilmarnock');
  assert.equal(pageSlug('St. Johnstone'), 'stjohnstone');
  assert.equal(pageSlug('Livingston'), 'livingston(meadowbankthistle)');
});

test('the line on air is built from the record, and the card matches it', () => {
  const h = headToHead('Rangers', games, 'home')!;
  const line = headToHeadLine(h, 'Hearts');
  assert.match(line, new RegExp(`in ${h.all.played} league and cup meetings Hearts have won ${h.all.won}, drawn ${h.all.drawn} and lost ${h.all.lost}`));
  assert.match(line, /The last time Hearts beat Rangers was in May 2026, 2-1 at home\./);
  assert.match(line, /The biggest win was 5-0, in (August 1952|September 1905)\./);
  const card = headToHeadGraphic(h);
  assert.deepEqual(card.lastWin, { date: 'MAY 2026', score: '2-1', venue: 'H' });
  assert.equal(card.recent.length, 5);
  assert.deepEqual(card.recent.map((r) => r.outcome), ['W', 'L', 'W', 'W', 'L']);
  console.log(line);
});
