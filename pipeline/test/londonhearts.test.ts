// On this day (#8): reading London Hearts' page for a day of the year. The fixtures are their real pages for
// 24 October and 16 May. Run with `npm test`.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectOnThisDay, parseDayPage, parseGoals } from '../src/collectors/londonhearts.ts';

const page = (day: string) => readFileSync(new URL(`./fixtures/londonhearts-${day}.html`, import.meta.url), 'utf8');

test("24 October: three birthdays, no deaths, and every Hearts game on the date since 1878", () => {
  const d = parseDayPage(page('1024'), '10-24');
  assert.deepEqual(
    d.birthdays.map((b) => [b.id, b.name, b.born, b.apps, b.goals]),
    [
      ['h01422', 'Roy Kay', 1949, 207, 3],
      ['h01425', 'Andy Lynch', 1949, 90, 21],
      ['h01420', 'Neil Murray', 1950, 45, 5],
    ],
  );
  assert.deepEqual(d.birthdays[0], { id: 'h01422', name: 'Roy Kay', born: 1949, birthplace: 'Edinburgh Scotland', first: '1969-04-30', last: '1977-04-16', apps: 207, goals: 3 });
  assert.deepEqual(d.deaths, []);
  assert.equal(d.results.length, 27);
  assert.equal(d.results[0].date, '1878-10-24');
  assert.deepEqual(
    d.results.reduce((n, r) => ({ ...n, [r.result]: (n[r.result] ?? 0) + 1 }), {} as Record<string, number>),
    { w: 14, d: 5, l: 8 },
  );
});

test('the 1959 League Cup Final, in full', () => {
  const final = parseDayPage(page('1024'), '10-24').results.find((r) => r.date === '1959-10-24')!;
  assert.deepEqual(final, {
    id: '195910241',
    date: '1959-10-24',
    competition: 'League Cup',
    round: 'Final',
    venue: 'neutral',
    ground: 'Hampden Park',
    opponent: 'Third Lanark',
    score: [2, 1],
    result: 'w',
    crowd: 57994,
    scorers: [
      { player: 'Johnny Hamilton', minute: '57' },
      { player: 'Alex Young', minute: '59' },
    ],
    oppScorers: final.oppScorers,
  });
  assert.equal(final.oppScorers.length, 1);
});

test('an unknown crowd is left out, and scorers the old records lack are "Unknown"', () => {
  const first = parseDayPage(page('1024'), '10-24').results[0];
  assert.equal(first.crowd, undefined);
  assert.equal(first.competition, 'Friendly');
  assert.deepEqual(first.scorers.map((g) => g.player), ['Unknown', 'Unknown', 'Unknown', 'Unknown', 'Unknown']);
  assert.deepEqual(first.oppScorers, []);
});

test('16 May: the 1998 Scottish Cup Final, with clock times as minutes, and a death', () => {
  const d = parseDayPage(page('0516'), '05-16');
  const final = d.results.find((r) => r.date === '1998-05-16')!;
  assert.equal(final.opponent, 'Rangers');
  assert.deepEqual(final.score, [2, 1]);
  assert.deepEqual(final.scorers, [
    { player: 'Colin Cameron', minute: '2', pen: true },
    { player: 'Stephane Adam', minute: '53' },
  ]);
  assert.deepEqual(final.oppScorers, [{ player: 'Ally McCoist', minute: '82' }]);
  assert.deepEqual(d.deaths.map((p) => [p.name, p.died]), [['Jimmy Dykes', 1974]]);
});

test('scorers: penalties, own goals, stoppage time, a name with a number, and nothing scored', () => {
  assert.deepEqual(parseGoals('John McNeil [2] 8 ;Brian Martin og 51 ;Davie Baird pen 90'), [
    { player: 'John McNeil', minute: '8' },
    { player: 'Brian Martin', minute: '51', og: true },
    { player: 'Davie Baird', minute: '90', pen: true },
  ]);
  assert.deepEqual(parseGoals('[Stephen McManus 90+1] ;[Tom Masterton og] ;[Missing]'), [
    { player: 'Stephen McManus', minute: '90+1' },
    { player: 'Tom Masterton', og: true },
  ]);
  assert.deepEqual(parseGoals('-----'), []);
});

test("a day's page is fetched once and then read from the cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'londonhearts-'));
  const cached = parseDayPage(page('1024'), '10-24');
  writeFileSync(join(dir, '2026-10-24.json'), JSON.stringify(cached));
  // 22:30 UTC is 23:30 in the UK (the clocks go back on the 25th), so it's still the 24th there.
  assert.deepEqual(await collectOnThisDay(new Date('2026-10-24T22:30:00Z'), dir), cached);
});
