// The channel's clock and job queue (issue #29): the Worker's clock (worker/src/clock.ts) run once a minute over the
// recording of Trabzonspor v Hearts (22 Oct 2026; kick-off 16:47, half-time 17:37, second half 17:52, full time
// 18:43), with the runners' claims (pipeline/src/store.ts) through the /store endpoint, on an in-memory D1.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { BbcData, BbcEvent } from '../../shared/bbc.ts';
import { type LiveFeed, liveMatch } from '../../shared/live.ts';
import { type Dispatch, tick } from '../../worker/src/clock.ts';
import { store as endpoint } from '../../worker/src/store.ts';
import { checkIn, claimJob, connectStore, dropLock, finishJob, jobsLike, releaseJobs, signOff, storeAsD1, takeLock } from '../src/store.ts';
import { memoryD1 } from './d1.ts';

const rec = JSON.parse(readFileSync(new URL('../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json', import.meta.url), 'utf8')) as {
  teamEvent: BbcEvent;
  snapshots: { at: string; page: BbcData }[];
};
const feedAt = (t: number): LiveFeed => {
  const snap = rec.snapshots.filter((s) => Date.parse(s.at) <= t).pop() ?? rec.snapshots[0];
  return { updated: new Date(t).toISOString(), match: liveMatch(rec.teamEvent, 'heart-of-midlothian', snap.page) };
};
const at = (hm: string) => Date.parse(`2026-10-22T${hm}:00Z`);
const KICK_OFF = feedAt(at('16:30')).match!.kickOff;

function setUp() {
  const d1 = memoryD1();
  const env = { DB: d1, STORE_TOKEN: 'token' };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  return { d1, store: connectStore('token', 'https://store.test/store', fetchFn) };
}

const jobRows = (d1: ReturnType<typeof memoryD1>) =>
  d1.db.prepare('SELECT id, status, runner, dispatches FROM jobs ORDER BY queued_at, id').all() as { id: string; status: string; runner: string | null; dispatches: number }[];

const BREAKING = [
  'period:ko1',
  'goal:home:Mohamed Salah:1',
  'period:ht',
  'period:ko2',
  'goal:home:Franculino Djú:1',
  'red:home:Sidny Cabral:1',
  'period:ft',
].map((k) => `breaking:${KICK_OFF}:${k}`);
const PROGRAMMES = [`programme:2026-10-22T16:30:00.000Z`, `programme:ht:${KICK_OFF}`, `programme:ft:${KICK_OFF}`, `programme:2026-10-22T19:00:00.000Z`];

test('with the home PC off, GitHub is sent every job as soon as it is queued, once', async () => {
  const { d1, store } = setUp();
  const sent: string[] = [];
  // GitHub claims what it's sent and builds it at once.
  const dispatch: Dispatch = async ({ id }) => {
    sent.push(id);
    assert.ok(await claimJob(store, id, 'github', new Date()));
    await finishJob(store, id, 'done', new Date());
  };
  for (let t = at('16:30'); t <= at('19:10'); t += 60_000) await tick(d1, feedAt(t), { dispatch, now: t });

  const jobs = jobRows(d1);
  assert.deepEqual(new Set(jobs.map((j) => j.id)), new Set([...BREAKING, ...PROGRAMMES]));
  assert.deepEqual(sent.length, jobs.length);
  assert.ok(jobs.every((j) => j.status === 'done' && j.runner === 'github' && j.dispatches === 1));
  // The breaking news comes in match order.
  assert.deepEqual(sent.filter((id) => id.startsWith('breaking:')), BREAKING);
});

test('with the home PC on, it takes the jobs and GitHub is never asked', async () => {
  const { d1, store } = setUp();
  const sent: string[] = [];
  const dispatch: Dispatch = async ({ id }) => void sent.push(id);
  await checkIn(store, [], new Date(at('16:29')));
  for (let t = at('16:30'); t <= at('19:10'); t += 60_000) {
    await tick(d1, feedAt(t), { dispatch, now: t });
    // The PC checks in twice a minute and finishes each job before the next check-in.
    for (const half of [0, 30_000]) {
      for (const job of await checkIn(store, ['breaking', 'programme'], new Date(t + half))) await finishJob(store, job.id, 'done', new Date(t + half));
    }
  }
  assert.deepEqual(sent, []);
  const jobs = jobRows(d1);
  assert.equal(jobs.length, BREAKING.length + PROGRAMMES.length);
  assert.ok(jobs.every((j) => j.status === 'done' && j.runner === 'home'));
});

/** The clock every minute from `from` to `to`, with the home PC checking in (claiming nothing) before each run. */
async function homeBusy(d1: ReturnType<typeof memoryD1>, store: ReturnType<typeof setUp>['store'], from: number, to: number, dispatch: Dispatch) {
  for (let t = from; t <= to; t += 60_000) {
    await checkIn(store, [], new Date(t - 10_000));
    await tick(d1, feedAt(t), { dispatch, now: t });
  }
}

const SALAH = `breaking:${KICK_OFF}:goal:home:Mohamed Salah:1`;

