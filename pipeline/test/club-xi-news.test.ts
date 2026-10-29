// The team news from the club's own graphic (issue #40), against the recording of Trabzonspor v Hearts (22 Oct 2026):
// the graphic's names stand in for what the vision read returns. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type LiveMatch, liveMatch, type SheetPlayer } from '../../shared/live.ts';
import { buildClubNewsPackage, correctionLine } from '../src/breaking/clubnews.ts';
import { CLUB_KEY, EventTracker, LINEUP_KEY, type ReadyClubLineup } from '../src/breaking/detect.ts';
import { type ClubPost, findTeamNews } from '../src/club-post.ts';
import { clubSheet, compareSheets, guessFormation } from '../src/club-sheet.ts';
import type { ClubXI } from '../src/club-xi.ts';
import type { Channel } from '../src/script/facts.ts';
import type { RosterPlayer } from '../src/tally.ts';
import { slug } from '../src/text.ts';
import { pageAt, type Recording } from '../src/trim-recording.ts';

const rec = JSON.parse(readFileSync(new URL('../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json', import.meta.url), 'utf8')) as Recording;
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const at = (hm: string) => Date.parse(`2026-10-22T${hm}Z`);
const matchAt = (t: number): LiveMatch => liveMatch(rec.teamEvent, 'heart-of-midlothian', pageAt(rec, t));

const m = matchAt(at('16:30:00'));
const bbc = m.lineups!.away!;
const POSITION: Record<string, string> = { Goalkeeper: 'Goalkeeper', Defender: 'Defender', Midfielder: 'Midfielder', Striker: 'Forward' };
const people = [...bbc.rows.flat(), ...bbc.bench];
const roster: RosterPlayer[] = people.map((p) => ({
  id: slug(`${p.first ?? ''} ${p.shirt}`),
  name: p.shirt.includes(' ') ? p.shirt : `${p.first} ${p.shirt}`,
  aliases: [],
  number: p.number,
  position: p.position ? POSITION[p.position] : 'Midfielder',
}));
const xiOf = (starters: SheetPlayer[], bench: SheetPlayer[]): ClubXI => ({
  starters: starters.map((p) => ({ name: p.shirt })),
  bench: bench.map((p) => ({ name: p.shirt })),
  unsure: [],
});
const same = xiOf(bbc.rows.flat(), bbc.bench);
const post = (over: Partial<ClubPost> = {}): ClubPost => ({
  id: '1',
  account: 'heartofmidlothianfc',
  caption: 'TEAM NEWS',
  timestamp: '2026-10-22T15:30:00Z',
  permalink: 'https://www.instagram.com/p/x/',
  ...over,
});
const ready = (aired: boolean): ReadyClubLineup => ({ key: CLUB_KEY, club: post(), match: m, aired, text: [] });

test("the club's post: the newest TEAM NEWS from before this kick-off, not last game's or another post", () => {
  const posts = [post({ id: 'a', caption: 'FULL TIME', timestamp: '2026-10-22T15:50:00Z' }), post({ id: 'b' }), post({ id: 'c', timestamp: '2026-10-19T13:00:00Z' })];
  assert.equal(findTeamNews(posts, m.kickOff)?.id, 'b');
  assert.equal(findTeamNews([posts[2]], m.kickOff), undefined);
  assert.equal(findTeamNews([post({ timestamp: '2026-10-22T17:00:00Z' })], m.kickOff), undefined);
});

test('names matched to the squad, laid out by position, shape guessed', () => {
  const { sheet, unmatched } = clubSheet(same, roster, 'Hearts');
  assert.deepEqual(unmatched, []);
  assert.equal(sheet.formation, '4-3-3');
  assert.deepEqual(sheet.rows.map((r) => r.length), [1, 4, 3, 3]);
  assert.equal(sheet.rows[0][0].shirt, 'Reus');
  assert.equal(sheet.rows[0][0].first, 'Beau');
  assert.equal(sheet.rows[0][0].number, 1);
  assert.equal(sheet.bench.length, 10);
  assert.deepEqual(compareSheets(sheet, bbc), { starts: [], notStarting: [] });
});

