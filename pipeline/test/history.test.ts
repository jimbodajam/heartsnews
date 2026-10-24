// On This Day (#8): which birthdays and old games go on air, what Fraser says about them, and where the segment sits.
// From London Hearts' real pages for 24 October and 16 May. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseDayPage, type HistoryBirthday, type HistoryResult } from '../src/collectors/londonhearts.ts';
import { competitive, pickHistory, rankBirthday } from '../src/history.ts';
import { emptyMemory } from '../src/memory.ts';
import { assemble } from '../src/script/assemble.ts';
import { templateDraft } from '../src/script/draft.ts';
import { buildFacts, type Channel } from '../src/script/facts.ts';
import { historyDraft, occasion, scorersSentence } from '../src/script/history.ts';
import type { ClubConfig } from '../src/types.ts';

const json = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const club = json<ClubConfig>('../../clubs/hearts.json');
const channel = json<Channel>('../../channel.json');
const day = (mmdd: string) => parseDayPage(readFileSync(new URL(`./fixtures/londonhearts-${mmdd}.html`, import.meta.url), 'utf8'), `${mmdd.slice(0, 2)}-${mmdd.slice(2)}`);
const now = new Date('2026-10-24T12:00:00Z');

const player = (over: Partial<HistoryBirthday>): HistoryBirthday => ({
  id: 'h00001', name: 'A Player', born: 1960, birthplace: '', first: '1980-08-09', last: '1985-05-04', apps: 100, goals: 10, ...over,
});

test('24 October: the 1959 League Cup Final, then the European nights; nobody old enough to forget gets the package', () => {
  const p = pickHistory(day('1024'), club, now);
  assert.equal(p.game?.date, '1959-10-24');
  assert.deepEqual(p.also.map((r) => r.date), ['1990-10-24', '2024-10-24']);
  assert.equal(p.star, undefined);
  assert.deepEqual(p.birthdays.map((b) => b.name), ['Roy Kay', 'Andy Lynch', 'Neil Murray']);
});

test("older players count for less, but not legends, and a current player always comes first", () => {
  const seventies = rankBirthday(player({ first: '1969-04-30', last: '1977-04-16', apps: 207, goals: 3 }), now);
  const nineties = rankBirthday(player({ first: '1994-08-13', last: '1999-05-22', apps: 150, goals: 5 }), now);
  assert.ok(nineties.score > seventies.score);
  assert.ok(seventies.score < 50, 'a 1970s squad player is a mention, not a package');
  const bauld = rankBirthday(player({ born: 1927, first: '1946-08-10', last: '1962-02-24', apps: 413, goals: 278 }), now);
  assert.ok(bauld.legend && bauld.score > 900);
  const mackay = rankBirthday(player({ id: 'h01330', born: 1934, first: '1953-11-14', last: '1959-02-28', apps: 179, goals: 29 }), now, ['h01330']);
  assert.ok(mackay.legend && mackay.score >= 50, 'Dave Mackay is on the legends list');
  const youngster = rankBirthday(player({ born: 2006, first: '2025-08-02', last: '2026-10-18', apps: 3, goals: 0 }), now);
  assert.ok(youngster.current && youngster.score > bauld.score);
  assert.equal(youngster.age, 20);
});

test('only league, cup and European games count', () => {
  const game = (competition: string) => ({ competition }) as HistoryResult;
  for (const c of ['Division A', 'Premier', 'Scottish Premier League', 'Championship', 'Scottish Cup', 'League Cup', 'UEFA Cup', 'Europa Conference League']) {
    assert.ok(competitive(game(c)), c);
  }
  for (const c of ['Friendly', 'Wilson Cup', 'Rosebery Charity Cup', 'War League Eastern Division', 'Southern League Cup', 'Overseas Tour1970-71', 'EoSS']) {
    assert.ok(!competitive(game(c)), c);
  }
});

test("Fraser's lines: the day, the birthdays, and the final with its crowd and scorers", () => {
  const f = buildFacts(club, channel, [], [], undefined, now, emptyMemory(), day('1024'));
  const d = historyDraft(f)!;
  assert.equal(d.intro, "Time for On This Day, our look back through the Hearts history books, and it's the 24th of October.");
  assert.equal(d.star, undefined);
  assert.equal(d.birthdays, 'Former Hearts players born on this day include Roy Kay, Andy Lynch and Neil Murray.');
  assert.equal(
    d.game,
    'And on this day in 1959, Hearts beat Third Lanark two-one in the League Cup final, at Hampden in front of 57,994. The goals came from Johnny Hamilton and Alex Young.',
  );
  assert.deepEqual(d.also, ['On this date in 1990, Hearts beat Bologna three-one in the second round of the UEFA Cup.', 'And in 2024, Hearts beat Omonoia two-nil in the Conference League.']);
});

test('16 May: the 1998 Scottish Cup Final, a penalty and all', () => {
  const p = pickHistory(day('0516'), club, now);
  assert.equal(p.game?.opponent, 'Rangers');
  assert.equal(occasion(p.game!), 'the Scottish Cup final');
  assert.equal(scorersSentence(p.game!.scorers), 'The goals came from Colin Cameron and Stephane Adam.');
});

test('scorers: braces, hat-tricks, own goals, and nothing when the records are missing', () => {
  const g = (player: string, og = false) => ({ player, ...(og && { og }) });
  assert.equal(scorersSentence([g('Kenny Black'), g('Gary Mackay'), g('Kenny Black')]), 'Two from Kenny Black and one from Gary Mackay.');
  assert.equal(scorersSentence([g('Andy Black'), g('Andy Black'), g('Andy Black')]), 'A hat-trick from Andy Black.');
  assert.equal(scorersSentence([g('John Robertson'), g('Brian Martin', true), g('Ian Ferguson')]), 'The goals came from John Robertson, an own goal and Ian Ferguson.');
  assert.equal(scorersSentence([g('Brian Martin', true)]), 'It came from an own goal.');
  assert.equal(scorersSentence([g('Unknown'), g('Unknown')]), undefined);
});

test('the segment goes after the Transfer Centre, at the museum, with the cards; and not while a game is on', () => {
  const f = buildFacts(club, channel, [], [], undefined, now, emptyMemory(), day('1024'));
  const b = assemble(f, templateDraft(f), 'templates');
  const ids = b.segments.map((s) => s.id);
  const at = ids.indexOf('history');
  assert.ok(at > ids.indexOf('transfers'));
  const seg = b.segments[at];
  assert.equal(seg.scene, 'museum');
  assert.deepEqual(seg.presenters, ['fraser']);
  assert.equal(seg.lines[0].graphic, undefined, 'the opening line is the shot outside');
  assert.equal(seg.lines[1].graphic?.type, 'birthdays');
  const final = seg.lines[2].graphic;
  assert.ok(final?.type === 'result' && final.status === '24 OCT 1959' && final.competition === 'League Cup Final');
  assert.deepEqual(final.type === 'result' && [final.home, final.away, final.homeScorers], ['Hearts', 'Third Lanark', ["Hamilton 57'", "Young 59'"]]);
  // The hand-over into it, by Ross from the Transfer Centre.
  assert.match(b.segments[at - 1].lines.at(-1)!.text, /museum/);

  const live = { date: '2026-10-24T11:00:00Z', home: 'Hearts', away: 'Motherwell', competition: 'Scottish Premiership', status: 'live' as const, homeScore: 1, awayScore: 0 };
  const matchday = buildFacts(club, channel, [], [], { next: [live], last: [], table: [] }, now, emptyMemory(), day('1024'));
  assert.equal(matchday.history, undefined);
});
