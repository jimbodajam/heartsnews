// The Worker's logic without Cloudflare: finds our match today, reads it from BBC Sport and keeps the result for a
// short while. The BBC reader and the clock are passed in, so a recorded match can be replayed through the same code
// at speed (`npm run replay`, pipeline/src/replay.ts) and tested (pipeline/test/replay.test.ts).
// BBC is read only in a window around each of our kick-offs (issue #104), which the ingest keeps in the store every half
// hour (state 'live_schedule'). Outside one, live.json repeats what it last said today, or says there's no match.

import { type BbcData, eventsIn } from '../../shared/bbc.ts';
import { type LiveFeed, liveMatch, todaysEvent } from '../../shared/live.ts';

/** Our kick-offs as the ingest last saw them (state 'live_schedule'). */
export interface Schedule {
  /** ISO kick-offs of the games just finished, on now and coming up. */
  kickOffs: string[];
  /** ISO, when the ingest wrote it. */
  at: string;
}

/** A read of live.json and until when it holds (ms), kept between runs (state 'live_feed'). */
export interface Kept {
  feed: LiveFeed;
  until: number;
  /** When its match was first read at full time (ms). */
  ftAt?: number;
}

const MIN = 60_000;
/** BBC is read from this long before a kick-off (the team news comes about an hour before)... */
export const OPEN_BEFORE_MS = 120 * MIN;
/** ...until this long after BBC says full time... */
export const CLOSE_AFTER_FT_MS = 15 * MIN;
/** ...or this long after kick-off, if BBC never says it. */
export const CLOSE_AFTER_KO_MS = 240 * MIN;
/** A schedule older than this (the ingest has stopped) isn't trusted: BBC is read as before. */
export const SCHEDULE_STALE_MS = 120 * MIN;
/** Outside a window, how long an answer is kept before the schedule is looked at again. */
const QUIET_MS = MIN;

const ukDate = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(t));

/** Whether to read BBC at `now`: inside a kick-off's window, or when there's no fresh schedule to go by. */
export function inWindow(schedule: Schedule | undefined, kept: Kept | undefined, now: number): boolean {
  if (!schedule || !(now - Date.parse(schedule.at) < SCHEDULE_STALE_MS)) return true;
  return schedule.kickOffs.some((k) => {
    const ko = Date.parse(k);
    if (now < ko - OPEN_BEFORE_MS || now > ko + CLOSE_AFTER_KO_MS) return false;
    const m = kept?.feed.match;
    const ftAt = m && Date.parse(m.kickOff) === ko ? kept.ftAt : undefined;
    return ftAt === undefined || now < ftAt + CLOSE_AFTER_FT_MS;
  });
}

export interface FeedOptions {
  /** Our club's BBC team slug. */
  team: string;
  /** A BBC Sport page's data, by path ("/sport/football/teams/heart-of-midlothian/scores-fixtures"). */
  page: (path: string) => Promise<BbcData>;
  /** The time now, in ms. A replay runs its own clock. */
  now?: () => number;
  /** Our kick-offs (issue #104). Without it BBC is read whenever the last read runs out, as in a replay. */
  schedule?: () => Promise<Schedule | undefined>;
  /** Keeps the last read between runs: a cron run may start with nothing in memory. */
  memory?: { get(): Promise<Kept | undefined>; set(kept: Kept): Promise<void> };
}

/** Seconds to keep a feed: short while a game is on, long on a day without one. */
export function ttl(feed: LiveFeed, now: number): number {
  const m = feed.match;
  if (!m) return 300;
  if (m.status === 'live' || m.status === 'ht') return 20;
  // Before kick-off, every five minutes (for the team news), then faster so the switch to live is quick.
  if (m.status === 'pre') return Date.parse(m.kickOff) - now < 15 * 60_000 ? 20 : 300;
  return 120;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

export function liveFeed({ team, page, now = Date.now, schedule, memory }: FeedOptions) {
  let kept: Kept | undefined;
  let reading: Promise<LiveFeed> | undefined;
  /** Outside a window: what was served, and until when. */
  let quiet: { feed: LiveFeed; until: number } | undefined;

  async function read(t: Date): Promise<LiveFeed> {
    const event = todaysEvent(eventsIn(await page(`/sport/football/teams/${team}/scores-fixtures`)), team, t);
    if (!event) return { updated: t.toISOString(), match: null };
    // The match page has the red cards and live text; fall back to the team page's score if it fails.
    const match = event.onwardJourneyLink ? await page(event.onwardJourneyLink).catch(() => undefined) : undefined;
    return { updated: t.toISOString(), match: liveMatch(event, team, match) };
  }

  /** The last read from the store, if it's newer than the one in memory. */
  async function recall(): Promise<void> {
    const stored = memory ? await memory.get().catch(() => undefined) : undefined;
    if (stored && (!kept || stored.until > kept.until)) kept = stored;
  }

  async function look(): Promise<LiveFeed> {
    await recall();
    const t = now();
    if (kept && t < kept.until) return kept.feed;
    if (schedule && !inWindow(await schedule().catch(() => undefined), kept, t)) {
      // Today's last read stands (the result, after full time); otherwise there's no match to tell of.
      const today = kept?.feed.match && ukDate(Date.parse(kept.feed.match.kickOff)) === ukDate(t);
      const f = today ? kept!.feed : { updated: new Date(t).toISOString(), match: null };
      quiet = { feed: f, until: t + QUIET_MS };
      return f;
    }
    quiet = undefined;
    const f = await read(new Date(t));
    const m = f.match;
    const before = kept?.feed.match;
    const ftAt = m?.status === 'ft' ? (before?.kickOff === m.kickOff && kept?.ftAt) || now() : undefined;
    kept = { feed: f, until: now() + ttl(f, now()) * 1000, ...(ftAt ? { ftAt } : {}) };
    await memory?.set(kept).catch(() => undefined);
    return f;
  }

  /** live.json now: from memory if it's fresh enough, otherwise from BBC inside a window, or as it stands outside one. */
  async function feed(): Promise<LiveFeed> {
    if (kept && now() < kept.until) return kept.feed;
    if (quiet && now() < quiet.until) return quiet.feed;
    // One look at a time, shared by every request that arrives meanwhile.
    reading ??= look().finally(() => {
      reading = undefined;
    });
    return reading;
  }

  /** The Worker's response to a request. */
  async function respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname !== '/' && url.pathname !== '/live.json') return new Response('Not found', { status: 404, headers: CORS });
    try {
      const f = await feed();
      return Response.json(f, { headers: { ...CORS, 'cache-control': `public, max-age=${Math.min(ttl(f, now()), 20)}` } });
    } catch (err) {
      // Serve the last good feed if there is one, so a BBC hiccup doesn't blank the score bug.
      if (kept) return Response.json(kept.feed, { headers: { ...CORS, 'cache-control': 'no-store' } });
      return Response.json({ error: (err as Error).message }, { status: 502, headers: { ...CORS, 'cache-control': 'no-store' } });
    }
  }

  return { feed, respond };
}
