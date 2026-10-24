// The fact ledger (issue #32): results said from our side in the prompts, the code check on script lines, and the
// matches, goals and fact-check log in the store. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Bulletin, Line, Segment } from '../../shared/bulletin.ts';
import { store as endpoint } from '../../worker/src/store.ts';
import { emptyMemory, type Memory } from '../src/memory.ts';
import { buildFacts, ourResult, type Channel } from '../src/script/facts.ts';
import { buildLedger, checkBulletin, checkLine, playedMatches, repeatedViews, type Ledger } from '../src/script/ledger.ts';
import { connectStore, loadMatches, saveBuild, saveLedger } from '../src/store.ts';
import type { ClubConfig, Fixture } from '../src/types.ts';
import { memoryD1 } from './d1.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const now = new Date('2026-10-24T12:00:00Z');

// As the BBC gave them on 24 Oct.
const trabzonspor: Fixture = {
  date: '2026-10-22T16:45:00.000Z',
  home: 'Trabzonspor',
  away: 'Hearts',
  competition: 'UEFA Conference League',
  homeScore: 2,
  awayScore: 0,
  status: 'done',
  scorers: [
    { side: 'home', player: 'Mohamed Salah', minute: "32'" },
    { side: 'home', player: 'Franculino Djú', minute: "58'" },
  ],
  homeSlug: 'trabzonspor',
  link: '/sport/football/live/cmgqwny3w5z9t',
};
const celtic: Fixture = {
  date: '2026-10-18T14:00:00.000Z',
  home: 'Celtic',
  away: 'Hearts',
  competition: 'Scottish Premiership',
  homeScore: 7,
  awayScore: 1,
  status: 'done',
  scorers: [
    { side: 'home', player: 'K. Tierney', minute: "7'" },
    { side: 'home', player: 'B. Nygren', minute: "10'" },
    { side: 'home', player: 'C. Osmand', minute: "36'" },
    { side: 'home', player: 'C. Osmand', minute: "38'" },
    { side: 'away', player: 'L. Mendy', minute: "41'" },
    { side: 'home', player: 'M. Baur', minute: "45'+1" },
    { side: 'home', player: 'C. Durán', minute: "49'" },
    { side: 'home', player: 'B. Nygren', minute: "83'" },
  ],
  homeSlug: 'celtic',
  link: '/sport/football/live/cm0j0zyvvegnt',
};
const hibs: Fixture = { date: '2026-09-27T14:00:00.000Z', home: 'Hearts', away: 'Hibernian', competition: 'Scottish Premiership', homeScore: 1, awayScore: 1, status: 'done', homeSlug: 'heart-of-midlothian', scorers: [{ side: 'home', player: 'L. Shankland', minute: "20'" }, { side: 'away', player: 'M. Boyle', minute: "70'" }] };

const ledger = (live?: Fixture): Ledger => buildLedger(club, [], playedMatches(club, [trabzonspor, celtic, hibs], now), ['Lawrence Shankland', 'Harry Milne'], live);
const check = (text: string, l = ledger()) => checkLine(l, text, now);

test('a result goes into the prompt from our side, winner first', () => {
  assert.equal(
    ourResult(club, celtic),
    "Hearts LOST 7-1 away to Celtic (Scottish Premiership). Hearts scorers: L. Mendy 41'. Celtic scorers: K. Tierney 7', B. Nygren 10', C. Osmand 36', C. Osmand 38', M. Baur 45'+1, C. Durán 49', B. Nygren 83'.",
  );
  assert.equal(ourResult(club, hibs), "Hearts DREW 1-1 at home to Hibernian (Scottish Premiership). Hearts scorers: L. Shankland 20'. Hibernian scorers: M. Boyle 70'.");
  // No scorers from the feed: none listed, rather than "none".
  assert.equal(ourResult(club, { ...trabzonspor, scorers: undefined }), 'Hearts LOST 2-0 away to Trabzonspor (UEFA Conference League).');
  assert.equal(ourResult(club, { ...celtic, homeScore: 1, awayScore: 2, status: 'live', scorers: [] }, true), 'Hearts LEAD 2-1 away to Celtic (Scottish Premiership).');
});

