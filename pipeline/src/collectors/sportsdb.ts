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

/** Merge event lists, keep the club's games only, drop duplicates, order by date. */
function ourGames(club: ClubConfig, lists: (SdbEvent[] | null | undefined)[], newestFirst: boolean): Fixture[] {
  const seen = new Set<string>();
  return lists
    .flatMap((l) => l ?? [])
    .filter((e) => e.strHomeTeam === club.name || e.strAwayTeam === club.name)
    .map(toFixture)
    .filter((f) => !seen.has(f.date + f.home) && seen.add(f.date + f.home))
    .sort((a, b) => (newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
}

/** The club's people on TheSportsDB. The free key returns only the first ten, so this tops up the club's own list. */
export async function collectPlayers(club: ClubConfig): Promise<{ name: string; role: 'player' | 'staff' }[]> {
  const res = await fetchJson<{ player: { strPlayer: string; strPosition: string | null }[] | null }>(
    `${BASE}/lookup_all_players.php?id=${club.sportsdb.teamId}`,
  );
  return (res.player ?? []).map((p) => ({ name: p.strPlayer, role: /manager|coach/i.test(p.strPosition ?? '') ? 'staff' : 'player' }));
}

export async function collectMatchData(club: ClubConfig, now = new Date()): Promise<MatchData> {
  const { teamId, leagueId } = club.sportsdb;
  // The free key returns only one event per call, so the team's own feed (which covers cup and European games)
  // is combined with the league-wide feeds, which are often more up to date for league matches.
  const [next, nextLeague, last, lastLeague, table] = await Promise.all([
    fetchJson<{ events: SdbEvent[] | null }>(`${BASE}/eventsnext.php?id=${teamId}`),
    fetchJson<{ events: SdbEvent[] | null }>(`${BASE}/eventsnextleague.php?id=${leagueId}`),
    fetchJson<{ results: SdbEvent[] | null }>(`${BASE}/eventslast.php?id=${teamId}`),
    fetchJson<{ events: SdbEvent[] | null }>(`${BASE}/eventspastleague.php?id=${leagueId}`),
    fetchJson<{ table: SdbStanding[] | null }>(`${BASE}/lookuptable.php?l=${leagueId}&s=${seasonFor(now)}`),
  ]);
  return {
    next: ourGames(club, [next.events, nextLeague.events], false),
    last: ourGames(club, [last.results, lastLeague.events], true),
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
