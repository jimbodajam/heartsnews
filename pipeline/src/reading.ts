// Our own read on a game from BBC's live team stats and the score: against the run of play, one side on top, an even
// or cagey game, a keeper kept busy, a side without a shot on target. Each is only claimed when the numbers clearly
// back it (see READ), so a 52/48 game is never talked up, and nothing before READ.fromMinute: early stats are noisy.
// Every sentence is neutral, whichever side is ours, and carries the numbers it uses so a line check can allow them.

import { type MatchStats, possession, type TeamStats } from '../../shared/live.ts';

type Side = 'home' | 'away';
type Names = { home: string; away: string };
type Score = { home: number; away: number };

/** The thresholds. */
export const READ = {
  /** No reading before this minute. */
  fromMinute: 15,
  /** Against the run of play: the side ahead has at most this much of the ball… */
  runOfPlayPossession: 42,
  /** …and at least this many fewer shots on target. */
  runOfPlayOnTarget: 2,
  /** On top: at least this much of the ball, this many more shots on target, and no fewer shots. */
  onTopPossession: 60,
  onTopOnTarget: 3,
  /** Even: possession within this of 50 either way, shots and shots on target within these of each other. */
  evenPossession: 5,
  evenShots: 2,
  evenOnTarget: 1,
  /** Cagey: at most this many shots on target between them. Even, cagey and no-shots need this long to mean much. */
  cageyOnTarget: 2,
  settledMinute: 30,
  /** A keeper kept busy: at least this many saves. */
  busySaves: 4,
};

export type ReadingKind = 'run-of-play' | 'on-top' | 'even' | 'cagey' | 'keeper-busy' | 'no-shot-on-target';

export interface Reading {
  kind: ReadingKind;
  /** Who it's about: the side ahead (run of play), on top, whose keeper, or without a shot on target. */
  side?: Side;
  /** One spoken sentence. */
  text: string;
  /** The same, said when this side has just scored ("knocking on the door"), if it reads differently. */
  scoredText?: string;
  /** The numbers in it, as digits or words, for the line checks. */
  numbers: number[];
}

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** Small counts in words ("five shots"), bigger ones as digits. */
export const count = (n: number) => WORDS[n] ?? String(n);
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

/** "32'" → 32, "90'+5" → 90, "HT" → NaN. */
export const minuteOf = (clock: string) => parseInt(clock, 10);

/** What the stats say about the game so far, most telling first. Empty before READ.fromMinute or if nothing clears its bar. */
export function readGame(names: Names, stats: MatchStats, score: Score, minute: number): Reading[] {
  if (!(minute >= READ.fromMinute)) return [];
  const pos = possession(stats);
  const s = (side: Side): TeamStats => stats[side];
  const out: Reading[] = [];

  const leader: Side | undefined = score.home > score.away ? 'home' : score.away > score.home ? 'away' : undefined;
  if (leader) {
    const t = other(leader);
    if (pos[leader] <= READ.runOfPlayPossession && s(t).onTarget - s(leader).onTarget >= READ.runOfPlayOnTarget) {
      out.push({
        kind: 'run-of-play',
        side: leader,
        text: `It's been against the run of play: ${names[t]} have had ${pos[t]} per cent of the ball, and ${count(s(t).onTarget)} shots on target to ${count(s(leader).onTarget)}.`,
        numbers: [pos[t], s(t).onTarget, s(leader).onTarget],
      });
    }
  }

  for (const side of ['home', 'away'] as const) {
    const o = other(side);
    if (pos[side] >= READ.onTopPossession && s(side).onTarget - s(o).onTarget >= READ.onTopOnTarget && s(side).shots >= s(o).shots) {
      // The side ahead against the run of play has already said it.
      if (out.some((r) => r.kind === 'run-of-play')) continue;
      const how = `with ${pos[side]} per cent of the ball and ${count(s(side).onTarget)} shots on target to ${count(s(o).onTarget)}.`;
      out.push({
        kind: 'on-top',
        side,
        text: `${names[side]} have been on top, ${how}`,
        scoredText: `${names[side]} have been knocking on the door, ${how}`,
        numbers: [pos[side], s(side).onTarget, s(o).onTarget],
      });
    }
  }

  const settled = minute >= READ.settledMinute;
  if (
    settled &&
    Math.abs(pos.home - 50) <= READ.evenPossession &&
    Math.abs(s('home').shots - s('away').shots) <= READ.evenShots &&
    Math.abs(s('home').onTarget - s('away').onTarget) <= READ.evenOnTarget
  ) {
    out.push({ kind: 'even', text: "It's been an even game, with little to choose between the sides.", numbers: [] });
  }
  const onTarget = s('home').onTarget + s('away').onTarget;
  if (settled && onTarget <= READ.cageyOnTarget) {
    const between = onTarget === 0 ? 'not a single shot on target' : onTarget === 1 ? 'just one shot on target' : `just ${count(onTarget)} shots on target`;
    out.push({ kind: 'cagey', text: `It's been a cagey one, with ${between} between them.`, numbers: [onTarget] });
  }

  for (const side of ['home', 'away'] as const) {
    if (s(side).saves >= READ.busySaves) {
      out.push({ kind: 'keeper-busy', side, text: `The ${names[side]} goalkeeper has been kept busy, with ${count(s(side).saves)} saves.`, numbers: [s(side).saves] });
    }
  }
  for (const side of ['home', 'away'] as const) {
    // Not worth saying on top of "not a single shot on target between them".
    if (settled && s(side).onTarget === 0 && onTarget > 0) {
      out.push({ kind: 'no-shot-on-target', side, text: `${names[side]} have yet to have a shot on target.`, numbers: [0] });
    }
  }
  return out;
}

