// Story engine stage 2 (#25): articles read once into claims, filed under storylines, headlines as corroboration, and
// a brief per storyline that changed. The model is scripted; the store is the real migrations on an in-memory SQLite,
// like ingest.test.ts. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { seedEntities } from '../src/entities.ts';
import type { ScriptModel } from '../src/script/llm.ts';
import { connectStore, ingestItems, saveFetches } from '../src/store.ts';
import {
  BRIEF_SCHEMA,
  closingDue,
  CORROBORATE_SCHEMA,
  matchPhase,
  planSift,
  SIFT_SCHEMA,
  updateStorylines,
  type Storyline,
} from '../src/storylines.ts';
import { tagItems } from '../src/tags.ts';
import type { ClubConfig, Fixture, Item } from '../src/types.ts';
import { OutOfBudget, parseJson, QWEN3_30B, workersAi } from '../src/workers-ai.ts';
import { memoryD1 } from './d1.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const TRABZONSPOR: Fixture = { date: '2026-10-22T16:45:00.000Z', home: 'Trabzonspor', away: 'Heart of Midlothian', competition: 'UEFA Conference League', homeScore: 2, awayScore: 0, status: 'done' };
const HIBS: Fixture = { date: '2026-10-25T15:00:00.000Z', home: 'Heart of Midlothian', away: 'Hibernian', competition: 'Scottish Premiership' };
const match = { last: [TRABZONSPOR], next: [HIBS], table: [] };
const entities = seedEntities(club, match, [
  [
    { name: 'Harry Milne', role: 'player' },
    { name: 'Christian Borchgrevink', role: 'player' },
    { name: 'Wouter Vrancken', role: 'staff' },
  ],
]);
const names = new Map(club.sources.map((s) => [s.id, s.name]));

function setUp() {
  const d1 = memoryD1();
  const env = { DB: d1, STORE_TOKEN: 't' };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  return { d1, store: connectStore('t', 'https://store.test/store', fetchFn) };
}
const rows = (s: { d1: ReturnType<typeof memoryD1> }, sql: string) => s.d1.db.prepare(sql).all().map((r) => ({ ...r }));

const item = (id: string, sourceId: string, title: string, extra: Partial<Item> = {}): Item => ({
  id,
  sourceId,
  sourceName: sourceId,
  kind: 'press',
  title,
  summary: '',
  url: `https://example.com/${id}`,
  publishedAt: '2026-10-22T18:00:00.000Z',
  ...extra,
});
const TEXT = 'Hearts defender Harry Milne faces months out after the full-back suffered an ACL injury. '.repeat(5);

/** Stores the items, with text for the articles, as the ingest would. */
async function ingest(s: ReturnType<typeof setUp>, items: Item[], now: Date) {
  await ingestItems(s.store, items, entities, tagItems(items, entities), now);
  await saveFetches(s.store, items.filter((i) => i.kind === 'press' || i.kind === 'official').map((i) => ({ id: i.id, text: TEXT })), now);
}

/** A model that answers each kind of request from its own script, and remembers the prompts. */
function scripted(replies: { sift?: object[]; corroborate?: object[]; brief?: object[] }): ScriptModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    name: 'scripted',
    prompts,
    async generateJson(prompt, schema) {
      prompts.push(prompt);
      const list = schema === SIFT_SCHEMA ? replies.sift : schema === CORROBORATE_SCHEMA ? replies.corroborate : schema === BRIEF_SCHEMA ? replies.brief : undefined;
      const next = list?.shift();
      if (!next) throw new Error('no scripted reply');
      return next;
    },
  };
}

const run = (s: ReturnType<typeof setUp>, model: ScriptModel | undefined, now: Date, lines: string[] = []) =>
  updateStorylines({ store: s.store, model, entities, match, names, club: club.name, now, log: (l) => lines.push(l) });

