// The home PC's part in running the channel (issue #29). The Worker's clock queues the programmes and breaking news;
// while this runs, it checks in every 30 seconds and claims them, voicing them on the GPU. When it's off, GitHub
// builds them instead, on the CPU. One programme and one breaking package at a time, side by side: publishing takes
// turns through the store (jobs.ts). It also refreshes the snapshots branch every half hour (Kickback threads and
// YouTube transcripts, which GitHub can't reach), for the builds on either runner. And it reads BBC's fixtures and
// table every half hour into the store, for the ingest and the programmes to share (issue #105, shared-match.ts), so
// BBC is read from home rather than from GitHub.
// Usage: npm run agent [-- --templates] [--no-snapshot] [--no-fixtures] [--follow-main]
//   --templates     plain lines, no AI, for both programmes and breaking news
//   --no-snapshot   don't refresh the snapshots branch
//   --no-fixtures   don't read BBC's fixtures and table (the ingest and programmes then read them themselves)
//   --follow-main   sign off once main has moved on and nothing is being built, so the service manager starts it again
//                   on the new code (the Mac's run-agent.sh pulls before each start)

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { relayBbc } from './bbc-relay.ts';
import { run, runJob, said } from './jobs.ts';
import { refreshShared } from './shared-match.ts';
import { checkIn, type Job, type JobKind, releaseJobs, sheetCache, signOff, storeFromEnv } from './store.ts';
import type { ClubConfig } from './types.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHECK_IN_MS = 30_000;
const SNAPSHOT_MS = 30 * 60_000;
const RELAY_MS = 10_000;
/** How often the agent looks at the shared fixtures' age; it reads BBC only once they're half an hour old. */
const FIXTURES_CHECK_MS = 60_000;
const FIXTURES_RETRY_MS = 10 * 60_000;
/** How often --follow-main looks for new commits on main. */
const FOLLOW_MS = 5 * 60_000;
/** A tracked file every build writes (build.ts), so never counted as a local edit. */
const BUILT = 'site/public/bulletins/latest.json';
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const git = async (...a: string[]) => (await promisify(execFile)('git', a, { cwd: ROOT })).stdout.trim();

/**
 * Main's newest commit if this checkout can fast-forward to it, otherwise null (already up to date, or the checkout
 * has commits or edits of its own, which a pull wouldn't overwrite). Fetches into origin/main only, never FETCH_HEAD,
 * which publish.ts reads straight after its own fetch.
 */
async function newerMain(): Promise<string | null> {
  await git('fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', '+refs/heads/main:refs/remotes/origin/main');
  const head = await git('rev-parse', 'HEAD');
  const main = await git('rev-parse', 'origin/main');
  if (head === main) return null;
  const behind = await git('merge-base', '--is-ancestor', 'HEAD', 'origin/main').then(() => true, () => false);
  // Every build rewrites latest.json, which is tracked; run-agent.sh throws that copy away before it pulls.
  const clean = (await git('status', '--porcelain', '--untracked-files=no', '--', '.', `:!${BUILT}`)) === '';
  return behind && clean ? main : null;
}

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

  // BBC refuses the Worker, so the agent fetches the live feed's pages for it (bbc-relay.ts), on its own faster loop.
  void (async () => {
    let failing = false;
    while (!stopping) {
      await relayBbc(store).then(
        () => (failing = false),
        (err) => {
          if (!failing) console.warn(`[agent] BBC relay: couldn't reach the store: ${said(err)}`);
          failing = true;
        },
      );
      await sleep(RELAY_MS);
    }
  })();

  // BBC's fixtures and table for everyone (shared-match.ts), read from here once the stored copy is half an hour old.
  if (!flag('--no-fixtures')) {
    const club = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as ClubConfig;
    void (async () => {
      let failing = false;
      while (!stopping) {
        await refreshShared(store, club, new Date(), undefined, sheetCache(store)).then(
          (did) => {
            if (did) console.log(`[agent] BBC fixtures and table shared: ${did}`);
            failing = false;
          },
          (err) => {
            if (!failing) console.warn(`[agent] Couldn't share BBC's fixtures (the ingest reads them itself meanwhile): ${said(err)}`);
            failing = true;
          },
        );
        // After a failure, wait a good while: never retry BBC every minute.
        await sleep(failing ? FIXTURES_RETRY_MS : FIXTURES_CHECK_MS);
      }
    })();
  }

  // New code on main (--follow-main): noted here, acted on between jobs in the loop below.
  let pendingUpdate: string | null = null;
  if (flag('--follow-main')) {
    void (async () => {
      let failing = false;
      while (!stopping && !pendingUpdate) {
        await sleep(FOLLOW_MS);
        pendingUpdate = await newerMain().then(
          (sha) => {
            failing = false;
            return sha;
          },
          (err) => {
            if (!failing) console.warn(`[agent] Couldn't look for new commits on main: ${said(err)}`);
            failing = true;
            return null;
          },
        );
      }
      if (pendingUpdate) console.log(`[agent] main has moved on to ${pendingUpdate.slice(0, 7)}: restarting once nothing is being built`);
    })();
  }

  console.log(`[agent] Checking in every ${CHECK_IN_MS / 1000}s for programmes and breaking news${flag('--templates') ? ' (plain lines, no AI)' : ''}`);
  let quiet = false;
  while (!stopping) {
    // Bow out between jobs, before claiming any more; run-agent.sh pulls and launchd starts us again on the new code.
    if (pendingUpdate && running.size === 0 && !snapshotting) {
      console.log('[agent] Restarting on the new code');
      await stop();
    }
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
