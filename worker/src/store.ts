// POST /store: runs a batch of SQL statements against the channel's D1 database in one transaction (D1's batch()
// is atomic), for the bulletin builds on the home PC and GitHub. Behind a bearer token, STORE_TOKEN, a Worker secret.
// The pipeline keeps every query in pipeline/src/store.ts; this only runs them.
// Request: { statements: [{ sql, params? }] }. Response: { results: rows[] per statement }.

// Just the parts of Cloudflare's D1 types used here (the tests pass a node:sqlite stand-in).
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<{ results?: unknown[] }[]>;
}

export interface StoreEnv {
  DB?: D1Database;
  STORE_TOKEN?: string;
}

interface Statement {
  sql: string;
  params?: unknown[];
}

/** Compares in time that doesn't depend on where the strings differ. */
function sameToken(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function store(request: Request, env: StoreEnv): Promise<Response> {
  if (!env.DB || !env.STORE_TOKEN) return json({ error: 'Store not configured' }, 503);
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = request.headers.get('authorization') ?? '';
  if (!sameToken(auth, `Bearer ${env.STORE_TOKEN}`)) return json({ error: 'Unauthorised' }, 401);

  let statements: Statement[];
  try {
    statements = ((await request.json()) as { statements: Statement[] }).statements;
    if (!Array.isArray(statements) || !statements.length || statements.some((s) => typeof s?.sql !== 'string')) throw new Error();
  } catch {
    return json({ error: 'Expected { statements: [{ sql, params? }] }' }, 400);
  }

  const db = env.DB;
  try {
    const results = await db.batch(statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? []))));
    return json({ results: results.map((r) => r.results ?? []) });
  } catch (err) {
    // The whole batch rolled back.
    return json({ error: (err as Error).message }, 400);
  }
}