/**
 * How the game has gone, for half-time, full time or the Match Centre: possession and shots (always true, whatever
 * the game's been like), then the reading that matters most, if one clears its bar. Possession isn't said twice.
 * "Trabzonspor have had 57 per cent of the ball. On shots it's Trabzonspor six, Hearts eight, and three to one on target."
 */
export function howItsGone(names: Names, stats: MatchStats, score: Score, minute: number): { text: string; numbers: number[] } {
  const pos = possession(stats);
  const { home: h, away: a } = stats;
  const reading = pickReading(readGame(names, stats, score, minute));
  const more: Side = pos.home >= pos.away ? 'home' : 'away';
  const ball =
    reading?.kind === 'on-top' || reading?.kind === 'run-of-play'
      ? undefined
      : Math.abs(pos.home - pos.away) <= 4
        ? 'Possession has been all but even.'
        : `${names[more]} have had ${pos[more]} per cent of the ball.`;
  const shots = `On shots it's ${names.home} ${count(h.shots)}, ${names.away} ${count(a.shots)}, and ${count(h.onTarget)} to ${count(a.onTarget)} on target.`;
  return {
    text: [ball, shots, reading?.text].filter(Boolean).join(' '),
    numbers: [pos.home, pos.away, h.shots, a.shots, h.onTarget, a.onTarget, ...(reading?.numbers ?? [])],
  };
}

/** The stats and our reading of them, for a script writer's DATA. `when` is "full time" or "as of 63'". */
export function statsBrief(names: Names, stats: MatchStats, score: Score, minute: number, when: string): string {
  const pos = possession(stats);
  const { home: h, away: a } = stats;
  const readings = readGame(names, stats, score, minute);
  return `Match stats from BBC, ${when}, ${names.home} first: possession ${pos.home}-${pos.away} per cent, shots ${h.shots}-${a.shots}, on target ${h.onTarget}-${a.onTarget}, corners ${h.corners}-${a.corners}, goalkeeper saves ${h.saves}-${a.saves}, fouls ${h.fouls}-${a.fouls}.
Our reading of the stats (the only claims to make about how the game has gone): ${
    readings.map((r) => r.text).join(' ') || "nothing clear-cut: the numbers are close or mixed, so don't say either side has been on top."
  }`;
}

/**
 * The one reading worth adding to a goal or red card, if any: against the run of play first, then a side on top
 * (knocking on the door, if they've just scored), a busy keeper, a side without a shot on target, an even or cagey game.
 */
export function pickReading(readings: Reading[], scorer?: Side): Reading | undefined {
  const order: ReadingKind[] = ['run-of-play', 'on-top', 'keeper-busy', 'no-shot-on-target', 'even', 'cagey'];
  // A side that's just scored has had a shot on target.
  const r = order.flatMap((k) => readings.filter((x) => x.kind === k && !(k === 'no-shot-on-target' && x.side === scorer)))[0];
  if (!r) return undefined;
  return { ...r, text: (r.side === scorer && r.scoredText) || r.text };
}
