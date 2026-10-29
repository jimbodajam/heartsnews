// The Kickback crawler's two endpoints (issue #62), for the fetcher on a home machine (tools/pi/kickback-fetch.sh). The forum's
// bot check turns away Cloudflare's own Workers, so the Worker decides and the home machine fetches:
//   GET  /kickback/next  → { url, waitMs } to fetch, or { idle, retryInSec }
//   POST /kickback/page  ← { url, status, headers?, body?, error? } for the page it was handed
// Behind KICKBACK_TOKEN, a Worker secret of its own: it can only do this, unlike STORE_TOKEN, which runs any SQL.

import { accept, nextRequest, type Reply } from '../../kickback/src/crawl.ts';
import { sameToken, type D1Database } from './store.ts';

export interface KickbackEnv {
  DB?: D1Database;
  KICKBACK_TOKEN?: string;
}

const noStore = { 'cache-control': 'no-store' };
/** A page of the forum is a few hundred kilobytes at most; anything much bigger is not one. */
const MAX_BODY = 2_000_000;

export async function kickback(request: Request, env: KickbackEnv, now = Date.now()): Promise<Response> {
  if (!env.DB || !env.KICKBACK_TOKEN) return new Response('Kickback not configured', { status: 503, headers: noStore });
  const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer || !sameToken(bearer, env.KICKBACK_TOKEN)) return new Response('Unauthorised', { status: 401, headers: { ...noStore, 'content-type': 'text/plain' } });

  const db = env.DB;
  const store = { batch: async (statements: { sql: string; params?: unknown[] }[]) => (await db.batch(statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? []))))).map((x) => (x.results ?? []) as Record<string, unknown>[]) };
  const path = new URL(request.url).pathname;

  if (path === '/kickback/next' && request.method === 'GET') return Response.json(await nextRequest(store, now), { headers: noStore });
  if (path === '/kickback/page' && request.method === 'POST') {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return new Response('Too large', { status: 413, headers: noStore });
    let reply: Reply;
    try {
      reply = (await request.json()) as Reply;
    } catch {
      return new Response('Not JSON', { status: 400, headers: noStore });
    }
    if (typeof reply?.url !== 'string' || typeof reply.status !== 'number') return new Response('Needs url and status', { status: 400, headers: noStore });
    const outcome = await accept(store, reply, now);
    // 409: not the page that was handed out (or it was already reported), so nothing was stored.
    return Response.json(outcome, { status: outcome.accepted ? 200 : 409, headers: noStore });
  }
  return new Response('Not found', { status: 404, headers: noStore });
}
