// The team news break-in (issue #19) against the recording of Trabzonspor v Hearts (22 Oct 2026): BBC had both teams
// when the recording started at 16:30, a quarter of an hour before kick-off. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type LiveMatch, liveMatch, type TeamSheet } from '../../shared/live.ts';
import { EventTracker, LINEUP_KEY } from '../src/breaking/detect.ts';
import { buildTeamNewsPackage, changes, playerName, shapeLine } from '../src/breaking/teamnews.ts';
import type { Face } from '../src/faces.ts';
import type { Channel } from '../src/script/facts.ts';
import { pageAt, type Recording } from '../src/trim-recording.ts';

const rec = JSON.parse(readFileSync(new URL('../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json', import.meta.url), 'utf8')) as Recording;
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const faces = JSON.parse(readFileSync(new URL('../../site/public/faces/faces.json', import.meta.url), 'utf8')) as Face[];
const at = (hm: string) => Date.parse(`2026-10-22T${hm}Z`);
const matchAt = (t: number): LiveMatch => liveMatch(rec.teamEvent, 'heart-of-midlothian', pageAt(rec, t));

test('live.json has both teams from the match page', () => {
  const m = matchAt(at('16:30:00'));
  const hearts = m.lineups?.away;
  assert.ok(hearts && m.lineups?.home);
  assert.equal(hearts.team, 'Hearts');
  assert.equal(hearts.formation, '4-3-3');
  assert.equal(hearts.manager, 'Wouter Vrancken');
  assert.deepEqual(hearts.rows.map((r) => r.length), [1, 4, 3, 3]);
  assert.deepEqual(hearts.rows[0][0], { urn: hearts.rows[0][0].urn, shirt: 'Reus', first: 'Beau', number: 1, position: 'Goalkeeper' });
  assert.equal(hearts.rows.flat().find((p) => p.captain)?.shirt, 'McCart');
  assert.equal(hearts.bench.length, 10);
  assert.equal(hearts.bench[0].position, undefined); // BBC's "Substitute"
});

test('the team news is ready once, before kick-off only', () => {
  let state = new EventTracker().state;
  const ready: string[] = [];
  for (let t = at('16:30:00'); t <= at('17:00:00'); t += 20_000) {
    const tracker = new EventTracker(JSON.parse(JSON.stringify(state)));
    const r = tracker.lineup(matchAt(t));
    if (r) ready.push(`${new Date(t).toISOString().slice(11, 19)} ${r.lineup.team}`);
    state = tracker.state;
  }
  assert.deepEqual(ready, ['16:30:00 Hearts']);
  // The clock first switched on after kick-off: the team news is old.
  assert.equal(new EventTracker().lineup(matchAt(at('16:50:00'))), undefined);
  assert.equal(LINEUP_KEY, 'lineup');
});

test('names: the club spelling when we have the portrait, else first name and shirt name', () => {
  const hearts = matchAt(at('16:30:00')).lineups!.away!;
  const byShirt = (s: string) => hearts.rows.flat().find((p) => p.shirt === s)!;
  assert.deepEqual(playerName(byShirt('Reus'), faces), { name: 'Beau Reus', face: 'faces/beau-reus.png' });
  assert.deepEqual(playerName(byShirt('Cláudio Braga'), faces), { name: 'Cláudio Braga', face: 'faces/claudio-braga.png' });
  assert.deepEqual(playerName(byShirt('Fagan-Walcott'), faces), { name: 'Malachi Fagan-Walcott', face: 'faces/malachi-fagan-walcott.png' });
  // faces.json has "Mccart"; BBC's first names are "Jamie Daniel".
  assert.deepEqual(playerName(byShirt('McCart'), faces), { name: 'Jamie McCart', face: 'faces/jamie-mccart.png' });
  assert.equal(playerName(byShirt('McCart')).name, 'Jamie Daniel McCart');
  assert.equal(playerName(byShirt('Reus')).name, 'Beau Reus');
  assert.equal(playerName(byShirt('Cláudio Braga')).name, 'Cláudio Braga');
});