test('a name nobody in the squad answers to is shown as printed, in the position of the player before it', () => {
  const odd = { ...same, starters: same.starters.map((s, i) => (i === 5 ? { name: 'Zzyzx' } : s)) };
  const { sheet, unmatched } = clubSheet(odd, roster, 'Hearts');
  assert.deepEqual(unmatched, ['Zzyzx']);
  assert.equal(sheet.rows.flat().find((p) => p.shirt === 'Zzyzx')?.position, bbc.rows.flat()[4].position);
});

test('only a clean shape is claimed', () => {
  const row = (n: number) => Array.from({ length: n }, () => ({ urn: '', shirt: '' }));
  assert.equal(guessFormation([row(1), row(4), row(5), row(1)]), '4-5-1');
  assert.equal(guessFormation([row(1), row(2), row(5), row(3)]), undefined);
  assert.equal(guessFormation([row(1), row(10)]), undefined);
});

test('the team news from the graphic: the full break-in, with the changes counted by squad id', () => {
  const previous = { sheet: bbc, against: 'Motherwell' };
  const pkg = buildClubNewsPackage({ ready: ready(false), xi: same, roster, channel, previous, now: new Date(at('16:00:00')) })!;
  assert.equal(pkg.kind, 'lineup');
  const wall = pkg.segments[1];
  assert.equal(wall.lines.filter((l) => l.graphic?.type === 'player').length, 11);
  assert.match(wall.lines.map((l) => l.text).join(' '), /unchanged from the side that started against Motherwell/);
});

test("BBC's sheet went out first and the graphic agrees: nothing to say", () => {
  assert.equal(buildClubNewsPackage({ ready: ready(true), xi: same, roster, channel }), undefined);
});

test("BBC's sheet went out first and the graphic differs: a short correction", () => {
  const out = bbc.rows.flat()[8];
  const bench = bbc.bench[0];
  const xi = xiOf(
    bbc.rows.flat().map((p) => (p === out ? bench : p)),
    [...bbc.bench.filter((p) => p !== bench), out],
  );
  const pkg = buildClubNewsPackage({ ready: ready(true), xi, roster, channel })!;
  const lines = pkg.segments.flatMap((s) => s.lines);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, correctionLine('Hearts', clubSheet(xi, roster, 'Hearts').sheet, bbc));
  assert.match(lines[0].text, /^A correction to the Hearts team: .* starts, and .* is on the bench\.$/);
});

test('a graphic that does not read as eleven is not put on air', () => {
  assert.throws(() => buildClubNewsPackage({ ready: ready(false), xi: { ...same, starters: same.starters.slice(1) }, roster, channel }), /not 11/);
});

test('the tracker: the graphic breaks in once, ahead of BBC, whose sheet then is not news again', () => {
  const pre = (hm: string): LiveMatch => ({ ...m, lineups: hm >= '16:25' ? m.lineups : undefined });
  const t = new EventTracker();
  assert.equal(t.wantsClubPost(pre('15:00'), at('15:00:00')), false); // more than 90 minutes out
  assert.equal(t.wantsClubPost(pre('15:30'), at('15:30:00')), true);
  assert.equal(t.clubLineup(pre('15:30'), [], at('15:30:00')), undefined);
  const club = t.clubLineup(pre('15:45'), [post()], at('15:45:00'));
  assert.equal(club?.aired, false);
  assert.equal(t.wantsClubPost(pre('15:46'), at('15:46:00')), false);
  assert.equal(t.clubLineup(pre('15:46'), [post()], at('15:46:00')), undefined);
  assert.equal(t.lineup(pre('16:30')), undefined);
  assert.deepEqual(t.state.done, [CLUB_KEY, LINEUP_KEY]);
});

test("the tracker: BBC's sheet first, then the graphic, which is only a check", () => {
  const t = new EventTracker();
  assert.ok(t.lineup(m));
  const club = t.clubLineup(m, [post()], at('16:31:00'));
  assert.equal(club?.aired, true);
});

test('the tracker: no graphic after kick-off', () => {
  const live = { ...m, status: 'live' as const };
  assert.equal(new EventTracker().clubLineup(live, [post()], at('17:00:00')), undefined);
});