test('the wrong winner drops the line', () => {
  for (const text of [
    'Hearts beat Celtic 7-1 at Celtic Park.',
    'A famous win over Celtic for Hearts on Sunday.',
    'Hearts drew with Celtic at the weekend.',
    'Trabzonspor were beaten by Hearts in Turkey.',
    "Hibs' defeat to Hearts in the derby.",
  ]) {
    assert.equal(check(text).drop?.kind, 'outcome', text);
  }
  assert.match(check('Hearts beat Celtic 7-1 at Celtic Park.').drop!.reason, /says Hearts won against Celtic; they lost, Celtic 7-1 Hearts/);
});

test('a wrong or flipped score is put right, in the order the line said it', () => {
  assert.equal(check('Hearts lost 2-0 to Celtic on Sunday, a heavy defeat.').text, 'Hearts lost 7-1 to Celtic on Sunday, a heavy defeat.');
  assert.equal(check('It finished Celtic 1-3 Hearts.').text, 'It finished Celtic 7-1 Hearts.');
  assert.equal(check('It finished Hearts 3-1 Celtic, a disaster.').text, 'It finished Hearts 1-7 Celtic, a disaster.');
  assert.equal(check('Hearts went down two-nil at Celtic Park against Celtic.').text, 'Hearts went down seven-one at Celtic Park against Celtic.');
  assert.equal(check('Hearts drew 2-2 with Hibs in the derby.').text, 'Hearts drew 1-1 with Hibs in the derby.');
  const r = check('Hearts lost 3-0 in the derby against Celtic. Hearts lost 2-0 against Trabzonspor.');
  assert.equal(r.text, 'Hearts lost 7-1 in the derby against Celtic. Hearts lost 2-0 against Trabzonspor.');
  assert.deepEqual(r.fixes, [{ kind: 'score', reason: 'said 3-0; it was Celtic 7-1 Hearts' }]);
});

