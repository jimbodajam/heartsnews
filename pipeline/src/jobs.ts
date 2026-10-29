// Runs a job from the channel's queue (the Worker's clock queues them, worker/src/clock.ts): a programme (bulletin →
// site build → publish) or a breaking package (script → voices → added to the breaking news on air). The same code on
// the home PC (`npm run agent`, GPU voices) and on GitHub Actions (this file, Kokoro on the CPU); only the voices differ.
// Publishing takes turns through a lock in the store, so the two runners never publish over each other, and starts
// from what's on air (gh-pages): a programme keeps the breaking news, and a package goes out with the programme on air.
// A replay's test jobs are built but never published.
// Usage: npm run job -- --id <job id> [--templates]   claim that job and run it (GitHub's workflow does this)
//        npm run job [-- --templates]                 make a programme now, outside the queue (a manual run)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BreakingPackage } from '../../shared/breaking.ts';
import { addToFeed, breakingModel, describe, LOCAL_DIR, type Ready, undescribed, voicePackage, workerSource, writePackage } from './breaking/index.ts';
import { type Reason, stillWanted } from './cadence.ts';
import { pagesTree, publishSite } from './publish.ts';
import { claimJob, dropLock, finishJob, type Job, type Runner, type Store, storeFromEnv, takeLock } from './store.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LOCK = 'publish';
/** How long a runner may hold the publishing lock; more than a site build and push take. */
const LOCK_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** An error's message, never with the token-bearing push URL in it. */
export const said = (err: unknown) => String((err as Error).message).replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');

export const runnerHere = (): Runner => (process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'home');
const BUILT_BY: Record<Runner, string> = { home: 'home PC', github: 'GitHub Actions' };

/** Run an npm script from the repo root, streaming its output. Resolves true when it succeeded. */
export function run(script: string, ...extra: string[]): Promise<boolean> {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn('npm', ['run', '--silent', script, ...(extra.length ? ['--', ...extra] : [])], { cwd: ROOT, stdio: 'inherit' });
    child.on('error', () => done(false));
    child.on('close', (code) => {
      const ok = code === 0;
      console.log(`[job] ${script} ${ok ? 'done' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s`);
      done(ok);
    });
  });
}

/** Holds the publishing lock while `fn` runs. Without a store there's no one to take turns with. */
async function publishing<T>(store: Store | undefined, holder: string, fn: () => Promise<T>): Promise<T> {
  if (!store) return fn();
  const until = Date.now() + 2 * LOCK_MS;
  while (!(await takeLock(store, LOCK, holder, LOCK_MS, new Date()))) {
    if (Date.now() > until) throw new Error('waited too long to publish');
    await sleep(3_000);
  }
  try {
    return await fn();
  } finally {
    await dropLock(store, LOCK, holder).catch(() => undefined);
  }
}

