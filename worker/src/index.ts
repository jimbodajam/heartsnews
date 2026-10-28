// Cloudflare Worker serving live.json: our club's match today, read from BBC Sport on request. Works with the home PC
// off. The result is kept in memory for a short while (20s during a match), so BBC is read at most a
// few times a minute however many viewers are polling. (Cloudflare's Cache API has no effect on workers.dev.) The
// logic is in feed.ts, which a recorded match can be replayed through (`npm run replay`).
// It also serves /store, the channel's memory in D1, to the bulletin builds (store.ts), and is the channel's clock:
// a cron trigger every minute queues the programmes and breaking news that are due and hands them out, and starts the
// ingest every half hour (clock.ts). And /admin (admin.ts), the read-only backend view, behind ADMIN_TOKEN.
// Deploy (owner only): npx wrangler login, then npm run worker:deploy.

import club from '../../clubs/hearts.json';
import { initialData } from '../../shared/bbc.ts';
import { admin, type AdminEnv } from './admin.ts';
import { dispatcher, ingester, tick } from './clock.ts';
import { liveFeed } from './feed.ts';
import { store, type StoreEnv } from './store.ts';

const USER_AGENT = 'Mozilla/5.0 (compatible; HeartsNews24/0.1; hobby fan project)';

interface Env extends StoreEnv, AdminEnv {
  /** owner/name of the repo whose bulletin workflow builds jobs (wrangler.toml). */
  GITHUB_REPO?: string;
  /** A fine-grained token that can only run this repo's workflows (Actions: read and write), a Worker secret. */
  GITHUB_DISPATCH_TOKEN?: string;
}

async function page(path: string) {
  const res = await fetch(`https://www.bbc.co.uk${path}`, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
  if (!res.ok) throw new Error(`BBC ${path}: HTTP ${res.status}`);
  return initialData(await res.text());
}

const live = liveFeed({ team: club.bbc.team, page });

async function clock(env: Env): Promise<void> {
  if (!env.DB) return console.warn('clock: no D1 binding');
  const feed = await live.feed().catch((err: Error) => console.warn(`clock: live.json: ${err.message}`));
  const dispatch =
    env.GITHUB_REPO && env.GITHUB_DISPATCH_TOKEN
      ? dispatcher(env.GITHUB_REPO, env.GITHUB_DISPATCH_TOKEN)
      : async () => {
          throw new Error('GITHUB_DISPATCH_TOKEN is not set');
        };
  const ingest = env.GITHUB_REPO && env.GITHUB_DISPATCH_TOKEN ? ingester(env.GITHUB_REPO, env.GITHUB_DISPATCH_TOKEN) : undefined;
  const r = await tick(env.DB, feed ?? undefined, { dispatch, ingest });
  if (r.queued.length || r.dispatched.length) console.log(`clock: queued ${r.queued.join(', ') || 'nothing'}; sent to GitHub ${r.dispatched.join(', ') || 'nothing'}`);
  if (r.ingested) console.log('clock: started the ingest');
  for (const e of r.errors) console.warn(`clock: couldn't send ${e}`);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/store') return store(request, env);
    if (path === '/admin' || path === '/admin.json') return admin(request, env);
    return live.respond(request);
  },
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): void => ctx.waitUntil(clock(env)),
};
