// The squad list (issue: ex-players like Shankland and Devlin were opening injury stories): the entities table is the source of
// truth, filled from the club's pages once and checked against them only in a transfer window. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admin, rosterData } from '../../worker/src/admin.ts';
import type { Person } from '../src/entities.ts';
import { inTransferWindow, loadRoster, squadFor, squadSyncDue, syncSquad } from '../src/squad.ts';
import { entityWrites, type Store } from '../src/store.ts';
import { memoryD1 } from './d1.ts';

const d1store = (d1: ReturnType<typeof memoryD1>): Store => ({
  batch: async (statements) => (await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...(s.params ?? []))))).map((r) => (r.results ?? []) as Record<string, unknown>[]),
});
const page = (...names: string[]): Person[] => [...Array.from({ length: 16 }, (_, i) => ({ name: `Player Number${String.fromCharCode(65 + i)}`, role: 'player' as const })), ...names.map((name) => ({ name, role: 'player' as const }))];
const NOW = new Date('2026-10-28T12:00:00Z');
const names = async (d1: ReturnType<typeof memoryD1>) => (await rosterData(d1)).people.filter((p) => p.active).map((p) => p.name);

test('transfer windows: June to the start of September, and January', () => {
  assert.deepEqual(
    ['2026-01-15', '2026-03-01', '2026-06-01', '2026-08-31', '2026-09-01', '2026-09-02', '2026-10-28'].map((d) => inTransferWindow(new Date(`${d}T12:00:00Z`))),
    [true, false, true, true, true, false, false],
  );
});

test('the first sync fills the squad; later runs outside a window leave it alone', async () => {
  const d1 = memoryD1();
  const store = d1store(d1);
  assert.equal(await squadSyncDue(store, NOW), true);
  const first = await syncSquad(store, NOW, page('Jamie Mccart'));
  assert.equal(first.added.length, 17);
  assert.equal((await loadRoster(store)).length, 17);
  assert.equal(await squadSyncDue(store, NOW), false);
  // Outside a window nothing asks the club's site again, however stale the list.
  assert.equal(await squadSyncDue(store, new Date('2026-12-01T12:00:00Z')), false);
  assert.equal((await squadFor(store, NOW)).length, 17);
});

test('in a window it is due once a day', async () => {
  const d1 = memoryD1();
  const store = d1store(d1);
  await syncSquad(store, new Date('2026-07-10T09:00:00Z'), page());
  assert.equal(await squadSyncDue(store, new Date('2026-07-10T20:00:00Z')), false);
  assert.equal(await squadSyncDue(store, new Date('2026-07-11T09:00:00Z')), true);
});

test('a sync adds signings and retires people the page drops, but never undoes the admin', async () => {
  const d1 = memoryD1();
  const store = d1store(d1);
  const env = { DB: d1, ADMIN_TOKEN: 'secret' };
  const post = (fields: Record<string, string>) => admin(new Request('https://w.test/admin/roster', { method: 'POST', body: new URLSearchParams(fields), headers: { cookie: 'admin=secret' } }), env);

  // Shankland is left over from before: an active person row the club's page doesn't list.
  for (const s of entityWrites([])) d1.db.prepare(s.sql).run(...(s.params as (string | number | null)[]));
  d1.db.prepare(`INSERT INTO entities (id, type, name, aliases, active) VALUES ('lawrence-shankland', 'player', 'Lawrence Shankland', '[]', 1)`).run();
  await syncSquad(store, NOW, page('Jamie Mccart', 'Old Boy'));
  assert.ok(!(await names(d1)).includes('Lawrence Shankland'));

  // The admin fixes a spelling, adds a signing, and switches someone off.
  assert.equal((await post({ action: 'save', id: 'jamie-mccart', name: 'Jamie McCart', type: 'player', aliases: 'Mac, ' })).status, 303);
  assert.equal((await post({ action: 'add', name: 'New  Signing', type: 'player' })).status, 303);
  await post({ action: 'active', id: 'old-boy', active: '0' });
  const by = async (id: string) => (await rosterData(d1)).people.find((p) => p.id === id);
  assert.deepEqual([(await by('jamie-mccart'))?.aliases, (await by('new-signing'))?.added], [['Mac'], true]);

  // The next window check: the page still says "Mccart" and lists Old Boy, but not the new signing.
  const later = await syncSquad(store, new Date('2027-01-05T09:00:00Z'), page('Jamie Mccart', 'Old Boy', 'Real Newcomer'));
  assert.deepEqual([later.added, later.retired], [['Real Newcomer'], []]);
  const now = await names(d1);
  assert.ok(now.includes('Jamie McCart') && !now.includes('Jamie Mccart'), 'the admin spelling stays, with no duplicate');
  assert.ok(now.includes('New Signing') && now.includes('Real Newcomer'));
  assert.ok(!now.includes('Old Boy'), 'switched off by the admin, so a sync leaves them off');
  // The roster the pipeline reads carries the admin's spelling and aliases under the old id.
  const read = await loadRoster(store);
  assert.deepEqual(read.find((p) => p.id === 'jamie-mccart'), { id: 'jamie-mccart', role: 'player', name: 'Jamie McCart', aliases: ['Mac'] });

  // A page that drops most of the squad is a layout change, not a clear-out.
  await assert.rejects(syncSquad(store, NOW, page().slice(0, 3)), /layout has probably changed/);
  assert.ok((await names(d1)).includes('New Signing'));
});

test('a build or ingest never changes anyone already in the squad list', async () => {
  const d1 = memoryD1();
  await syncSquad(d1store(d1), NOW, page());
  const before = await names(d1);
  for (const s of entityWrites([{ id: 'hearts', type: 'club', name: 'Hearts', aliases: [] }, { id: 'player-numbera', type: 'staff', name: 'Renamed By The Page', aliases: ['x'] }])) d1.db.prepare(s.sql).run(...(s.params as (string | number | null)[]));
  assert.deepEqual(await names(d1), before);
});