test('the Milne news from several outlets is one storyline, its claims sourced to each, with a brief', async () => {
  const s = setUp();
  const t1 = new Date('2026-10-23T09:00:00Z');
  await ingest(
    s,
    [
      item('en', 'evening-news', 'Hearts defender Harry Milne out for months as injury strikes again', { publishedAt: '2026-10-22T16:46:00.000Z' }),
      item('dr', 'daily-record', 'Wouter Vrancken reveals Hearts dressing room message after double injury blow', { publishedAt: '2026-10-22T20:13:00.000Z' }),
      item('report', 'official', 'Match Report: Trabzonspor 2-0 Hearts', { kind: 'official', publishedAt: '2026-10-22T20:03:00.000Z' }),
      item('dr2', 'daily-record', 'Hearts injury tracker and return dates', { publishedAt: '2026-10-23T08:00:00.000Z' }),
      item('dr3', 'daily-record', 'Borchgrevink hamstring latest', { publishedAt: '2026-10-23T08:30:00.000Z' }),
      item('bbc1', 'google-news', "Hearts' Harry Milne's ACL woe - Scottish gossip", { kind: 'aggregator', publisher: 'BBC' }),
      item('bbc2', 'google-news', "Hearts' Harry Milne's ACL woe - Scottish gossip", { kind: 'aggregator', publisher: 'BBC' }),
      item('other', 'google-news', 'Celtic fans enjoy open day', { kind: 'aggregator', publisher: 'Sky' }),
    ],
    t1,
  );

  // Articles come oldest first: a1 Evening News, a2 the match report, a3 Daily Record, a4 the tracker, a5 Borchgrevink.
  const model = scripted({
    sift: [
      {
        storylines: [
          { ref: 'n1', kind: 'person', title: 'Milne injury', entity: 'harry-milne', category: 'injury' },
          { ref: 'n2', kind: 'match', title: 'Trabzonspor 2-0 Hearts', fixture: 'f1' },
          // The same person and topic twice: folded into one.
          { ref: 'n3', kind: 'person', title: 'Milne knee', entity: 'harry-milne', category: 'injury' },
          { ref: 'n4', kind: 'person', title: 'Nobody', entity: 'not-a-player', category: 'injury' },
        ],
        claims: [
          { text: 'Milne: ACL injury, out for months', storyline: 'n1', sources: ['a1', 'a3', 'a4'], relation: 'new' },
          { text: 'Trabzonspor 2-0 Hearts in the Conference League', storyline: 'n2', sources: ['a2', 'a9'], relation: 'new' },
          { text: 'Milne: surgery expected', storyline: 'n3', sources: ['a4'], relation: 'new' },
          { text: 'Borchgrevink: hamstring', storyline: 'n5', sources: ['a5'], relation: 'new' },
          { text: 'No source', storyline: 'n1', sources: [], relation: 'new' },
        ],
      },
    ],
    corroborate: [{ matches: [{ headline: 'h1', claims: ['c1'] }] }],
    brief: [
      {
        briefs: [
          { storyline: 's1', title: 'Milne injury', known: 'Harry Milne faces months out with an ACL injury.', disputed: '', latest: 'Surgery is expected.' },
          { storyline: 's2', title: 'Trabzonspor 2-0 Hearts', known: 'Hearts lost 2-0 in Trabzon.', disputed: '', latest: '' },
        ],
      },
    ],
  });
  await run(s, model, t1);

  assert.deepEqual(rows(s, 'SELECT id, kind, entity_id, category, title, fixture, status, opened_at FROM storylines ORDER BY id'), [
    { id: 1, kind: 'person', entity_id: 'harry-milne', category: 'injury', title: 'Milne injury', fixture: null, status: 'open', opened_at: '2026-10-22T16:46:00.000Z' },
    { id: 2, kind: 'match', entity_id: null, category: 'match', title: 'Trabzonspor 2-0 Hearts', fixture: '2026-10-22|Trabzonspor|Heart of Midlothian', status: 'open', opened_at: '2026-10-22T20:03:00.000Z' },
  ]);
  assert.deepEqual(rows(s, 'SELECT id, storyline_id, text, status, first_seen FROM claims ORDER BY id'), [
    { id: 1, storyline_id: 1, text: 'Milne: ACL injury, out for months', status: 'reported', first_seen: '2026-10-22T16:46:00.000Z' },
    { id: 2, storyline_id: 2, text: 'Trabzonspor 2-0 Hearts in the Conference League', status: 'reported', first_seen: '2026-10-22T20:03:00.000Z' },
    { id: 3, storyline_id: 1, text: 'Milne: surgery expected', status: 'reported', first_seen: '2026-10-23T08:00:00.000Z' },
  ]);
  // Sourced to each outlet that reported it, and to both copies of the BBC headline as corroboration.
  assert.deepEqual(rows(s, 'SELECT item_id, corroboration FROM claim_sources WHERE claim_id = 1 ORDER BY item_id'), [
    { item_id: 'bbc1', corroboration: 1 },
    { item_id: 'bbc2', corroboration: 1 },
    { item_id: 'dr', corroboration: 0 },
    { item_id: 'dr2', corroboration: 0 },
    { item_id: 'en', corroboration: 0 },
  ]);
  // Everything is read once, even what gave nothing (the Borchgrevink claim pointed at no storyline; Sky's headline
  // names nobody we know, so it isn't sent).
  assert.deepEqual(rows(s, 'SELECT COUNT(*) AS n FROM items WHERE sifted_at IS NULL'), [{ n: 0 }]);
  assert.equal(model.prompts.filter((p) => p.includes('Celtic fans')).length, 0);
  assert.deepEqual(JSON.parse(String(rows(s, 'SELECT brief FROM storylines WHERE id = 1')[0].brief)), {
    known: 'Harry Milne faces months out with an ACL injury.',
    disputed: '',
    latest: 'Surgery is expected.',
  });

  // The next run has nothing waiting: no requests at all.
  const before = model.prompts.length;
  await run(s, model, new Date('2026-10-23T09:30:00Z'));
  assert.equal(model.prompts.length, before);
});

