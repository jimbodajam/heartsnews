// The live.json format the Worker (worker/) serves during a match and the player polls, and the code that builds it
// from BBC Sport. The score, clock, goals and red cards come from the match page's live-header (the team page has
// goals but not cards, so it's only the fallback); the commentary comes from the match page's live text stream, and
// the team stats from its match-stats block.

import { type BbcAction, type BbcData, type BbcEvent, block } from './bbc.ts';
import type { Graphic } from './bulletin.ts';

/** The deployed Worker (worker/). */
export const LIVE_URL = 'https://heartsnews-live.heartsnews.workers.dev/live.json';

export type LiveStatus ='pre' | 'live' | 'ht' | 'ft' | 'postponed';

/** A BBC live text post for one of the key moments of our match. */
export interface LivePost {
  code: string; // GOAL | CARD_RED (also a second yellow) | KICK_OFF (each half) | HALF_TIME | FULL_TIME
  minute?: string; // "32'", "90+5'": BBC often fills it in a minute or two after posting
  headline: string; // "GOAL Trabzonspor 1-0 Hearts", "RED CARD - Lopes Cabral (Trabzonspor)"
  header: string; // the running score, or the scorer on a goal ("Mo Salah (pen)")
  /** Paragraphs. Can be empty for a minute or so after a post goes up: wait for it before writing a line from it. */
  text: string[];
  at: string; // ISO, first published
  updated: string; // ISO, last published
}

export interface LiveEvent {
  kind: 'goal' | 'red';
  side: 'home' | 'away';
  player: string;
  minute: string; // "32'", "90'+5"
  detail?: string; // "Penalty", "Own Goal", "Red Card", "Two Yellow Cards"
  /** BBC has a goal pending (VAR or confirmation); the score doesn't include it yet. */
  unconfirmed?: true;
  /** The live text post about it, once it's among the latest posts. `post.at` is the time of the event. */
  post?: LivePost;
}

/** One side's match stats, as BBC has them. Saves are by this side's goalkeeper. */
export interface TeamStats {
  possession: number; // %, one decimal place: 60.7
  shots: number;
  onTarget: number;
  corners: number;
  fouls: number;
  saves: number;
  touchesInBox: number;
}

export interface MatchStats {
  home: TeamStats;
  away: TeamStats;
}

export interface LiveMatch {
  status: LiveStatus;
  /** While live: the minute, e.g. "32'" or "45'+2". */
  clock?: string;
  kickOff: string; // ISO
  competition: string;
  venue?: string;
  home: { name: string; score?: number };
  away: { name: string; score?: number };
  /** Which side is our club. */
  us: 'home' | 'away';
  events: LiveEvent[];
  /** Key posts for our match among BBC's latest 20 (older ones drop off), newest first. */
  posts: LivePost[];
  /** Live team stats, from about five minutes in. Noisy early on. */
  stats?: MatchStats;
  link?: string;
}

export interface LiveFeed {
  updated: string; // ISO, when BBC was read
  /** Our club's match on today's UK date, if there is one. */
  match: LiveMatch | null;
}

const KEY_CODES = new Set(['GOAL', 'CARD_RED', 'KICK_OFF', 'HALF_TIME', 'FULL_TIME']);

/** "2026-10-22" for a time, in UK local time. */
const ukDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);

/** Our club's fixture on today's UK date, from a scores-fixtures page's events. */
export function todaysEvent(events: BbcEvent[], team: string, now: Date): BbcEvent | undefined {
  const today = ukDate(now);
  const ours = (e: BbcEvent) => [e.home.urn, e.away.urn].some((u) => u?.split(':').pop() === team);
  return events.find((e) => ours(e) && ukDate(new Date(e.startDateTime)) === today);
}

interface BbcBlocks {
  type?: string;
  model?: { text?: string; blocks?: BbcBlocks[] };
}

interface BbcPost {
  typeCode: string | null;
  headline?: BbcBlocks | null;
  header?: BbcBlocks | null;
  content?: BbcBlocks | null;
  dates: { firstPublished: string; lastPublished: string; time?: string | null };
}

