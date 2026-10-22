// The Match Centre's stats line and card, the evening after the recorded Trabzonspor v Hearts (22 Oct 2026) and
// during it. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { BbcData, BbcEvent } from '../../shared/bbc.ts';
import { matchStats } from '../../shared/live.ts';
import { assemble } from '../src/script/assemble.ts';
import { templateDraft } from '../src/script/draft.ts';
import { buildFacts, type Channel } from '../src/script/facts.ts';
import type { ClubConfig, Fixture } from '../src/types.ts';

const rec = JSON.parse(readFileSync(new URL('../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json', import.meta.url), 'utf8')) as {
  teamEvent: BbcEvent;
  snapshots: { at: string; page: BbcData }[];
};
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const statsAt = (time: string) => matchStats(rec.snapshots.filter((s) => s.at <= `2026-10-22T${time}Z`).pop()!.page);

const game: Fixture = { date: '2026-10-22T16:45:00.000Z', home: 'Trabzonspor', away: 'Hearts', competition: 'UEFA Conference League' };

test('full-time reaction: the stats line follows the result, with the card', () => {
  const result: Fixture = { ...game, status: 'done', homeScore: 2, awayScore: 0, stats: statsAt('23:59:59') };
  const f = buildFacts(club, channel, [], [], { next: [], last: [result], table: [] }, new Date('2026-10-22T21:00:00Z'));
  const draft = templateDraft(f);
  assert.equal(
    draft.stats,
    "A look at the numbers. On shots it's Trabzonspor eleven, Hearts ten, and five to one on target. Trabzonspor have been on top, with 61 per cent of the ball and five shots on target to one.",
  );
  const mc = assemble(f, draft, 'templates').segments.find((s) => s.id === 'match')!;
  // Then the hand-over to the next segment.
  assert.deepEqual(mc.lines.slice(0, 2).map((l) => l.graphic?.type), ['result', 'stats']);
  const card = mc.lines[1].graphic;
  assert.ok(card?.type === 'stats');
  assert.equal(card.status, 'FULL TIME');
  assert.deepEqual(card.rows[0], { label: 'POSSESSION', home: 61, away: 39, percent: true });
});

test('live: from a quarter of an hour in, not before', () => {
  const at = (period: string, time: string, now: string) => {
    const live: Fixture = { ...game, status: 'live', period, homeScore: 0, awayScore: 0, stats: statsAt(time) };
    return buildFacts(club, channel, [], [], { next: [live], last: [], table: [] }, new Date(`2026-10-22T${now}Z`));
  };
  assert.equal(at("9'", '16:55:05', '16:55:30').matchStats, undefined);
  const f = at("21'", '17:07:38', '17:08:00');
  assert.equal(f.matchStats?.minute, 21);
  assert.match(templateDraft(f).stats!, /^A look at the numbers so far\. Trabzonspor have had 63 per cent of the ball\. On shots it's Trabzonspor none, Hearts six/);
  const card = assemble(f, templateDraft(f), 'templates').segments.find((s) => s.id === 'match')!.lines[1].graphic;
  assert.ok(card?.type === 'stats' && card.status === "LIVE 21'");
});