async function milneStoryline(s: ReturnType<typeof setUp>) {
  const t = new Date('2026-10-23T09:00:00Z');
  await ingest(s, Array.from({ length: 5 }, (_, i) => item(`a${i}`, 'evening-news', `Milne injury ${i}`)), t);
  await run(
    s,
    scripted({
      sift: [
        {
          storylines: [{ ref: 'n1', kind: 'person', title: 'Milne injury', entity: 'harry-milne', category: 'injury' }],
          claims: [{ text: 'Milne: hamstring, out ~6 weeks', storyline: 'n1', sources: ['a1', 'a2'], relation: 'new' }],
        },
      ],
      brief: [{ briefs: [{ storyline: 's1', title: 'Milne injury', known: 'Out for six weeks.', disputed: '', latest: '' }] }],
    }),
    t,
  );
}

test('a later claim disputes, replaces or confirms an earlier one, and one can resolve the storyline', async () => {
  const s = setUp();
  await milneStoryline(s);

  const t2 = new Date('2026-10-24T09:00:00Z');
  await ingest(
    s,
    [item('rec', 'daily-record', 'Milne out for months', { publishedAt: '2026-10-24T08:00:00.000Z' }), item('club', 'official', 'Milne update', { kind: 'official', publishedAt: '2026-10-24T08:30:00.000Z' })],
    t2,
  );
  const model = scripted({
    sift: [
      {
        storylines: [],
        claims: [
          { text: 'Milne: out for months', storyline: 's1', sources: ['a1'], relation: 'disputes', target: 'c1' },
          { text: 'Milne: out for months, the club says', storyline: 's1', sources: ['a2'], relation: 'same', target: 'c1' },
        ],
      },
    ],
    brief: [{ briefs: [{ storyline: 's1', title: 'Milne injury', known: 'How long is disputed.', disputed: 'Evening News says six weeks; Daily Record says months.', latest: '' }] }],
  });
  const lines: string[] = [];
  await run(s, model, new Date('2026-10-24T10:00:00Z'), lines); // two articles, but the oldest has waited an hour
  assert.deepEqual(rows(s, 'SELECT id, status, disputes FROM claims ORDER BY id'), [
    { id: 1, status: 'disputed', disputes: null },
    { id: 2, status: 'disputed', disputes: 1 },
  ]);
  // The brief prompt marks what's new since the last brief and who said it.
  const briefPrompt = model.prompts.at(-1)!;
  assert.match(briefPrompt, /c2 24 Oct \(disputed, disputes c1, NEW; Daily Record\) Milne: out for months/);
  assert.match(briefPrompt, /Previous brief .*Out for six weeks\./);

  // Back in training: replaces the injury claim and closes the storyline.
  const t3 = new Date('2026-11-15T09:00:00Z');
  await ingest(s, [item('back', 'official', 'Milne back in training', { kind: 'official', publishedAt: '2026-11-15T08:00:00.000Z' })], t3);
  await run(
    s,
    scripted({
      sift: [{ storylines: [], claims: [{ text: 'Milne: back in training', storyline: 's1', sources: ['a1'], relation: 'replaces', target: 'c2', resolves: true }] }],
      brief: [{ briefs: [{ storyline: 's1', title: 'Milne injury', known: 'Milne is back in training.', disputed: '', latest: 'Back in training.' }] }],
    }),
    new Date('2026-11-15T10:00:00Z'),
  );
  assert.deepEqual(rows(s, 'SELECT id, status, replaced_by FROM claims ORDER BY id'), [
    { id: 1, status: 'disputed', replaced_by: null },
    { id: 2, status: 'replaced', replaced_by: 3 },
    { id: 3, status: 'reported', replaced_by: null },
  ]);
  assert.deepEqual(rows(s, "SELECT status, close_reason, json_extract(brief, '$.known') AS known FROM storylines"), [
    { status: 'closed', close_reason: 'resolved', known: 'Milne is back in training.' },
  ]);

  // A new injury later opens a new storyline: the closed one is history ("his second injury this season").
  const t4 = new Date('2026-12-20T09:00:00Z');
  await ingest(s, Array.from({ length: 5 }, (_, i) => item(`b${i}`, 'evening-news', `Milne injured again ${i}`, { publishedAt: '2026-12-20T08:00:00.000Z' })), t4);
  const again = scripted({
    sift: [{ storylines: [{ ref: 'n1', kind: 'person', title: 'Milne injury', entity: 'harry-milne', category: 'injury' }], claims: [{ text: 'Milne: ankle', storyline: 'n1', sources: ['a1'], relation: 'new' }] }],
    brief: [{ briefs: [] }],
  });
  await run(s, again, t4);
  assert.doesNotMatch(again.prompts[0], /c3 /); // closed storylines aren't offered
  assert.deepEqual(rows(s, "SELECT id, status FROM storylines WHERE entity_id = 'harry-milne' AND category = 'injury' ORDER BY id"), [
    { id: 1, status: 'closed' },
    { id: 2, status: 'open' },
  ]);
});

