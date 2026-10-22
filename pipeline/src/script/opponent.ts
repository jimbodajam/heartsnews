import { spokenList } from '../time.ts';
import type { Fixture, Lineup, OpponentFocus } from '../types.ts';

// Helpers for the opposition focus: results from one team's point of view, and line-ups in words.

export interface TeamResult {
  against: string;
  score: string; // from the team's point of view, e.g. "2-0"
  outcome: 'W' | 'D' | 'L';
  venue: 'H' | 'A';
  competition: string;
}

export function resultFor(team: string, f: Fixture): TeamResult {
  const home = f.home === team;
  const us = (home ? f.homeScore : f.awayScore) ?? 0;
  const them = (home ? f.awayScore : f.homeScore) ?? 0;
  return {
    against: home ? f.away : f.home,
    score: `${us}-${them}`,
    outcome: us > them ? 'W' : us < them ? 'L' : 'D',
    venue: home ? 'H' : 'A',
    competition: f.competition,
  };
}

export function formOf(o: OpponentFocus): TeamResult[] {
  return o.results.map((f) => resultFor(o.opponent, f));
}

/** "Onana in goal, Franculino Djú leading the line" style summary of an XI. */
export function describeXI(xi: Lineup): string {
  const keeper = xi.rows[0]?.[0];
  const front = xi.rows[xi.rows.length - 1] ?? [];
  return `a ${xi.formation} with ${keeper} in goal and ${spokenList(front)} up front`;
}

/** The XI as plain text for the AI prompt: "4-2-3-1: Onana | Wagner Pina, Nwaiwu, … | …". */
export function xiText(xi: Lineup): string {
  return `${xi.formation}: ${xi.rows.map((r) => r.join(', ')).join(' | ')}`;
}
