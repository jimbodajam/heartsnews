// Head to head with the next opponent (issue #34): Hearts' record against them from London Hearts' page for the team.
// Competitive games only (league, Scottish Cup, League Cup, Europe), the same rule as On This Day, so a friendly or a
// wartime league doesn't count towards "the record".

import type { Meeting } from './collectors/headtohead.ts';
import { competitive } from './history.ts';

/** Meetings in the form strip on screen. */
export const RECENT = 5;
/** Fewer competitive meetings than this and there's no record worth reading out. */
export const MIN_PLAYED = 3;

export interface Record {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  for: number;
  against: number;
}

export interface HeadToHead {
  opponent: string;
  /** Where the coming game is, so the record there can be given. */
  venue: 'home' | 'away';
  all: Record;
  /** The record in the coming game's venue (Tynecastle for a home game, their ground for an away one). */
  atVenue: Record;
  /** Newest first. */
  recent: Meeting[];
  last?: Meeting;
  lastWin?: Meeting;
  /** The last win at the coming game's venue. */
  lastWinAtVenue?: Meeting;
  /** Biggest margin, then most goals, then the most recent. */
  biggestWin?: Meeting;
}

const tally = (games: Meeting[]): Record =>
  games.reduce<Record>(
    (t, g) => ({
      played: t.played + 1,
      won: t.won + (g.result === 'w' ? 1 : 0),
      drawn: t.drawn + (g.result === 'd' ? 1 : 0),
      lost: t.lost + (g.result === 'l' ? 1 : 0),
      for: t.for + g.score[0],
      against: t.against + g.score[1],
    }),
    { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0 },
  );

/** `games` in any order; `venue` is where Hearts play the coming game. Undefined when there's too little to say. */
export function headToHead(opponent: string, games: Meeting[], venue: 'home' | 'away'): HeadToHead | undefined {
  const played = games.filter(competitive).sort((a, b) => b.date.localeCompare(a.date));
  if (played.length < MIN_PLAYED) return undefined;
  const wins = played.filter((g) => g.result === 'w');
  const margin = (g: Meeting) => g.score[0] - g.score[1];
  return {
    opponent,
    venue,
    all: tally(played),
    atVenue: tally(played.filter((g) => g.venue === venue)),
    recent: played.slice(0, RECENT),
    last: played[0],
    lastWin: wins[0],
    lastWinAtVenue: wins.find((g) => g.venue === venue),
    // `played` is newest first and the sort is stable, so ties go to the most recent.
    biggestWin: [...wins].sort((a, b) => margin(b) - margin(a) || b.score[0] - a.score[0])[0],
  };
}
