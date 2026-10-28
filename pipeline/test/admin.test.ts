// The admin view (issue #39): the Worker's /admin and /admin.json read the store, behind ADMIN_TOKEN, and a bulletin's
// trace (written by build.ts) shows how it was made. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admin, adminData, FLASH_DAILY } from '../../worker/src/admin.ts';
import { KEEP_PROMPTS, traceWrites, type Trace } from '../src/store.ts';
import { memoryD1 } from './d1.ts';

const NOW = Date.parse('2026-10-28T12:10:00Z');
const trace = (over: Partial<Trace> = {}): Trace => ({
  writer: 'Gemini (gemini-flash-latest + gemini-flash-lite-latest)',
  meta: { mode: 'full', why: 'a new story in the top four', failed: [{ id: 'fans', error: 'busy' }] },
  calls: [
    { label: 'headlines', model: 'gemini-flash-latest', ok: false, ms: 900, error: 'HTTP 429' },
    { label: 'headlines', model: 'gemini-flash-lite-latest', ok: true, ms: 4200 },
    { label: 'debate', model: 'gemini-flash-latest', ok: true, ms: 8000 },
  ],
  prompts: { headlines: 'Write the top of the bulletin.', debate: 'Write the debate.' },
  script: [{ id: 'headlines', title: 'Headlines', lines: [{ speaker: 'isla', text: 'Good afternoon.', link: 'welcome' }] }],
  ...over,
});

function save(d1: ReturnType<typeof memoryD1>, id: string, at: Date, t = trace()) {
  d1.db.prepare(`INSERT INTO bulletins (id, generated_at, phase, runner, kind) VALUES (?, ?, 'normal', 'home', 'full')`).run(id, at.toISOString());
  for (const s of traceWrites(id, t, at)) d1.db.prepare(s.sql).run(...(s.params as (string | number | null)[]));
}

