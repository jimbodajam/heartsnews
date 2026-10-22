// Breaking news from the ground: polls the Worker's live.json, and for each goal or red card, both kick-offs,
// half-time and full time builds a short package (the anchor hands over, our reporter gives the score and a line
// from BBC's description), voices it with Kokoro and
// writes site/public/breaking/breaking.json. `npm run live` runs this alongside the programmes and publishes each one.
// Usage, to try it on its own: npm run breaking [-- --replay [--from 17:15] [--speed 20]] [--publish] [--templates]
// (`npm run replay` runs a replay with the player as well.)
//   --replay      replay the recorded Trabzonspor v Hearts (22 Oct 2026) through the Worker's code instead of reading it
//   --from HH:MM  where the replay starts, UTC (default 16:30; kick-off was 16:45)
//   --speed N     how much faster than real time the replay runs (default 20)
//   --publish     put each package on air (gh-pages); otherwise it's only written for `npm run dev`
//   --templates   plain lines only, no AI

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKING_PATH, type BreakingFeed, type BreakingPackage, type Period } from '../../../shared/breaking.ts';
import { LIVE_URL, type LiveFeed } from '../../../shared/live.ts';
import { publishSite } from '../publish.ts';
import { openFixture, replay } from '../recording.ts';
import type { Channel } from '../script/facts.ts';
import { geminiFromEnv } from '../script/llm.ts';
import { dropUnusedClips, voiceLines } from '../voice.ts';
import { EventTracker, type TrackerState } from './detect.ts';
import { buildPackage, buildPeriodPackage } from './script.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FEED = resolve(ROOT, 'site/public', BREAKING_PATH);
const DIR = dirname(FEED);
const STATE = resolve(ROOT, 'pipeline/out/breaking-state.json');
/** Packages kept in the feed: enough that a player polling every 20s never misses one. */
const KEEP = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** An error's message, never with the token-bearing push URL in it. */
const said = (err: unknown) => String((err as Error).message).replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');

export type FeedSource = () => Promise<LiveFeed>;

export function workerSource(url = process.env.HEARTSNEWS_LIVE_URL ?? LIVE_URL): FeedSource {
  return async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`live.json: HTTP ${res.status}`);
    return (await res.json()) as LiveFeed;
  };
}

