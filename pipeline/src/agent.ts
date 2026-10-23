// The home PC's part in running the channel (issue #29). The Worker's clock queues the programmes and breaking news;
// while this runs, it checks in every 30 seconds and claims them, voicing them on the GPU. When it's off, GitHub
// builds them instead, on the CPU. One programme and one breaking package at a time, side by side: publishing takes
// turns through the store (jobs.ts). It also refreshes the snapshots branch every half hour (Kickback threads and
// YouTube transcripts, which GitHub can't reach), for the builds on either runner.
// Usage: npm run agent [-- --templates] [--no-snapshot]
//   --templates     plain lines, no AI, for both programmes and breaking news
//   --no-snapshot   don't refresh the snapshots branch

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, runJob, said } from './jobs.ts';
import { checkIn, type Job, type JobKind, releaseJobs, signOff, storeFromEnv } from './store.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHECK_IN_MS = 30_000;
const SNAPSHOT_MS = 30 * 60_000;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const store = storeFromEnv();
  if (!store) throw new Error('STORE_TOKEN is not set (.env): the agent takes its jobs from the store');

  const running = new Map<JobKind, Job>();
  let snapshotting = false;
  let lastSnapshot = -Infinity;

  // Going off: hand back anything half-built and stop the clock waiting for us, so GitHub takes over at once.
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\n[agent] Signing off: GitHub takes over');
    await signOff(store).catch(() => undefined);
    await releaseJobs(store, [...running.values()].map((j) => j.id)).catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`[agent] Checking in every ${CHECK_IN_MS / 1000}s for programmes and breaking news${flag('--templates') ? ' (plain lines, no AI)' : ''}`);
  let quiet = false;
  while (!stopping) {
    const free = (['breaking', 'programme'] as const).filter((k) => !running.has(k));
    try {
      const jobs = await checkIn(store, free, new Date());
      if (quiet) console.log('[agent] In touch with the store again');
      quiet = false;
      for (const job of jobs) {
        running.set(job.kind, job);
        const holder = `home:${job.id}:${Date.now()}`;
        void runJob(store, job, { runner: 'home', templates: flag('--templates'), holder })
          .catch(() => undefined)
          .finally(() => running.delete(job.kind));
      }
    } catch (err) {
      if (!quiet) console.warn(`[agent] Couldn't check in (GitHub will take the jobs meanwhile): ${said(err)}`);
      quiet = true;
    }
    if (!flag('--no-snapshot') && !snapshotting && Date.now() - lastSnapshot >= SNAPSHOT_MS) {
      snapshotting = true;
      lastSnapshot = Date.now();
      void run('snapshot').finally(() => (snapshotting = false));
    }
    await sleep(CHECK_IN_MS);
  }
}

main().catch((err) => {
  console.error(said(err));
  process.exit(1);
});