test('reading waits for five articles or an hour, and does nothing without a model', async () => {
  const s = setUp();
  const t = new Date('2026-10-23T09:00:00Z');
  await ingest(s, [item('a', 'evening-news', 'Milne ruled out'), item('b', 'daily-record', 'Milne blow')], t);
  const model = scripted({});
  const lines: string[] = [];
  await run(s, model, new Date('2026-10-23T09:20:00Z'), lines);
  assert.equal(model.prompts.length, 0);
  assert.match(lines.join('\n'), /2 articles waiting/);
  await run(s, undefined, new Date('2026-10-23T11:00:00Z'), lines);
  assert.match(lines.at(-1)!, /No Cloudflare token/);
  // A failed request leaves its articles for the next run.
  await run(s, model, new Date('2026-10-23T11:00:00Z'), lines);
  assert.equal(model.prompts.length, 1);
  assert.deepEqual(rows(s, 'SELECT COUNT(*) AS n FROM items WHERE sifted_at IS NULL'), [{ n: 2 }]);
});

const storyline = (id: number, extra: Partial<Storyline>): Storyline => ({
  id,
  kind: 'person',
  title: 't',
  status: 'open',
  openedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  claims: [],
  ...extra,
});

test('storylines close when quiet (injuries after 28 days), and a match three days after the next one', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const open = [
    storyline(1, { category: 'injury', updatedAt: '2026-10-05T00:00:00.000Z' }), // 24 days: stays
    storyline(2, { category: 'contract', updatedAt: '2026-10-14T00:00:00.000Z' }), // 15 days: closes
    storyline(3, { kind: 'match', kickOff: TRABZONSPOR.date }), // next match 25 Oct, 4 days ago: closes
    storyline(4, { kind: 'match', kickOff: '2026-10-25T15:00:00.000Z' }), // no match since: stays
  ];
  const played = [TRABZONSPOR, { ...HIBS, homeScore: 1, awayScore: 1 }];
  assert.deepEqual(closingDue(open, played, now), [
    { id: 2, reason: 'quiet' },
    { id: 3, reason: 'next_match' },
  ]);
  assert.deepEqual(closingDue(open, played, new Date('2026-10-27T12:00:00Z')).map((c) => c.id), []);
  assert.equal(matchPhase(TRABZONSPOR.date, new Date('2026-10-22T12:00:00Z')), 'preview');
  assert.equal(matchPhase(TRABZONSPOR.date, new Date('2026-10-22T21:00:00Z')), 'result');
  assert.equal(matchPhase(TRABZONSPOR.date, new Date('2026-10-24T09:00:00Z')), 'fallout');
});