/** live.json as the recorded match had it, through the Worker's code, replayed from `from` (UTC) at `speed` times real time. */
export function replaySource(from?: string, speed = 20): FeedSource & { over: () => boolean } {
  const club = JSON.parse(readFileSync(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as { bbc: { team: string } };
  const r = replay(openFixture(), { team: club.bbc.team, from, speed });
  return Object.assign(r.feed, { over: r.over });
}

/** Empty site/public/breaking, so a replay's packages come out fresh. */
export async function resetBreaking(): Promise<void> {
  await rm(DIR, { recursive: true, force: true });
}

/** How long until the next read: every 20s while the game's on, less often either side of it. */
function interval(feed?: LiveFeed): number {
  const m = feed?.match;
  if (!m) return 10 * 60_000;
  if (m.status === 'live' || m.status === 'ht') return 20_000;
  if (m.status === 'pre') return Date.parse(m.kickOff) - Date.parse(feed.updated) < 30 * 60_000 ? 30_000 : 10 * 60_000;
  return 2 * 60_000;
}

async function readFeed(): Promise<BreakingFeed> {
  try {
    return JSON.parse(await readFile(FEED, 'utf8')) as BreakingFeed;
  } catch {
    return { version: 1, updated: new Date(0).toISOString(), packages: [] };
  }
}

/** Voice a package and add it to breaking.json, dropping other matches' packages and their clips. */
async function addToFeed(pkg: BreakingPackage): Promise<void> {
  await voiceLines(pkg.presenters, pkg.segments.flatMap((s) => s.lines), DIR);
  const feed = await readFeed();
  const packages = [...feed.packages.filter((p) => p.kickOff === pkg.kickOff && p.id !== pkg.id), pkg].slice(-KEEP);
  await writeFile(FEED, `${JSON.stringify({ version: 1, updated: pkg.publishedAt, packages } satisfies BreakingFeed, null, 2)}\n`);
  await dropUnusedClips(packages.flatMap((p) => p.segments.flatMap((s) => s.lines)), DIR);
}

/**
 * Copy the breaking news into the built site and publish it. The site is built first if it hasn't been. Callers
 * running alongside a programme build must not run this at the same time as `npm run build` (see live.ts).
 */
export async function publishBreaking(): Promise<void> {
  const dist = resolve(ROOT, 'site/dist');
  if (!existsSync(resolve(dist, 'index.html')) && spawnSync('npm', ['run', '--silent', 'build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) {
    throw new Error('site build failed');
  }
  const out = resolve(dist, dirname(BREAKING_PATH));
  await rm(out, { recursive: true, force: true });
  await cp(DIR, out, { recursive: true });
  await publishSite('home PC, breaking news');
}

export interface WatchOptions {
  source: FeedSource;
  /** Puts the new breaking.json on air. Without it, packages are only written to site/public/breaking. */
  publish?: () => Promise<void>;
  /** Replays run faster than real time. */
  pace?: number;
  /** Keep what's been handled on disk (default), so a restart mid-match doesn't repeat itself. */
  persist?: boolean;
  /** Plain lines only. */
  templates?: boolean;
  /** Stop when this says so (a replay that's run out). */
  stop?: () => boolean;
  /** Told of every read of live.json, so `npm run live` can time its programmes around the match. */
  onFeed?: (feed: LiveFeed) => void;
}

const PERIOD: Record<Period, string> = { ko1: 'KICK-OFF', ko2: 'SECOND HALF UNDER WAY', ht: 'HALF TIME', ft: 'FULL TIME' };

export async function watchBreaking({ source, publish, pace = 1, persist = true, templates, stop, onFeed }: WatchOptions): Promise<void> {
  const channel = JSON.parse(await readFile(resolve(ROOT, 'channel.json'), 'utf8')) as Channel;
  // Flash-Lite only: Flash's 20 free requests a day are for the bulletins.
  const model = templates ? undefined : geminiFromEnv([30_000], ['gemini-flash-lite-latest']);
  let state: TrackerState = { done: [] };
  if (persist) {
    try {
      state = JSON.parse(await readFile(STATE, 'utf8')) as TrackerState;
    } catch {
      // First run: nothing handled yet.
    }
  }
  const tracker = new EventTracker(state);
  await mkdir(DIR, { recursive: true });
  console.log(`[breaking] Watching for goals, red cards, kick-offs, half-time and full time${model ? '' : ' (plain lines, no AI)'}`);

  while (!stop?.()) {
    let feed: LiveFeed | undefined;
    try {
      feed = await source();
      const m = feed.match;
      const before = JSON.stringify(tracker.state);
      onFeed?.(feed);
      const now = Date.parse(feed.updated);
      const ready = m ? tracker.update(m, now) : [];
      const period = m ? tracker.period(m, now) : undefined;
      if (persist && JSON.stringify(tracker.state) !== before) {
        await mkdir(dirname(STATE), { recursive: true });
        await writeFile(STATE, JSON.stringify(tracker.state));
      }
      const jobs = [
        ...ready.map((r) => ({
          key: r.key,
          said: `${r.event.kind === 'goal' ? 'GOAL' : 'RED CARD'}: ${r.event.player} ${r.event.minute}`,
          text: r.text,
          build: () => buildPackage({ key: r.key, match: r.match, event: r.event, text: r.text, channel, model }),
        })),
        ...(period
          ? [{ key: period.key, said: PERIOD[period.period], text: period.text, build: () => buildPeriodPackage({ ...period, channel, model }) }]
          : []),
      ];
      for (const job of jobs) {
        const started = Date.now();
        try {
          console.log(`[breaking] ${job.said}${job.text.length ? '' : ' (no description from BBC)'}`);
          const pkg = await job.build();
          for (const line of pkg.segments.flatMap((s) => s.lines)) console.log(`  ${line.speaker}: ${line.text}`);
          await addToFeed(pkg);
          if (publish) await publish();
          console.log(`[breaking] ${publish ? 'On air' : 'Written'} in ${Math.round((Date.now() - started) / 1000)}s`);
        } catch (err) {
          console.error(`[breaking] Couldn't put out ${job.key}: ${said(err)}`);
        }
      }
    } catch (err) {
      console.warn(`[breaking] ${said(err)}`);
    }
    await sleep(interval(feed) / pace);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const args = process.argv.slice(2);
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const replaying = args.includes('--replay');
  const speed = Number(opt('--speed')) || 20;
  const source = replaying ? replaySource(opt('--from'), speed) : workerSource();
  const run = async () => {
    if (replaying) await resetBreaking();
    await watchBreaking({
      source,
      publish: args.includes('--publish') ? publishBreaking : undefined,
      pace: replaying ? speed : 1,
      persist: !replaying,
      templates: args.includes('--templates'),
      stop: replaying ? (source as ReturnType<typeof replaySource>).over : undefined,
    });
  };
  run().catch((err) => {
    console.error(said(err));
    process.exit(1);
  });
}
