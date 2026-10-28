// The team we've announced for the next game (issue #36): once BBC has it, about an hour before kick-off, every
// programme until kick-off shows it in the Match Centre. Read from the Worker's live.json (the same sheets the team news
// break-in used), else from the BBC match page.

import type { LiveMatch, TeamSheet } from '../../shared/live.ts';
import { matchSheets, previousSheet } from './collectors/bbc.ts';
import type { Phase } from './matchday.ts';
import type { ClubConfig } from './types.ts';

export interface Announced {
  /** Our confirmed team. */
  ours: TeamSheet;
  theirs?: TeamSheet;
  opponent: string;
  /** Our last starting XI and who it was against, for the changes. */
  previous?: { sheet: TeamSheet; against: string };
}

const SAME_GAME_MS = 6 * 3_600_000;

/** Our team for the game being built up to, if BBC has it and the game hasn't kicked off. Never throws. */
export async function loadAnnounced(
  club: ClubConfig,
  phase: Phase,
  now: Date,
  live: () => Promise<{ match: LiveMatch | null }>,
): Promise<Announced | undefined> {
  if (phase.kind !== 'preview' || !club.bbc) return undefined;
  const fixture = phase.fixture;
  if (Date.parse(fixture.date) <= now.getTime()) return undefined;
  try {
    let ours: TeamSheet | undefined;
    let theirs: TeamSheet | undefined;
    const m = await live().then((f) => f.match, () => null);
    if (m?.lineups && Math.abs(Date.parse(m.kickOff) - Date.parse(fixture.date)) < SAME_GAME_MS) {
      const them = m.us === 'home' ? 'away' : 'home';
      ours = m.lineups[m.us];
      theirs = m.lineups[them];
    } else if (fixture.link) {
      const sheets = await matchSheets(fixture.link);
      const weAreHome = fixture.homeSlug === club.bbc.team;
      ours = weAreHome ? sheets.home : sheets.away;
      theirs = weAreHome ? sheets.away : sheets.home;
    }
    if (!ours) return undefined;
    const previous = await previousSheet(club.bbc.team, fixture.date).catch(() => undefined);
    const opponent = fixture.homeSlug === club.bbc.team ? fixture.away : fixture.home;
    return { ours, theirs, opponent, previous };
  } catch (err) {
    console.warn(`Couldn't read the announced team: ${(err as Error).message}`);
    return undefined;
  }
}