test('Workers AI counts neurons, drops to the light model late in the day, and stops before the limit', async () => {
  const asked: string[] = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    asked.push(body.model);
    return Response.json({ choices: [{ message: { content: 'Sure: ```json\n{"ok": true}\n```' } }], usage: { prompt_tokens: 100_000, completion_tokens: 10_000 } });
  }) as typeof fetch;
  const model = workersAi({ accountId: 'x', token: 'y', budget: { used: 0, lightAt: 4_000, stopAt: 6_000 }, fetchFn });
  assert.deepEqual(await model.generateJson('p', {}), { ok: true });
  assert.equal(Math.round(model.neurons), 3_864); // 100k in at 31,818/M + 10k out at 68,182/M
  await model.generateJson('p', {});
  assert.deepEqual(asked, ['@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-120b']);
  await assert.rejects(model.generateJson('p', {}), OutOfBudget);

  const late = workersAi({ accountId: 'x', token: 'y', budget: { used: 4_500, lightAt: 4_000, stopAt: 6_000 }, fetchFn });
  await late.generateJson('p', {});
  assert.equal(asked.at(-1), QWEN3_30B.id);
  assert.throws(() => parseJson('no json here'));
});

test('refs come back in any form, a missing category comes from the title, and match details stay with the match', () => {
  const articles = [{ id: 'x', source: 'bbc', kind: 'press' as const, title: 't', publishedAt: '2026-10-23T08:00:00.000Z', text: 'x' }];
  const fixtures = [{ ref: 'f1', f: TRABZONSPOR }];
  const people = entities.filter((e) => e.type === 'player' || e.type === 'staff');
  const plan = planSift(
    {
      storylines: [
        { ref: 'N1', kind: 'person', title: 'Harry Milne injury', entity: 'Harry Milne' },
        { ref: 'n2', kind: 'person', title: 'Milne substitution', entity: 'harry-milne' },
        { ref: 'n3', kind: 'match', title: 'Trabzonspor v Hearts', fixture: '1' },
      ],
      claims: [
        { text: 'Milne: ACL', storyline: 'n1', sources: ['1'], relation: 'new' },
        { text: 'Milne: replaced at half-time', storyline: 'n2', sources: ['A1'], relation: 'new' },
        { text: 'Trabzonspor 2-0 Hearts', storyline: 'N3', sources: [1 as unknown as string], relation: 'new' },
      ],
    },
    articles,
    [],
    fixtures,
    people,
    { storyline: 1, claim: 1 },
    new Date('2026-10-23T09:00:00Z'),
  );
  assert.deepEqual(
    plan.storylines.map((s) => [s.kind, s.entity, s.category, s.fixture]),
    [
      ['person', 'harry-milne', 'injury', undefined],
      ['club', 'harry-milne', undefined, undefined], // no topic: not a person storyline
      ['match', undefined, 'match', '2026-10-22|Trabzonspor|Heart of Midlothian'],
    ],
  );
  assert.equal(plan.claims.length, 3);
  assert.equal(plan.dropped, 0);
});
