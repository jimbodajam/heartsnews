import { fetchJson } from '../http.ts';
import type { ClubConfig, Fixture, MatchData, Standing } from '../types.ts';

// TheSportsDB's free public key. Rate-limited but needs no sign-up.
const BASE = 'https://www.thesportsdb.com/api/v1/json/123';

interface SdbEvent {
  strHomeTeam: string;
  strAwayTeam: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strTimestamp: string | null;
  dateEvent: string;
  strTime: string | null;
  strLeague: string;
  strVenue: string | null;
}

interface SdbStanding {
  intRank: string;
  strTeam: string;
  intPlayed: string;
  intWin: string;
  intDraw: string;
  intLoss: string;
  intGoalDifference: string;
  intPoints: string;
  strForm: string | null;
}

function toFixture(e: SdbEvent): Fixture {
  const iso = e.strTimestamp ? `${e.strTimestamp.replace(/Z?$/, '')}Z` : `${e.dateEvent}T${e.strTime ?? '15:00:00'}Z`;
  const score = (s: string | null) => (s === null || s === '' ? undefined : Number(s));
  return {
    date: new Date(iso).toISOString(),
    home: e.strHomeTeam,
    away: e.strAwayTeam,
    competition: e.strLeague,
    venue: e.strVenue ?? undefined,
    homeScore: score(e.intHomeScore),
    awayScore: score(e.intAwayScore),
  };
}

/** Scottish seasons run Jul–May: "2026-2027". */
export function seasonFor(d: Date): string {
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export async function collectMatchData(club: ClubConfig, now = new Date()): Promise<MatchData> {
  const { teamId, leagueId } = club.sportsdb;
  const [next, last, table] = await Promise.all([
    fetchJson<{ events: SdbEvent[] | null }>(`${BASE}/eventsnext.php?id=${teamId}`),
    fetchJson<{ results: SdbEvent[] | null }>(`${BASE}/eventslast.php?id=${teamId}`),
    fetchJson<{ table: SdbStanding[] | null }>(`${BASE}/lookuptable.php?l=${leagueId}&s=${seasonFor(now)}`),
  ]);
  return {
    next: (next.events ?? []).map(toFixture),
    last: (last.results ?? []).map(toFixture),
    table: (table.table ?? []).map(
      (r): Standing => ({
        pos: Number(r.intRank),
        team: r.strTeam,
        played: Number(r.intPlayed),
        won: Number(r.intWin),
        drawn: Number(r.intDraw),
        lost: Number(r.intLoss),
        gd: Number(r.intGoalDifference),
        pts: Number(r.intPoints),
        form: r.strForm ?? undefined,
      }),
    ),
  };
}
