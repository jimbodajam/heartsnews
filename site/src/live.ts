// The live score: polls the Worker's live.json while there's a match today and turns it into a ticker item, so the
// score and scorers come round between the headlines. Quietly shows nothing if the Worker can't be reached.

import type { LiveEvent, LiveFeed, LiveMatch } from '../../shared/live';

/** Show the match in the ticker from this long before kick-off. */
const PRE_MATCH_MS = 15 * 60_000;
/** Drop the score if the Worker hasn't answered for this long, rather than show an old one as current. */
const STALE_MS = 10 * 60_000;

export type FeedSource = () => Promise<LiveFeed>;

export function workerSource(url: string): FeedSource {
  return async () => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`live.json: HTTP ${res.status}`);
    return (await res.json()) as LiveFeed;
  };
}

const goals = (m: LiveMatch) => (m.home.score ?? 0) + (m.away.score ?? 0);

/** "17:45", UK time. */
const ukTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

/** "Salah 32' pen" style, for one side's goals. */
function scorers(events: LiveEvent[], side: 'home' | 'away'): string {
  return events
    .filter((e) => e.kind === 'goal' && e.side === side && !e.unconfirmed)
    .map((e) => {
      const tag = /penalty/i.test(e.detail ?? '') ? ' pen' : /own goal/i.test(e.detail ?? '') ? ' og' : '';
      return `${e.player} ${e.minute}${tag}`;
    })
    .join(', ');
}

/** The ticker item for a match, e.g. "LIVE 58': Trabzonspor 2-0 Hearts (Salah 32' pen, Franculino 58')". */
export function scoreLine(m: LiveMatch): string {
  const fixture = `${m.home.name} v ${m.away.name}`;
  if (m.status === 'pre') return `Kick-off ${ukTime(m.kickOff)}: ${fixture}${m.competition ? ` - ${m.competition}` : ''}`;
  if (m.status === 'postponed') return `${fixture}: postponed`;
  const label = m.status === 'ht' ? 'Half-time' : m.status === 'ft' ? 'Full-time' : `Live ${m.clock ?? ''}`.trim();
  const score = `${m.home.name} ${m.home.score ?? 0}-${m.away.score ?? 0} ${m.away.name}`;
  const scored = [scorers(m.events, 'home'), scorers(m.events, 'away')];
  const detail = scored[0] && scored[1] ? `${m.home.name}: ${scored[0]}; ${m.away.name}: ${scored[1]}` : scored[0] || scored[1];
  return `${label}: ${score}${detail ? ` (${detail})` : ''}`;
}

/** Polls live.json: every 20s or so during a match, less often otherwise. */
export class LiveScore {
  /** Called when the score goes up (not on the first read). */
  onGoal?: () => void;
  private feed?: LiveFeed;
  private lastOk = 0;

  constructor(
    private source: FeedSource,
    /** Speeds up polling, for replays. */
    private pace = 1,
  ) {}

  start(): void {
    void this.poll();
  }

  /** The match to show now, if any: from shortly before kick-off until the Worker moves on to another day. */
  match(): LiveMatch | undefined {
    const m = this.feed?.match;
    if (!m || Date.now() - this.lastOk > STALE_MS / this.pace) return undefined;
    if (m.status === 'pre' && Date.parse(m.kickOff) - Date.parse(this.feed!.updated) > PRE_MATCH_MS) return undefined;
    return m;
  }

  /** Today's match whenever the Worker has one, even hours before kick-off (for the team news). */
  today(): LiveMatch | undefined {
    const m = this.feed?.match;
    return m && Date.now() - this.lastOk <= STALE_MS / this.pace ? m : undefined;
  }

  private async poll(): Promise<void> {
    let wait = 60_000;
    try {
      const feed = await this.source();
      const before = this.feed?.match;
      const after = feed.match;
      this.feed = feed;
      this.lastOk = Date.now();
      if (before && after && before.kickOff === after.kickOff && goals(after) > goals(before)) this.onGoal?.();
      wait = this.interval(feed);
    } catch (err) {
      console.warn('[live]', (err as Error).message);
    }
    setTimeout(() => void this.poll(), wait / this.pace);
  }

  private interval(feed: LiveFeed): number {
    const m = feed.match;
    if (!m) return 300_000;
    if (m.status === 'live' || m.status === 'ht') return 20_000;
    if (m.status === 'pre') return Date.parse(m.kickOff) - Date.parse(feed.updated) < PRE_MATCH_MS + 60_000 ? 20_000 : 60_000;
    return 120_000;
  }
}
