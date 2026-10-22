import { fetchText } from '../http.ts';
import type { ClubConfig, Fixture, Lineup, MatchData, OpponentFocus, Standing } from '../types.ts';

// BBC Sport team pages embed their data as JSON (window.__INITIAL_DATA__): fixtures, results with scorers,
// live status, and the full league table. Usually updated within minutes of the final whistle.

export const BASE = 'https://www.bbc.co.uk/sport/football/teams';

interface BbcSide {
  shortName: string;
  urn?: string;
  score?: string;
  scoreUnconfirmed?: string;
  runningScores?: { fulltime?: string };
  actions?: { playerName: string; actionType: string; actions: { type: string; timeLabel?: { value: string } }[] }[];
}

interface BbcEvent {
  home: BbcSide;
  away: BbcSide;
  startDateTime: string;
  status: string; // PreEvent | MidEvent | PostEvent | Postponed | ...
  periodLabel?: { value: string };
  tournament?: { name: string };
  onwardJourneyLink?: string;
}

interface BbcLineupTeam {
  name: { shortName: string };
  formation?: { layout: string };
  pitchLayout?: { name: string }[][];
}

interface BbcStanding {
  rank: number;
  shortName: string;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalDifference: number;
  points: number;
  formGuide?: { value: string }[];
}

export function initialData(html: string): Record<string, { data?: unknown }> {
  const m = /window\.__INITIAL_DATA__\s*=\s*("(?:[^"\\]|\\.)*")/.exec(html);
  if (!m) throw new Error('BBC page has no __INITIAL_DATA__');
  return (JSON.parse(JSON.parse(m[1])) as { data: Record<string, { data?: unknown }> }).data;
}

/** The fixtures and results listed in a scores-fixtures page's data. */
export function eventsIn(data: Record<string, { data?: unknown }>): BbcEvent[] {
  const key = Object.keys(data).find((k) => k.startsWith('sport-data-scores-fixtures'));
  const groups = (data[key ?? '']?.data as { eventGroups?: { secondaryGroups: { events: BbcEvent[] }[] }[] } | undefined)?.eventGroups ?? [];
  return groups.flatMap((g) => g.secondaryGroups.flatMap((s) => s.events));
}

async function pageEvents(path: string): Promise<BbcEvent[]> {
  return eventsIn(initialData(await fetchText(`${BASE}/${path}`)));
}

const STATUS: Record<string, Fixture['status']> = { PreEvent: 'pre', MidEvent: 'live', PostEvent: 'done', Postponed: 'postponed' };

export function toFixture(e: BbcEvent): Fixture {
  const score = (s: BbcSide) => {
    const v = s.score ?? s.scoreUnconfirmed ?? s.runningScores?.fulltime;
    return v === undefined || v === '' ? undefined : Number(v);
  };
  const scorers = (['home', 'away'] as const).flatMap((side) =>
    (e[side].actions ?? [])
      .filter((a) => a.actionType === 'goal')
      .flatMap((a) => a.actions.map((x) => ({ side, player: a.playerName, minute: x.timeLabel?.value ?? '' }))),
  );
  const status = STATUS[e.status] ?? (/postpon|abandon|cancel/i.test(e.status) ? 'postponed' : undefined);
  return {
    date: new Date(e.startDateTime).toISOString(),
    home: e.home.shortName,
    away: e.away.shortName,
    competition: e.tournament?.name ?? '',
    homeScore: status === 'pre' ? undefined : score(e.home),
    awayScore: status === 'pre' ? undefined : score(e.away),
    status,
    period: e.periodLabel?.value,
    scorers: scorers.sort((a, b) => parseInt(a.minute) - parseInt(b.minute)),
    homeSlug: slugOf(e.home.urn),
    awaySlug: slugOf(e.away.urn),
    link: e.onwardJourneyLink,
  };
}

const slugOf = (urn?: string) => urn?.split(':').pop();

/** Both starting XIs from a BBC match page, if it has them yet (confirmed about an hour before kick-off). */
async function matchLineups(link: string): Promise<{ home?: Lineup; away?: Lineup }> {
  const data = initialData(await fetchText(`https://www.bbc.co.uk${link}`));
  const key = Object.keys(data).find((k) => k.startsWith('match-lineups'));
  const d = data[key ?? '']?.data as { homeTeam?: BbcLineupTeam; awayTeam?: BbcLineupTeam } | undefined;
  const toLineup = (t?: BbcLineupTeam): Lineup | undefined => {
    const rows = (t?.pitchLayout ?? []).map((row) => row.map((p) => p.name));
    if (!t || rows.flat().length < 11) return undefined;
    return { team: t.name.shortName, formation: (t.formation?.layout ?? '').split('').join('-'), rows };
  };
  return { home: toLineup(d?.homeTeam), away: toLineup(d?.awayTeam) };
}