/** Puts the breaking news on air into site/public/breaking, so a programme build keeps it. */
async function syncBreaking(): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'heartsnews-breaking-'));
  try {
    const onAir = pagesTree(tmp, 'breaking');
    await rm(LOCAL_DIR, { recursive: true, force: true });
    if (onAir) await cp(join(tmp, 'breaking'), LOCAL_DIR, { recursive: true });
  } catch (err) {
    console.warn(`[job] Couldn't read the breaking news on air, keeping what's here: ${said(err)}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Brings the programme on air into pipeline/out/onair, and its voice clips into site/public/bulletins/audio, before a
 * build. A quiet slot rewrites only the links of that programme (script/quiet.ts), and any build then re-voices only
 * the lines that changed, because the runner starts with no clips of its own.
 */
async function syncOnAir(): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'heartsnews-onair-'));
  const here = join(ROOT, 'pipeline/out/onair');
  try {
    await rm(here, { recursive: true, force: true });
    if (!pagesTree(tmp, 'bulletins')) return;
    await mkdir(here, { recursive: true });
    await cp(join(tmp, 'bulletins/latest.json'), join(here, 'latest.json'));
    const audio = join(tmp, 'bulletins/audio');
    if (existsSync(audio)) await cp(audio, join(ROOT, 'site/public/bulletins/audio'), { recursive: true });
  } catch (err) {
    // No programme to start from means a full build.
    await rm(here, { recursive: true, force: true });
    console.warn(`[job] Couldn't read the programme on air, so this is a full build: ${said(err)}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export interface RunOptions {
  runner: Runner;
  templates?: boolean;
  /** Name for the lock, unique to this run. */
  holder: string;
}

type Outcome = 'done' | 'dropped';

/** Makes a programme and puts it on air, unless it's been overtaken by the time it's ready. */
async function programme(store: Store | undefined, reason: Reason, test: boolean, o: RunOptions): Promise<Outcome> {
  await syncOnAir();
  if (!(await run('bulletin', ...(o.templates ? ['--templates'] : [])))) throw new Error('bulletin build failed');
  if (test) return 'done';
  if (!stillWanted(reason, await workerSource()().catch(() => undefined))) {
    console.log('[job] The second half is under way: not putting the half-time programme on air');
    return 'dropped';
  }
  await publishing(store, o.holder, async () => {
    await syncBreaking();
    if (!(await run('build'))) throw new Error('site build failed');
    await publishSite(BUILT_BY[o.runner]);
  });
  return 'done';
}

/** Builds and voices a breaking package, then adds it to what's on air and publishes. */
async function breaking(store: Store | undefined, ready: Ready & { templates?: boolean }, test: boolean, o: RunOptions): Promise<Outcome> {
  console.log(`[job] ${describe(ready)}${undescribed(ready) ? ' (no description from BBC)' : ''}`);
  const pkg: BreakingPackage | undefined = await writePackage(ready, breakingModel(o.templates || ready.templates));
  if (!pkg) return 'dropped';
  for (const line of pkg.segments.flatMap((s) => s.lines)) console.log(`  ${line.speaker}: ${line.text}`);
  const voiced = await mkdtemp(join(tmpdir(), 'heartsnews-voiced-'));
  const site = await mkdtemp(join(tmpdir(), 'heartsnews-onair-'));
  try {
    await voicePackage(pkg, voiced);
    if (test) return 'done';
    await publishing(store, o.holder, async () => {
      if (!pagesTree(site)) throw new Error('nothing on air to add breaking news to');
      const dir = join(site, 'breaking');
      await mkdir(dir, { recursive: true });
      await cp(voiced, dir, { recursive: true });
      await addToFeed(pkg, dir);
      await publishSite(`${BUILT_BY[o.runner]}, breaking news`, site);
      // Keep site/public/breaking in step, for `npm run dev`.
      await rm(LOCAL_DIR, { recursive: true, force: true });
      await cp(dir, LOCAL_DIR, { recursive: true });
    });
    return 'done';
  } finally {
    await rm(voiced, { recursive: true, force: true });
    await rm(site, { recursive: true, force: true });
  }
}

/** Runs a job this runner has claimed and records how it went. */
export async function runJob(store: Store, job: Job, o: RunOptions): Promise<void> {
  const started = Date.now();
  console.log(`\n[job] ${new Date().toLocaleString('en-GB')}: ${job.id}${job.test ? ' (test: not published)' : ''}`);
  try {
    const outcome =
      job.kind === 'programme'
        ? await programme(store, job.payload.reason as Reason, job.test, o)
        : await breaking(store, job.payload as unknown as Ready, job.test, o);
    await finishJob(store, job.id, outcome, new Date());
    console.log(`[job] ${outcome === 'done' ? (job.test ? 'Built' : 'On air') : 'Dropped'} in ${Math.round((Date.now() - started) / 1000)}s: ${job.id}`);
  } catch (err) {
    console.error(`[job] FAILED ${job.id}: ${said(err)}`);
    await finishJob(store, job.id, 'failed', new Date(), said(err)).catch(() => undefined);
    throw err;
  }
}

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const args = process.argv.slice(2);
  const id = args.includes('--id') ? args[args.indexOf('--id') + 1] : undefined;
  const runner = runnerHere();
  const o: RunOptions = { runner, templates: args.includes('--templates'), holder: `${runner}:${id ?? 'manual'}:${Date.now()}` };
  const store = storeFromEnv();
  if (!id) {
    console.log('[job] A programme now, outside the queue');
    await programme(store, 'regular', false, o);
    return;
  }
  if (!store) throw new Error('STORE_TOKEN is not set: a queued job needs the store');
  const job = await claimJob(store, id, runner, new Date());
  if (!job) return console.log(`[job] ${id} has been claimed already (the home PC took it) or is gone: nothing to do`);
  await runJob(store, job, o);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(said(err));
    process.exit(1);
  });
}