/** Hearts' XI as if Kerjota and Spittal had started the last game instead of Mato and Wilson. */
function lastTime(sheet: TeamSheet): TeamSheet {
  const was: Record<string, string> = { Mato: 'Kerjota', Wilson: 'Spittal' };
  return { ...sheet, rows: sheet.rows.map((r) => r.map((p) => (was[p.shirt] ? { ...p, urn: `urn:${was[p.shirt]}`, shirt: was[p.shirt] } : p))) };
}

test('changes from the last game, from the team sheets alone', () => {
  const hearts = matchAt(at('16:30:00')).lineups!.away!;
  const before = lastTime(hearts);
  assert.deepEqual(changes(hearts, before).in.map((p) => p.shirt), ['Wilson', 'Mato']);
  assert.equal(
    shapeLine(hearts, { sheet: before, against: 'Motherwell' }),
    "They're expected to line up in a 4-3-3, with two changes from the side that started against Motherwell: Wilson and Mato come in for Spittal and Kerjota.",
  );
  assert.equal(shapeLine(hearts, { sheet: hearts, against: 'Motherwell' }), "They're expected to line up in a 4-3-3, and it's unchanged from the side that started against Motherwell.");
  assert.equal(shapeLine(hearts), "They're expected to line up in a 4-3-3.");
});

test('the package: the anchor hands over, then the XI one by one at the video wall, the shape, the bench and the opposition', () => {
  const m = matchAt(at('16:30:00'));
  const hearts = m.lineups!.away!;
  const pkg = buildTeamNewsPackage({
    key: LINEUP_KEY, match: m, lineup: hearts, channel, faces, previous: { sheet: lastTime(hearts), against: 'Motherwell' }, now: new Date(at('16:30:00')),
  });
  assert.equal(pkg.kind, 'lineup');
  assert.equal(pkg.flash, 'TEAM NEWS');
  const [desk, wall] = pkg.segments;
  assert.equal(desk.scene, 'desk');
  assert.equal(desk.lines[0].speaker, 'isla');
  assert.equal(desk.lines[0].text, 'The Hearts team to face Trabzonspor is in. Ross has it on the big screen.');
  assert.equal(wall.scene, 'videowall');
  assert.deepEqual(wall.presenters, ['ross']);
  const texts = wall.lines.map((l) => l.text);
  assert.equal(texts[0], "Here's the Hearts team to face Trabzonspor, and how they're expected to line up.");
  assert.equal(texts[1], 'In goal, number 1, Beau Reus.');
  assert.match(texts[2], /^At the back, number \d+, /);
  assert.ok(texts.includes('Number 5, the captain, Jamie McCart.'));
  assert.ok(texts.some((t) => /^In midfield, number \d+, /.test(t)));
  assert.ok(texts.some((t) => /^Up front, number \d+, /.test(t)));
  // One card per player, in formation order, with the changes picked out.
  const cards = wall.lines.flatMap((l) => (l.graphic?.type === 'player' ? [l.graphic] : []));
  assert.equal(cards.length, 11);
  assert.deepEqual(cards[0], { type: 'player', team: 'Hearts', name: 'Beau Reus', number: 1, position: 'Goalkeeper', face: 'faces/beau-reus.png' });
  assert.deepEqual(cards.filter((c) => c.isNew).map((c) => c.name), ['James Wilson', 'Rogers Mato']);
  assert.equal(cards.find((c) => c.captain)?.name, 'Jamie McCart');
  // Then the whole team, the bench, and a line on theirs, handing back.
  const shape = wall.lines[12];
  assert.equal(shape.graphic?.type === 'formation' && shape.graphic.changes?.join(), 'Wilson,Mato');
  // BBC's shape before kick-off is only what it expects (Mato played left back in a 4-4-2, not up front).
  assert.equal(shape.graphic?.type === 'formation' && shape.graphic.label, 'EXPECTED');
  assert.match(wall.lines[13].text, /^On the bench: Clark, Fulton, .* and JJ Williams\.$/);
  const theirs = wall.lines[14];
  assert.match(theirs.text, /^Trabzonspor are expected to go with a 4-3-3 with Onana in goal and .* up front\. Back to you in the studio\.$/);
  assert.equal(theirs.graphic?.type === 'formation' && theirs.graphic.ours, false);
  assert.equal(wall.lines.length, 15);
});
