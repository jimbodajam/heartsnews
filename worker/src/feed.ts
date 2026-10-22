// The Worker's logic without Cloudflare: finds our match today, reads it from BBC Sport and keeps the result for a
// short while. The BBC reader and the clock are passed in, so a recorded match can be replayed through the same code
// at speed (`npm run replay`, pipeline/src/replay.ts) and tested (pipeline/test/replay.test.ts).

import { type BbcData, eventsIn } from '../../shared/bbc.ts';
import { type LiveFeed, liveMatch, todaysEvent } from '../../shared/live.ts';

export interface FeedOptions {
  /** Our club's BBC team slug. */
  team: string;
  /** A BBC Sport page's data, by path ("/sport/football/teams/heart-of-midlothian/scores-fixtures"). */
  page: (path: string) => Promise<BbcData>;
  /** The time now, in ms. A replay runs its own clock. */
  now?: () => number;
}

/** Seconds to keep a feed: short while a game is on, long on a day without one. */
export function ttl(feed: LiveFeed, now: number): number {
  const m = feed.match;
  if (!m) return 300;
  if (m.status === 'live' || m.status === 'ht') return 20;
  // Before kick-off, poll faster as it approaches so the switch to live is quick.
  if (m.status === 'pre') return Date.parse(m.kickOff) - now < 15 * 60_000 ? 20 : 60;
  return 120;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

export function liveFeed({ team, page, now = Date.now }: FeedOptions) {
  let kept: { feed: LiveFeed; until: number } | undefined;
  let reading: Promise<LiveFeed> | undefined;

  async function read(t: Date): Promise<LiveFeed> {
    const event = todaysEvent(eventsIn(await page(`/sport/football/teams/${team}/scores-fixtures`)), team, t);
    if (!event) return { updated: t.toISOString(), match: null };
    // The match page has the red cards and live text; fall back to the team page's score if it fails.
    const match = event.onwardJourneyLink ? await page(event.onwardJourneyLink).catch(() => undefined) : undefined;
    return { updated: t.toISOString(), match: liveMatch(event, team, match) };
  }

  /** live.json now: from memory if it's fresh enough, otherwise read from BBC. */
  async function feed(): Promise<LiveFeed> {
    if (kept && now() < kept.until) return kept.feed;
    // One BBC read at a time, shared by every request that arrives meanwhile.
    reading ??= read(new Date(now()))
      .then((f) => {
        kept = { feed: f, until: now() + ttl(f, now()) * 1000 };
        return f;
      })
      .finally(() => {
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
