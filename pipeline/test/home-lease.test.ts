import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { dropHomeLease, LEASE_MS, takeHomeLease } from '../src/home-lease.ts';
import { connectStore } from '../src/store.ts';
import { memoryD1 } from './d1.ts';

function setUp() {
  const env = { DB: memoryD1(), STORE_TOKEN: 'token' };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  return connectStore('token', 'https://store.test/store', fetchFn);
}
const t0 = new Date('2026-11-06T12:00:00Z');
const after = (ms: number) => new Date(t0.getTime() + ms);

test('two equal agents: the first holds it, the second waits, and takes over when the first goes quiet', async () => {
  const store = setUp();
  assert.ok(await takeHomeLease(store, 'pc', false, t0));
  assert.ok(!(await takeHomeLease(store, 'other', false, after(30_000))));
  assert.ok(await takeHomeLease(store, 'pc', false, after(30_000)), 'the holder renews');
  assert.ok(await takeHomeLease(store, 'other', false, after(30_000 + LEASE_MS + 1)));
});

test('the preferred agent takes it from a running one, and the others defer while it is up', async () => {
  const store = setUp();
  assert.ok(await takeHomeLease(store, 'pc', false, t0));
  assert.ok(await takeHomeLease(store, 'mac', true, after(1_000)));
  assert.ok(!(await takeHomeLease(store, 'pc', false, after(31_000))));
  // The Mac goes quiet: the PC has it back after the lease runs out.
  assert.ok(!(await takeHomeLease(store, 'pc', false, after(1_000 + LEASE_MS - 1))));
  assert.ok(await takeHomeLease(store, 'pc', false, after(1_000 + LEASE_MS + 1)));
});

test('signing off hands it over at once', async () => {
  const store = setUp();
  assert.ok(await takeHomeLease(store, 'mac', true, t0));
  await dropHomeLease(store, 'mac');
  assert.ok(await takeHomeLease(store, 'pc', false, after(1_000)));
});
