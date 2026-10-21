import { fetchText } from '../http.ts';
import type { ClubConfig, Fixture, MatchData, Standing } from '../types.ts';

// BBC Sport team pages embed their data as JSON (window.__INITIAL_DATA__): fixtures, results with scorers,
// live status, and the full league table. Usually updated within minutes of the final whistle.

const BASE = 'https://www.bbc.co.uk/sport/football/teams';

interface BbcSide {
  shortName: string;
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

function initialData(html: string): Record<string, { data?: unknown }> {
  const m = /window\.__INITIAL_DATA__\s*=\s*("(?:[^"\\]|\\.)*")/.exec(html);
  if (!m) throw new Error('BBC page has no __INITIAL_DATA__');
  return (JSON.parse(JSON.parse(m[1])) as { data: Record<string, { data?: unknown }> }).data;
}

async function pageEvents(path: string): Promise<BbcEvent[]> {
  const data = initialData(await fetchText(`${BASE}/${path}`));
  const key = Object.keys(data).find((k) => k.startsWith('sport-data-scores-fixtures'));
  const groups = (data[key ?? '']?.data as { eventGroups?: { secondaryGroups: { events: BbcEvent[] }[] }[] } | undefined)?.eventGroups ?? [];
  return groups.flatMap((g) => g.secondaryGroups.flatMap((s) => s.events));
}

const STATUS: Record<string, Fixture['status']> = { PreEvent: 'pre', MidEvent: 'live', PostEvent: 'done', Postponed: 'postponed' };

function toFixture(e: BbcEvent): Fixture {
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
  };
}

function previousMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function collectBbcMatchData(club: ClubConfig, now = new Date()): Promise<MatchData> {
  if (!club.bbc) throw new Error('no bbc config for club');
  const { team, league } = club.bbc;
  // Upcoming (and today's), this month's results, and last month's results so early-month bulletins still have form.
  const [upcoming, recent, older, tableHtml] = await Promise.all([
    pageEvents(`${team}/scores-fixtures`),
    pageEvents(`${team}/scores-fixtures?filter=results`),
    pageEvents(`${team}/scores-fixtures/${previousMonth(now)}`).catch(() => []),
    fetchText(`${BASE}/${team}/table`),
  ]);

  const seen = new Set<string>();
  const all = [...upcoming, ...recent, ...older]
    .map(toFixture)
    .filter((f) => !seen.has(f.date + f.home) && seen.add(f.date + f.home));

  const tableData = initialData(tableHtml);
  const tKey = Object.keys(tableData).find((k) => k.startsWith('football-table'));
  const tournaments =
    (tableData[tKey ?? '']?.data as { tournaments?: { urn: string; stages: { rounds: { participants: BbcStanding[] }[] }[] }[] } | undefined)
      ?.tournaments ?? [];
  const rows = tournaments.find((t) => t.urn.includes(league))?.stages[0]?.rounds[0]?.participants ?? [];

  return {
    // Live games count as "next" until they finish, so the matchday logic can see them.
    next: all.filter((f) => f.status === 'pre' || f.status === 'live').sort((a, b) => a.date.localeCompare(b.date)),
    last: all.filter((f) => f.status === 'done').sort((a, b) => b.date.localeCompare(a.date)),
    table: rows.map(
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
    ),
  };
}
