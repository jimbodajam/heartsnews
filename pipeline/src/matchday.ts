import type { ClubConfig, Fixture, MatchData } from './types.ts';

// What the channel should be doing right now, given the fixture list: a normal day, the build-up to a game,
// a game in progress, or the reaction afterwards. The script writer leans the whole bulletin towards it.

export type Phase =
  | { kind: 'normal' }
  | { kind: 'preview'; fixture: Fixture }
  | { kind: 'live'; fixture: Fixture }
  | { kind: 'reaction'; result: Fixture };

const HOUR = 3_600_000;
const MATCH_LENGTH = 2.25 * HOUR; // kick-off to full time, with stoppages and half-time

export function detectPhase(match: MatchData | undefined, now: Date): Phase {
  if (!match) return { kind: 'normal' };
  const t = now.getTime();

  const live = match.next.find((f) => f.status === 'live');
  if (live) return { kind: 'live', fixture: live };

  const next = match.next.find((f) => f.status !== 'postponed');
  const untilKickOff = next ? Date.parse(next.date) - t : Infinity;
  // Kicked off but the feed hasn't said so yet (or never does, like TheSportsDB): assume it's on.
  if (next && untilKickOff <= 0 && -untilKickOff < MATCH_LENGTH) return { kind: 'live', fixture: next };

  const last = match.last[0];
  const sinceKickOff = last ? t - Date.parse(last.date) : Infinity;
  // A fresh result wins over the next preview until the following morning; after that the build-up takes over.
  if (sinceKickOff < 14 * HOUR) return { kind: 'reaction', result: last };
  if (next && untilKickOff > 0 && untilKickOff < 30 * HOUR) return { kind: 'preview', fixture: next };
  if (sinceKickOff < 30 * HOUR) return { kind: 'reaction', result: last };
  return { kind: 'normal' };
}

/** A game coming up this soon gets the big-game build-up, even before the bulletin's own preview starts. */
export const BIG_LEAD_H = 72;

const SEMI = /\bsemi[- ]?finals?\b/i;
// "The final", not the final whistle, third or day.
const FINAL = /\b(?:cup|the) final\b(?!\s+(?:whistle|third|day|minutes?|score|ball|stages?|result|word|say|push|round|fixture|game of))/i;

/**
 * How a game is billed when it's a big one ("the Edinburgh derby", "a European night", "the Scottish Cup final"), or
 * undefined. Opponents and European competitions come from the fixture; for a cup, the round comes from `text`, the
 * news about the game, since the feeds don't give it. `competition` may be unknown (a storyline's fixture).
 */
export function bigGame(club: ClubConfig, f: { home: string; away: string; competition?: string }, text = ''): string | undefined {
  const big = club.bigGames;
  if (!big) return undefined;
  const us = new Set([club.name, club.shortName].map((n) => n.toLowerCase()));
  const opponent = [f.home, f.away].find((n) => !us.has(n.toLowerCase()))?.toLowerCase();
  const rival = big.opponents.find((o) => o.names.some((n) => n.toLowerCase() === opponent));
  if (rival) return rival.billing;
  const comp = (f.competition ?? '').toLowerCase();
  const europe = big.competitions.find((c) => comp.includes(c.name.toLowerCase()));
  if (europe) return europe.billing;
  const cup = big.cups.find((c) => comp.includes(c.toLowerCase()) || (!comp && new RegExp(`\\b${c}\\b`, 'i').test(text)));
  if (cup && SEMI.test(text)) return `the ${cup} semi-final`;
  if (cup && FINAL.test(text)) return `the ${cup} final`;
  return undefined;
}

/**
 * The big game this bulletin is about, with its billing: the one coming up, on now or just played if it's big;
 * otherwise a big one kicking off within BIG_LEAD_H, which gets its build-up early. `text` is the news (for a cup's
 * round).
 */
export function bigGameFor(club: ClubConfig, phase: Phase, next: Fixture[], now: Date, text = ''): { fixture: Fixture; billing: string } | undefined {
  const focus = phase.kind === 'preview' || phase.kind === 'live' ? phase.fixture : phase.kind === 'reaction' ? phase.result : undefined;
  const t = now.getTime();
  const soon = next.filter((f) => f.status !== 'postponed' && Date.parse(f.date) > t && Date.parse(f.date) - t < BIG_LEAD_H * HOUR);
  for (const fixture of [focus, ...soon]) {
    const billing = fixture && bigGame(club, fixture, text);
    if (billing) return { fixture: fixture!, billing };
  }
  return undefined;
}

/** "Mendy 41'" style labels for one side's goals, one per scorer: "Nygren 10' 83'". */
export function scorerLabels(f: Fixture, side: 'home' | 'away'): string[] {
  const byPlayer = new Map<string, string[]>();
  for (const s of (f.scorers ?? []).filter((x) => x.side === side)) {
    const name = s.player.replace(/^[A-Z]\.\s*/, '');
    byPlayer.set(name, [...(byPlayer.get(name) ?? []), s.minute]);
  }
  return [...byPlayer].map(([name, minutes]) => `${name} ${minutes.join(' ')}`);
}
