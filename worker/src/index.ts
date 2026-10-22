// Cloudflare Worker serving live.json: our club's match today, read from BBC Sport on request. Works with the home PC
// off; no secrets. The result is kept in memory for a short while (20s during a match), so BBC is read at most a
// few times a minute however many viewers are polling. (Cloudflare's Cache API has no effect on workers.dev.)
// Deploy (owner only): npx wrangler login, then npm run worker:deploy.

import club from '../../clubs/hearts.json';
import { eventsIn, initialData } from '../../shared/bbc.ts';
import { type LiveFeed, liveMatch, todaysEvent } from '../../shared/live.ts';

const USER_AGENT = 'Mozilla/5.0 (compatible; HeartsNews24/0.1; hobby fan project)';
const TEAM = club.bbc.team;

/** Seconds to keep a feed: short while a game is on, long on a day without one. */
function ttl(feed: LiveFeed): number {
  const m = feed.match;
  if (!m) return 300;
  if (m.status === 'live' || m.status === 'ht') return 20;
  // Before kick-off, poll faster as it approaches so the switch to live is quick.
  if (m.status === 'pre') return Date.parse(m.kickOff) - Date.now() < 15 * 60_000 ? 20 : 60;
  return 120;
}

async function page(path: string) {
  const res = await fetch(`https://www.bbc.co.uk${path}`, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
  if (!res.ok) throw new Error(`BBC ${path}: HTTP ${res.status}`);
  return initialData(await res.text());
}

async function read(now: Date): Promise<LiveFeed> {
  const event = todaysEvent(eventsIn(await page(`/sport/football/teams/${TEAM}/scores-fixtures`)), TEAM, now);
  if (!event) return { updated: now.toISOString(), match: null };
  // The match page has the red cards and live text; fall back to the team page's score if it fails.
  const match = event.onwardJourneyLink ? await page(event.onwardJourneyLink).catch(() => undefined) : undefined;
  return { updated: now.toISOString(), match: liveMatch(event, TEAM, match) };
}

let kept: { feed: LiveFeed; until: number } | undefined;
let reading: Promise<LiveFeed> | undefined;

async function feed(): Promise<LiveFeed> {
  if (kept && Date.now() < kept.until) return kept.feed;
  // One BBC read at a time, shared by every request that arrives meanwhile.
  reading ??= read(new Date())
    .then((f) => {
      kept = { feed: f, until: Date.now() + ttl(f) * 1000 };
      return f;
    })
    .finally(() => {
      reading = undefined;
    });
  return reading;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname !== '/' && url.pathname !== '/live.json') return new Response('Not found', { status: 404, headers: CORS });
    try {
      const f = await feed();
      return Response.json(f, { headers: { ...CORS, 'cache-control': `public, max-age=${Math.min(ttl(f), 20)}` } });
    } catch (err) {
      // Serve the last good feed if there is one, so a BBC hiccup doesn't blank the score bug.
      if (kept) return Response.json(kept.feed, { headers: { ...CORS, 'cache-control': 'no-store' } });
      return Response.json({ error: (err as Error).message }, { status: 502, headers: { ...CORS, 'cache-control': 'no-store' } });
    }
  },
};