/** The paragraphs in one of BBC's nested block trees. */
function paragraphs(b?: BbcBlocks | null): string[] {
  return (b?.model?.blocks ?? []).flatMap((x) => (x.type === 'paragraph' ? [x.model?.text?.trim() ?? ''] : paragraphs(x))).filter(Boolean);
}

/** The key posts about our match. The stream is shared with other games on the night ("Celtic v Celta Vigo (20:00)"). */
function keyPosts(page: BbcData, home: string, away: string): LivePost[] {
  const results = block<{ results?: BbcPost[] }>(page, 'stream?')?.results ?? [];
  return results
    .filter((p) => p.typeCode && KEY_CODES.has(p.typeCode))
    .map(
      (p): LivePost => ({
        code: p.typeCode!,
        minute: p.dates.time ?? undefined,
        headline: paragraphs(p.headline).join(' '),
        header: paragraphs(p.header).join(' '),
        text: paragraphs(p.content),
        at: p.dates.firstPublished,
        updated: p.dates.lastPublished,
      }),
    )
    .filter((p) => {
      const title = `${p.headline} ${p.header}`;
      // Ours if it names either team; otherwise only if it doesn't look like another fixture ("A v B", "A 1-0 B").
      return title.includes(home) || title.includes(away) || !/ v |\d+-\d+/.test(title);
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** "90'+5" → 90.05, so stoppage time sorts before the next minute. */
const minuteValue = (m: string) => {
  const [base, extra] = m.replace(/[^\d+]/g, '').split('+');
  return Number(base || 0) + Number(extra || 0) / 100;
};
const sameMinute = (a?: string, b?: string) => a !== undefined && b !== undefined && a.replace(/[^\d+]/g, '') === b.replace(/[^\d+]/g, '');

function sideEvents(actions: BbcAction[] | undefined, side: 'home' | 'away'): LiveEvent[] {
  return (actions ?? []).flatMap((a) =>
    a.actions.flatMap((x): LiveEvent[] => {
      const base = { side, player: a.playerName, minute: x.timeLabel?.value ?? '', detail: x.type };
      if (a.actionType === 'goal') return [{ kind: 'goal', ...base }];
      if (a.actionType === 'goal-unconfirmed') return [{ kind: 'goal', ...base, unconfirmed: true }];
      // The live-header lists red cards (incl. second yellows) only, but skip a plain yellow if one ever appears.
      if (a.actionType === 'card' && !/^yellow/i.test(x.type)) return [{ kind: 'red', ...base }];
      return [];
    }),
  );
}

/**
 * Pair each event with its post. A goal post's headline carries the score after it ("GOAL Trabzonspor 2-0 Hearts"),
 * so the nth goal of the night is the post whose score adds up to n; otherwise match on the minute, or for a red
 * card on the player's surname ("RED CARD - Lopes Cabral (Trabzonspor)" for Sidny Cabral).
 */
function attachPosts(events: LiveEvent[], posts: LivePost[]): void {
  const used = new Set<LivePost>();
  const take = (e: LiveEvent, test: (p: LivePost) => boolean) => {
    const p = posts.find((p) => !used.has(p) && test(p));
    if (!p) return;
    used.add(p);
    e.post = p;
  };
  let goals = 0;
  for (const e of events) {
    if (e.kind === 'goal') {
      if (e.unconfirmed) continue;
      const n = ++goals;
      take(e, (p) => {
        if (p.code !== 'GOAL') return false;
        const score = /(\d+)-(\d+)/.exec(p.headline);
        return score ? Number(score[1]) + Number(score[2]) === n : sameMinute(p.minute, e.minute);
      });
    } else {
      const surname = e.player.split(' ').pop()!.toLowerCase();
      take(e, (p) => p.code === 'CARD_RED' && (sameMinute(p.minute, e.minute) || p.headline.toLowerCase().includes(surname)));
    }
  }
}

type BbcStats = Record<string, { total?: number } | undefined>;

/** The team stats on a BBC match page, once both sides have possession figures (none before about five minutes in). */
export function matchStats(page: BbcData): MatchStats | undefined {
  const d = block<{ homeTeam?: { stats?: BbcStats }; awayTeam?: { stats?: BbcStats } }>(page, 'match-stats?');
  const side = (s?: BbcStats): TeamStats | undefined => {
    const n = (k: string) => s?.[k]?.total ?? 0;
    if (typeof s?.possessionPercentage?.total !== 'number') return undefined;
    return {
      possession: n('possessionPercentage'),
      shots: n('shotsTotal'),
      onTarget: n('shotsOnTarget'),
      corners: n('cornersWon'),
      fouls: n('foulsCommitted'),
      saves: n('shotsSaved'),
      touchesInBox: n('touchesInBox'),
    };
  };
  const home = side(d?.homeTeam?.stats);
  const away = side(d?.awayTeam?.stats);
  return home && away ? { home, away } : undefined;
}

/** Possession as whole numbers that add up to 100: 60.7 / 39.3 → 61 / 39. */
export function possession(stats: MatchStats): { home: number; away: number } {
  const home = Math.round(stats.home.possession);
  return { home, away: 100 - home };
}

type StatsGraphic = Extract<Graphic, { type: 'stats' }>;

/** The stats card: the score and the stats that matter on air, side by side. */
export function statsCard(match: Omit<StatsGraphic, 'type' | 'rows'>, stats: MatchStats): StatsGraphic {
  const { home: h, away: a } = stats;
  const pos = possession(stats);
  return {
    type: 'stats',
    ...match,
    rows: [
      { label: 'POSSESSION', home: pos.home, away: pos.away, percent: true },
      { label: 'SHOTS', home: h.shots, away: a.shots },
      { label: 'ON TARGET', home: h.onTarget, away: a.onTarget },
      { label: 'CORNERS', home: h.corners, away: a.corners },
      { label: 'SAVES', home: h.saves, away: a.saves },
      { label: 'FOULS', home: h.fouls, away: a.fouls },
    ],
  };
}

const STATUS: Record<string, LiveStatus> = { PreEvent: 'pre', MidEvent: 'live', PostEvent: 'ft', Postponed: 'postponed' };

/**
 * Today's match as live.json describes it, from the team page's event and (when it could be fetched) the match
 * page's data. Without the match page there are no red cards or posts.
 */
export function liveMatch(teamEvent: BbcEvent, team: string, page?: BbcData): LiveMatch {
  const e = (page && block<{ sportDataEvent?: BbcEvent }>(page, 'live-header?')?.sportDataEvent) || teamEvent;
  const label = e.periodLabel?.value;
  let status = STATUS[e.status] ?? (/postpon|abandon|cancel/i.test(e.status) ? 'postponed' : 'pre');
  if (status === 'live' && label === 'HT') status = 'ht';
  const score = (s: BbcEvent['home']) => {
    const v = s.score ?? s.scoreUnconfirmed ?? s.runningScores?.fulltime;
    return status === 'pre' || v === undefined || v === '' ? undefined : Number(v);
  };
  const events = [...sideEvents(e.home.actions, 'home'), ...sideEvents(e.away.actions, 'away')].sort((a, b) => minuteValue(a.minute) - minuteValue(b.minute));
  const posts = page ? keyPosts(page, e.home.shortName, e.away.shortName) : [];
  attachPosts(events, [...posts].reverse());
  return {
    status,
    clock: status === 'live' ? label : undefined,
    kickOff: new Date(teamEvent.startDateTime).toISOString(), // the live-header only has the UK clock time
    competition: e.tournament?.name ?? teamEvent.tournament?.name ?? '',
    venue: e.venue?.name,
    home: { name: e.home.shortName, score: score(e.home) },
    away: { name: e.away.shortName, score: score(e.away) },
    us: e.away.urn?.split(':').pop() === team ? 'away' : 'home',
    events,
    posts,
    stats: page && status !== 'pre' ? matchStats(page) : undefined,
    link: teamEvent.onwardJourneyLink,
  };
}