/** A team's XI from the most recent match that has line-ups. */
async function lastLineup(results: Fixture[], slug: string): Promise<Lineup | undefined> {
  for (const r of results.slice(0, 2)) {
    if (!r.link) continue;
    try {
      const l = await matchLineups(r.link);
      const ours = r.homeSlug === slug ? l.home : r.awaySlug === slug ? l.away : undefined;
      if (ours) return ours;
    } catch {
      // Try the match before.
    }
  }
  return undefined;
}

/**
 * Build-up material for the next game: the opponent's recent results, and both XIs. Uses the confirmed teams
 * from the match page when they're out; otherwise each side's line-up from their last game.
 */
async function opponentFocus(ourSlug: string, next: Fixture, ourResults: Fixture[]): Promise<OpponentFocus> {
  const weAreHome = next.homeSlug === ourSlug;
  const oppSlug = weAreHome ? next.awaySlug : next.homeSlug;
  const opponent = weAreHome ? next.away : next.home;
  const results = oppSlug
    ? (await pageEvents(`${oppSlug}/scores-fixtures?filter=results`).catch(() => []))
        .map(toFixture)
        .filter((f) => f.status === 'done')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5)
    : [];

  const confirmed = next.link ? await matchLineups(next.link).catch(() => ({}) as { home?: Lineup; away?: Lineup }) : {};
  const ourConfirmed = weAreHome ? confirmed.home : confirmed.away;
  const theirConfirmed = weAreHome ? confirmed.away : confirmed.home;
  if (ourConfirmed && theirConfirmed) return { fixture: next, opponent, results, ourXI: ourConfirmed, theirXI: theirConfirmed, confirmed: true };

  const [ourXI, theirXI] = await Promise.all([lastLineup(ourResults, ourSlug), oppSlug ? lastLineup(results, oppSlug) : undefined]);
  return { fixture: next, opponent, results, ourXI, theirXI, confirmed: false };
}

/** "2026-10" for this month, with an offset in months (-1 = last month, 1 = next). */
function monthKey(now: Date, offset: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function collectBbcMatchData(club: ClubConfig, now = new Date()): Promise<MatchData> {
  if (!club.bbc) throw new Error('no bbc config for club');
  const { team, league } = club.bbc;
  // Upcoming (and today's), this and next month's fixtures (on matchday the default page only shows today),
  // this month's results, and last month's results so early-month bulletins still have form.
  const [upcoming, thisMonth, nextMonth, recent, older, tableHtml] = await Promise.all([
    pageEvents(`${team}/scores-fixtures`),
    pageEvents(`${team}/scores-fixtures/${monthKey(now, 0)}`).catch(() => []),
    pageEvents(`${team}/scores-fixtures/${monthKey(now, 1)}`).catch(() => []),
    pageEvents(`${team}/scores-fixtures?filter=results`),
    pageEvents(`${team}/scores-fixtures/${monthKey(now, -1)}`).catch(() => []),
    fetchText(`${BASE}/${team}/table`),
  ]);

  const seen = new Set<string>();
  const all = [...upcoming, ...thisMonth, ...nextMonth, ...recent, ...older]
    .map(toFixture)
    .filter((f) => !seen.has(f.date + f.home) && seen.add(f.date + f.home));

  const tableData = initialData(tableHtml);
  const tKey = Object.keys(tableData).find((k) => k.startsWith('football-table'));
  const tournaments =
    (tableData[tKey ?? '']?.data as { tournaments?: { urn: string; name?: string; stages: { rounds: { participants: BbcStanding[] }[] }[] }[] } | undefined)
      ?.tournaments ?? [];
  const standings = (t?: (typeof tournaments)[number]) =>
    (t?.stages[0]?.rounds[0]?.participants ?? []).map(
      (r): Standing => ({
        pos: r.rank,
        team: r.shortName,
        played: r.matchesPlayed,
        won: r.wins,
        drawn: r.draws,
        lost: r.losses,
        gd: r.goalDifference,
        pts: r.points,
        form: (r.formGuide ?? []).map((g) => g.value).filter((v) => v !== '-').join(''),
      }),
    );

  // Live games count as "next" until they finish, so the matchday logic can see them.
  const next = all.filter((f) => f.status === 'pre' || f.status === 'live').sort((a, b) => a.date.localeCompare(b.date));
  const last = all.filter((f) => f.status === 'done').sort((a, b) => b.date.localeCompare(a.date));

  // Opponent focus only when the next game is close (within five days), to keep requests down otherwise.
  const soon = next[0] && Date.parse(next[0].date) - now.getTime() < 5 * 86_400_000 ? next[0] : undefined;
  const opponent = soon ? await opponentFocus(team, soon, last).catch(() => undefined) : undefined;

  return {
    next,
    last,
    opponent,
    table: standings(tournaments.find((t) => t.urn.includes(league))),
    tables: tournaments
      .filter((t) => !t.urn.includes(league) && t.name)
      .map((t) => ({ competition: t.name!, rows: standings(t) }))
      .filter((t) => t.rows.length),
  };
}
