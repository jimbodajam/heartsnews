// Cloudflare Worker serving live.json: our club's match today, read from BBC Sport on request. Works with the home PC
// off; no secrets. The result is kept in memory for a short while (20s during a match), so BBC is read at most a
// few times a minute however many viewers are polling. (Cloudflare's Cache API has no effect on workers.dev.) The
// logic is in feed.ts, which a recorded match can be replayed through (`npm run replay`).
// It also serves /store, the channel's memory in D1, to the bulletin builds (store.ts).
// Deploy (owner only): npx wrangler login, then npm run worker:deploy.

import club from '../../clubs/hearts.json';
import { initialData } from '../../shared/bbc.ts';
import { liveFeed } from './feed.ts';
import { store, type StoreEnv } from './store.ts';

const USER_AGENT = 'Mozilla/5.0 (compatible; HeartsNews24/0.1; hobby fan project)';

async function page(path: string) {
  const res = await fetch(`https://www.bbc.co.uk${path}`, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
  if (!res.ok) throw new Error(`BBC ${path}: HTTP ${res.status}`);
  return initialData(await res.text());
}

const live = liveFeed({ team: club.bbc.team, page });

export default {
  fetch: (request: Request, env: StoreEnv): Promise<Response> =>
    new URL(request.url).pathname === '/store' ? store(request, env) : live.respond(request),
};