test('a job the home PC does not claim in time goes to GitHub, and only one runner gets it', async () => {
  const { d1, store } = setUp();
  const sent: string[] = [];
  const dispatch: Dispatch = async ({ id }) => void sent.push(id);
  // Salah's goal is described at 17:19:20, so queued at 17:20. The PC is on, but busy.
  await homeBusy(d1, store, at('17:00'), at('17:20'), dispatch);
  assert.ok(jobRows(d1).some((j) => j.id === SALAH));
  assert.ok(!sent.includes(SALAH), 'waits for the PC');
  await homeBusy(d1, store, at('17:21'), at('17:21'), dispatch);
  assert.ok(sent.includes(SALAH), 'a minute later, GitHub is asked');
  // The PC frees up and claims it before GitHub's run starts: GitHub's claim finds it gone.
  const [mine] = await checkIn(store, ['breaking'], new Date(at('17:21') + 10_000));
  assert.equal(mine.id, SALAH);
  assert.equal(await claimJob(store, SALAH, 'github', new Date(at('17:21') + 30_000)), undefined);
});

test('a job whose runner goes quiet is queued again, and the PC can hand jobs back when it stops', async () => {
  const { d1, store } = setUp();
  const sent: string[] = [];
  const dispatch: Dispatch = async ({ id }) => void sent.push(id);
  await homeBusy(d1, store, at('17:00'), at('17:20'), dispatch);
  const [job] = await checkIn(store, ['breaking'], new Date(at('17:20') + 20_000));
  assert.equal(job.id, SALAH);
  // The PC is switched off mid-build: ten minutes on, the clock queues it again and sends it to GitHub.
  for (let t = at('17:21'); t <= at('17:31'); t += 60_000) await tick(d1, feedAt(t), { dispatch, now: t });
  assert.ok(sent.includes(SALAH));
  assert.ok(await claimJob(store, SALAH, 'github', new Date(at('17:31'))));

  // Stopping the agent cleanly: it signs off and hands its jobs straight back.
  sent.length = 0;
  await homeBusy(d1, store, at('17:32'), at('17:40'), dispatch); // half-time: a package and a programme
  const claimed = await checkIn(store, ['breaking', 'programme'], new Date(at('17:40') + 10_000));
  assert.deepEqual(claimed.map((j) => j.kind).sort(), ['breaking', 'programme']);
  await signOff(store);
  await releaseJobs(store, claimed.map((j) => j.id));
  await tick(d1, feedAt(at('17:41')), { dispatch, now: at('17:41') });
  assert.deepEqual(new Set(sent), new Set(claimed.map((j) => j.id)));
});

test('a newer programme replaces one nobody took, and old breaking news is dropped', async () => {
  const { d1 } = setUp();
  const dispatch: Dispatch = async () => undefined; // GitHub never starts
  for (let t = at('16:30'); t <= at('17:30'); t += 60_000) await tick(d1, feedAt(t), { dispatch, now: t });
  const jobs = jobRows(d1);
  assert.equal(jobs.find((j) => j.id === PROGRAMMES[0])?.status, 'queued');
  assert.equal(jobs.find((j) => j.id === BREAKING[0])?.status, 'dropped'); // kick-off, 16:47
  // Asked again after ten minutes, at most three times.
  assert.equal(jobs.find((j) => j.id === PROGRAMMES[0])?.dispatches, 3);
  for (let t = at('17:31'); t <= at('17:40'); t += 60_000) await tick(d1, feedAt(t), { dispatch, now: t });
  assert.equal(jobRows(d1).find((j) => j.id === PROGRAMMES[0])?.status, 'dropped');
});

test('a replay queues test jobs, for GitHub only, through the store', async () => {
  const { d1, store } = setUp();
  const sent: string[] = [];
  const dispatch: Dispatch = async ({ id }) => void sent.push(id);
  await checkIn(store, [], new Date(at('17:19'))); // the PC is on, but test jobs aren't for it
  const db = storeAsD1(store);
  for (let t = at('17:15'); t <= at('17:25'); t += 60_000) await tick(db, feedAt(t), { dispatch, now: at('17:19'), test: 'run1' });
  assert.deepEqual(sent, [`test:run1:breaking:${KICK_OFF}:goal:home:Mohamed Salah:1`]);
  // The Worker's own clock leaves them to the replay.
  const workerSent: string[] = [];
  await tick(db, undefined, { dispatch: async ({ id }) => void workerSent.push(id), now: at('17:21') });
  assert.deepEqual(workerSent.filter((id) => id.startsWith('test:')), []);
  // (That run queued a programme of its own, which is the PC's to take; the test job isn't.)
  assert.deepEqual(await checkIn(store, ['breaking'], new Date(at('17:20'))), []);
  const job = await claimJob(store, sent[0], 'github', new Date(at('17:20')));
  assert.equal(job?.test, true);
  assert.equal(job?.payload.templates, true);
  assert.equal((await jobsLike(store, 'test:run1:')).length, 1);
});

test('publishing takes turns', async () => {
  const { store } = setUp();
  const t = new Date(at('17:00'));
  assert.ok(await takeLock(store, 'publish', 'home:a', 60_000, t));
  assert.ok(!(await takeLock(store, 'publish', 'github:b', 60_000, t)));
  // Held too long (its runner died): it runs out.
  assert.ok(await takeLock(store, 'publish', 'github:b', 60_000, new Date(t.getTime() + 61_000)));
  await dropLock(store, 'publish', 'home:a'); // not a's to drop any more
  assert.ok(!(await takeLock(store, 'publish', 'home:c', 60_000, new Date(t.getTime() + 62_000))));
  await dropLock(store, 'publish', 'github:b');
  assert.ok(await takeLock(store, 'publish', 'home:c', 60_000, new Date(t.getTime() + 62_000)));
});
