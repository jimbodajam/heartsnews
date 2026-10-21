import type { Fixture, MatchData } from './types.ts';

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

/** "Mendy 41'" style labels for one side's goals, one per scorer: "Nygren 10' 83'". */
export function scorerLabels(f: Fixture, side: 'home' | 'away'): string[] {
  const byPlayer = new Map<string, string[]>();
  for (const s of (f.scorers ?? []).filter((x) => x.side === side)) {
    const name = s.player.replace(/^[A-Z]\.\s*/, '');
    byPlayer.set(name, [...(byPlayer.get(name) ?? []), s.minute]);
  }
  return [...byPlayer].map(([name, minutes]) => `${name} ${minutes.join(' ')}`);
}