test('a scorer who didn\'t score, or scored for the other side, drops the line', () => {
  assert.equal(check('Tierney scored for Hearts in the 7-1 defeat to Celtic.').drop?.kind, 'scorer');
  assert.equal(check('Shankland got the consolation for Hearts at Celtic.').drop?.kind, 'scorer');
  assert.match(check('Shankland scored as Hearts lost 7-1 to Celtic.').drop!.reason, /Shankland scored; he didn't in Celtic 7-1 Hearts/);
  // Right man, right side, accents or not.
  assert.equal(check("Mendy's goal was Hearts' only consolation against Celtic.").drop, undefined);
  assert.equal(check('Trabzonspor beat Hearts 2-0, Dju scoring the second, after Salah scored first.').drop, undefined);
  // He scored in the derby, and this line doesn't say which game.
  assert.equal(check('Shankland scored for Hearts against Hibs.').drop, undefined);
});

test('correct lines and lines the ledger can\'t speak for are left alone', () => {
  for (const text of [
    'Hearts were thrashed 7-1 by Celtic, with Mendy pulling one back before half-time.',
    'Trabzonspor beat Hearts 2-0 on Thursday night.',
    'Celtic 7-1 Hearts: the heaviest defeat of the season.',
    // Predictions, other seasons, other games, scores on the way, formations, injuries.
    'I think Hearts will beat Celtic 2-0 next time.',
    'Hearts beat Celtic 4-0 back in 1998.',
    'Hearts beat Celtic 2-1 in August.',
    'Celtic won 5-0 at Aberdeen in midweek.',
    'Hearts were 2-0 down at Celtic Park within ten minutes against Celtic.',
    'Hearts lined up 4-3-3 against Celtic.',
    'Hearts lost Milne to injury against Celtic, out for 3-4 weeks.',
    'Hearts drew level against Celtic through Mendy, then fell apart.',
    'Hearts won a corner against Celtic straight away.',
    'Hearts fell to fifth after the defeat to Celtic.',
    'Hearts beat Aberdeen 3-0 last month.',
  ]) {
    const r = check(text);
    assert.equal(r.drop, undefined, text);
    assert.equal(r.text, text, text);
  }
});

test('a game on now: the score so far is put right, and nothing is said to be the result', () => {
  const live: Fixture = { date: '2026-10-24T11:00:00.000Z', home: 'Hearts', away: 'Hibernian', competition: 'Scottish Premiership', homeScore: 1, awayScore: 0, status: 'live', period: "63'", scorers: [{ side: 'home', player: 'L. Shankland', minute: "12'" }], homeSlug: 'heart-of-midlothian' };
  const l = ledger(live);
  assert.equal(check('Right now it is Hearts 0-0 Hibs at Tynecastle.', l).text, 'Right now it is Hearts 1-0 Hibs at Tynecastle.');
  assert.equal(check('Hearts beat Hibs in the derby today.', l).drop, undefined);
  assert.equal(check('Milne scored for Hearts against Hibs today.', l).drop?.kind, 'scorer');
});

const line = (text: string, extra: Partial<Line> = {}): Line => ({ speaker: 'ross', text, ...extra });
const segment = (id: string, kind: Segment['kind'], lines: Line[]): Segment => ({ id, kind, title: id, strap: '', scene: 'studio', presenters: ['ross'], lines });

test('a bulletin: scores fixed in place, contradicted lines dropped, predictions and history left alone', () => {
  const bulletin = {
    segments: [
      segment('headlines', 'headlines', [line('Hearts lost 2-0 at Celtic on Sunday.'), line('Hearts beat Celtic 7-1, what a day.'), line('More to come.')]),
      segment('debate', 'debate', [line('Hearts beat Celtic 3-0, I say.', { graphic: { type: 'predictions' } as Line['graphic'] })]),
      segment('history', 'history', [line('On this day Hearts beat Celtic 4-0.')]),
      segment('match', 'match', [line('Hearts beat Celtic at Celtic Park.')]),
    ],
  } as unknown as Bulletin;
  const checks = checkBulletin(ledger(), bulletin, now);
  assert.deepEqual(
    checks.map((c) => [c.line, c.segment, c.kind, c.action]),
    [
      ['0.0', 'headlines', 'score', 'fixed'],
      ['0.1', 'headlines', 'outcome', 'dropped'],
      ['3.0', 'match', 'outcome', 'dropped'],
    ],
  );
  assert.deepEqual(bulletin.segments[0].lines.map((l) => l.text), ['Hearts lost 7-1 at Celtic on Sunday.', 'More to come.']);
  assert.equal(bulletin.segments[1].lines[0].text, 'Hearts beat Celtic 3-0, I say.');
  assert.equal(bulletin.segments[2].lines[0].text, 'On this day Hearts beat Celtic 4-0.');
  // A segment never goes empty.
  assert.equal(bulletin.segments[3].lines.length, 1);
});

test("a presenter saying again a view they've made three times over loses the line; others and new views stay", () => {
  const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
  const view = (d: number, v: string) => ({ topic: 'Data', view: v, at: `2026-10-1${d}T09:00:00.000Z` });
  const memory: Memory = {
    ...emptyMemory(),
    presenters: {
      ross: {
        predictions: [],
        opinions: [
          view(1, 'Advanced metrics and structured pressing fully compensate for missing players to guarantee an away win.'),
          view(2, 'Advanced metrics and structured pressing fully cover for missing players and guarantee an away win.'),
          view(3, 'now thinks advanced metrics and structured pressing fully compensate for missing players to guarantee an away win'),
          view(4, 'Wilson is the best signing of the window.'),
        ],
      },
    },
  };
  const f = buildFacts(club, channel, [], [], undefined, now, memory);
  const bulletin = {
    segments: [
      segment('debate', 'debate', [
        line('My record is one right from one, and advanced metrics and structured pressing fully compensate for missing players to guarantee an away win.'),
        line('Wilson is the best signing of the window, I said it and I stand by it.'),
        line('Advanced metrics fully compensate for missing players, and that guarantees an away win.', { speaker: 'fraser' }),
        line('The press will need Kingsley fit at left-back.'),
      ]),
    ],
  } as unknown as Bulletin;
  const checks = repeatedViews(f, bulletin);
  assert.deepEqual(checks.map((c) => [c.line, c.kind, c.action]), [['0.0', 'repeat', 'dropped']]);
  // Said only once, ten days ago: still his view, and he can stand by it. Fraser has never said it.
  assert.equal(bulletin.segments[0].lines.length, 3);

  // Said once, but on air half an hour ago: that's a repeat too.
  memory.presenters.ross.opinions.push({ topic: 'Wilson', view: 'Wilson is the best signing of the window.', at: '2026-10-24T11:30:00.000Z' });
  // But a leaning restated on the way to news keeps its place (Kirsty's Halkett line, 24 Oct).
  memory.presenters.kirsty = { predictions: [], opinions: [{ topic: 'Injuries', view: 'remains cautious about rushing players back into the side', at: '2026-10-24T10:00:00.000Z' }] };
  const again = {
    segments: [
      segment('debate', 'debate', [line('Wilson is the best signing of the window, I said it and I stand by it.'), line('Kingsley at left-back is a worry.')]),
      segment('story-l18', 'story', [
        line('Halkett is back in the gym.'),
        line("As we've been reporting, Halkett remains sidelined as he recovers from his Achilles injury, and we must remain cautious about rushing players back into the side during this congested fixture schedule.", { speaker: 'kirsty' }),
      ]),
    ],
  } as unknown as Bulletin;
  assert.deepEqual(repeatedViews(buildFacts(club, channel, [], [], undefined, now, memory), again).map((c) => c.line), ['0.0']);

  // A repeated sentence goes, and the news around it stays (Kirsty on Borchgrevink, 24 Oct).
  memory.presenters.kirsty.opinions.push({ topic: 'Load', view: "Borchgrevink's hamstring injury highlights the urgent need to manage squad load properly.", at: '2026-10-24T09:00:00.000Z' });
  const news = {
    segments: [
      segment('story-l15', 'story', [
        line(
          "As we know, Borchgrevink's hamstring injury forced him off before half time against Trabzonspor and leaves him out for several weeks. Borchgrevink's hamstring injury highlights the urgent need to manage squad load properly.",
          { speaker: 'kirsty' },
        ),
      ]),
    ],
  } as unknown as Bulletin;
  const [fixed] = repeatedViews(buildFacts(club, channel, [], [], undefined, now, memory), news);
  assert.equal(fixed.action, 'fixed');
  assert.equal(news.segments[0].lines[0].text, "As we know, Borchgrevink's hamstring injury forced him off before half time against Trabzonspor and leaves him out for several weeks.");
});

test('the store keeps the results and goals, BBC over TheSportsDB, and the fact-check log', async () => {
  const d1 = memoryD1();
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), { DB: d1, STORE_TOKEN: 't' })) as typeof fetch;
  const store = connectStore('t', 'https://store.test/store', fetchFn);
  const id = now.toISOString();
  await saveBuild(store, { bulletin: { id, phase: 'normal', runner: 'home' }, items: [], entities: [], tags: new Map(), remembered: { aired: [], takes: [], predictions: [] }, settled: [], renames: [] }, now);

  await saveLedger(store, playedMatches(club, [trabzonspor, celtic], now), id, [{ checker: 'ledger', kind: 'score', action: 'fixed', segment: 'headlines', was: 'Hearts lost 2-0', now: 'Hearts lost 7-1', reason: 'said 2-0' }], now);
  // Later, TheSportsDB (the BBC being down) with a different score and no scorers: the BBC's row stands.
  const later = new Date(now.getTime() + 3_600_000);
  await saveLedger(store, playedMatches(club, [{ ...celtic, home: 'Celtic', away: 'Heart of Midlothian', homeScore: 6, scorers: undefined, homeSlug: undefined, link: undefined }], later), undefined, [], later);

  const stored = await loadMatches(store, new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(stored.map((m) => [m.id, m.homeScore, m.awayScore, m.source, m.scorers?.length]), [
    ['2026-10-22|Trabzonspor|Hearts', 2, 0, 'bbc', 2],
    ['2026-10-18|Celtic|Hearts', 7, 1, 'bbc', 8],
  ]);
  assert.deepEqual(stored[1].scorers?.slice(0, 2), [
    { side: 'home', player: 'K. Tierney', minute: "7'" },
    { side: 'home', player: 'B. Nygren', minute: "10'" },
  ]);

  // A corrected BBC scorer list replaces the old one.
  const fixed = { ...trabzonspor, scorers: [trabzonspor.scorers![0], { side: 'home' as const, player: 'Edin Visca', minute: "58'" }] };
  await saveLedger(store, playedMatches(club, [fixed], later), undefined, [], later);
  assert.deepEqual((await loadMatches(store, new Date('2026-10-20T00:00:00Z')))[0].scorers?.map((g) => g.player), ['Mohamed Salah', 'Edin Visca']);

  const log = d1.db.prepare('SELECT bulletin_id, checker, kind, action, segment, was, now FROM fact_checks').all().map((r) => ({ ...r }));
  assert.deepEqual(log, [{ bulletin_id: id, checker: 'ledger', kind: 'score', action: 'fixed', segment: 'headlines', was: 'Hearts lost 2-0', now: 'Hearts lost 7-1' }]);

  // And the ledger built from the store plus a TheSportsDB feed keeps the BBC's score.
  const l = buildLedger(club, stored, playedMatches(club, [{ ...celtic, homeScore: 6, homeSlug: undefined, link: undefined }], now), []);
  assert.equal(l.matches.find((m) => m.home === 'Celtic')?.homeScore, 7);
});