test('without the token the admin view is 401, and with it the page and the JSON both load', async () => {
  const d1 = memoryD1();
  const env = { DB: d1, ADMIN_TOKEN: 'secret' };
  const get = (path: string, headers: Record<string, string> = {}) => admin(new Request(`https://w.test${path}`, { headers }), env);

  assert.equal((await get('/admin')).status, 401);
  assert.equal((await get('/admin.json')).status, 401);
  assert.equal((await get('/admin.json', { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await get('/admin.json?token=wrong')).status, 401);
  assert.equal((await admin(new Request('https://w.test/admin'), { DB: d1 })).status, 503);

  assert.equal((await get('/admin.json', { authorization: 'Bearer secret' })).status, 200);
  // The token in the address sets a cookie and moves on to the clean address; the cookie is then enough.
  const signIn = await get('/admin?token=secret&bulletin=x');
  assert.equal(signIn.status, 303);
  assert.equal(signIn.headers.get('location'), '/admin?bulletin=x');
  assert.match(signIn.headers.get('set-cookie')!, /^admin=secret;.*HttpOnly.*Secure/);
  const page = await get('/admin', { cookie: 'admin=secret' });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Schedule and health/);
});

test('a bulletin\'s trace shows its pieces, fallbacks, cuts and script; today\'s Gemini requests are counted from the traces', async () => {
  const d1 = memoryD1();
  const at = new Date(NOW - 20 * 60_000);
  save(d1, at.toISOString(), at);
  d1.db.prepare(`INSERT INTO fact_checks (bulletin_id, checker, kind, action, segment, was, now, reason, at) VALUES (?, 'ledger', 'score', 'fixed', 'headlines', '2-0', '2-1', 'ledger', ?)`).run(at.toISOString(), at.toISOString());
  d1.db.prepare(`INSERT INTO airings (bulletin_id, story, in_depth, at) VALUES (?, 'Shankland injury', 1, ?)`).run(at.toISOString(), at.toISOString());

  const data = await adminData(d1, NOW, at.toISOString());
  assert.equal(data.schedule.lastBulletin?.ageMinutes, 20);
  assert.equal(data.bulletins[0].traced, true);
  assert.deepEqual(data.aiUsage.gemini.byModel['gemini-flash-latest'], { requests: 2, failed: 1 });
  assert.equal(data.aiUsage.gemini.flashDailyLimit, FLASH_DAILY);
  assert.ok(data.errors.some((e) => /HTTP 429/.test(e.message)));
  assert.ok(data.errors.some((e) => /fans: busy/.test(e.message)));

  const b = data.bulletin as Exclude<typeof data.bulletin, undefined | { error: string }>;
  assert.equal('error' in b, false);
  assert.deepEqual(b.pieces.find((p) => p.label === 'headlines')?.fellBack, true);
  assert.equal(b.pieces.find((p) => p.label === 'debate')?.fellBack, false);
  assert.deepEqual(b.airings, [{ story: 'Shankland injury', storyline: undefined, inDepth: true }]);
  assert.equal(b.cuts[0].now, '2-1');
  assert.equal(b.prompts?.debate, 'Write the debate.');
  assert.equal((b.script as { lines: { text: string }[] }[])[0].lines[0].text, 'Good afternoon.');
});

test('prompts are kept for the latest bulletins only; their other traces stay', async () => {
  const d1 = memoryD1();
  for (let i = 0; i <= KEEP_PROMPTS; i++) {
    const at = new Date(NOW - (KEEP_PROMPTS - i) * 30 * 60_000);
    save(d1, at.toISOString(), at);
  }
  const rows = d1.db.prepare('SELECT bulletin_id, prompts FROM bulletin_traces ORDER BY at').all() as { prompts: string | null }[];
  assert.equal(rows.length, KEEP_PROMPTS + 1);
  assert.equal(rows[0].prompts, null);
  assert.equal(rows.filter((r) => r.prompts).length, KEEP_PROMPTS);
});

test('an empty store still renders, and a bulletin without a trace says so', async () => {
  const d1 = memoryD1();
  d1.db.prepare(`INSERT INTO bulletins (id, generated_at, phase, runner) VALUES ('old', ?, 'normal', 'github')`).run(new Date(NOW).toISOString());
  const data = await adminData(d1, NOW, 'old');
  const res = await admin(new Request('https://w.test/admin?bulletin=old', { headers: { authorization: 'Bearer t' } }), { DB: d1, ADMIN_TOKEN: 't' });
  assert.match(await res.text(), /No trace for this bulletin/);
  assert.equal((data.bulletin as { traced: boolean }).traced, false);
  assert.match(await (await admin(new Request('https://w.test/admin?bulletin=nope', { headers: { authorization: 'Bearer t' } }), { DB: d1, ADMIN_TOKEN: 't' })).text(), /No bulletin nope/);
});

test('a source lists its items, and an item shows its text, summary and the claims built on it', async () => {
  const d1 = memoryD1();
  const seen = new Date(NOW).toISOString();
  d1.db.prepare(`INSERT INTO items (id, source, kind, title, url, first_seen, body, fetch_status, summary_json, sifted_at) VALUES ('a1', 'bbc', 'press', 'Shankland back', 'https://bbc.test/a1', ?, 'Full article text.', 'ok', '{"points":["He is back"]}', ?)`).run(seen, seen);
  d1.db.prepare(`INSERT INTO items (id, source, kind, title, first_seen) VALUES ('b1', 'other', 'press', 'Elsewhere', ?)`).run(seen);
  d1.db.prepare(`INSERT INTO storylines (id, title, opened_at, updated_at) VALUES (1, 'Shankland injury', ?, ?)`).run(seen, seen);
  d1.db.prepare(`INSERT INTO claims (id, storyline_id, text, first_seen) VALUES (1, 1, 'Shankland is fit', ?)`).run(seen);
  d1.db.prepare(`INSERT INTO claim_sources (claim_id, item_id) VALUES (1, 'a1')`).run();
  const env = { DB: d1, ADMIN_TOKEN: 't' };
  const get = async (path: string) => (await admin(new Request(`https://w.test${path}`, { headers: { authorization: 'Bearer t' } }), env)).text();

  const list = await get('/admin?source=bbc');
  assert.match(list, /Shankland back/);
  assert.doesNotMatch(list, /Elsewhere/);
  const item = JSON.parse(await get('/admin.json?item=a1'));
  assert.equal(item.text, 'Full article text.');
  assert.deepEqual(item.summary, { points: ['He is back'] });
  assert.equal(item.claims[0].text, 'Shankland is fit');
  const page = await get('/admin?item=a1');
  assert.match(page, /Full article text\./);
  assert.match(page, /Shankland injury/);
  assert.match(await get('/admin?item=nope'), /No item nope/);
  assert.match(await get('/admin'), /\/admin\?source=other/);
});
