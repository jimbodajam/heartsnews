// Breaking news from the ground: polls the Worker's live.json, and for each goal or red card builds a short package
// (the anchor hands over, our reporter gives the score and a line from BBC's description), voices it with Kokoro and
// writes site/public/breaking/breaking.json. `npm run live` runs this alongside the programmes and publishes each one.
// Usage, to try it on its own: npm run breaking [-- --replay [--from 17:15] [--speed 20]] [--publish] [--templates]
//   --replay      replay the recorded Trabzonspor v Hearts (22 Oct 2026) instead of reading the Worker
//   --from HH:MM  where the replay starts, UTC (default 16:30; kick-off was 16:45)
//   --speed N     how much faster than real time the replay runs (default 20)
//   --publish     put each package on air (gh-pages); otherwise it's only written for `npm run dev`
//   --templates   plain lines only, no AI

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BbcData, BbcEvent } from '../../../shared/bbc.ts';
import { BREAKING_PATH, type BreakingFeed, type BreakingPackage } from '../../../shared/breaking.ts';
import { LIVE_URL, type LiveFeed, liveMatch } from '../../../shared/live.ts';
import { publishSite } from '../publish.ts';
import type { Channel } from '../script/facts.ts';
import { geminiFromEnv } from '../script/llm.ts';
import { dropUnusedClips, voiceLines } from '../voice.ts';
import { EventTracker, type TrackerState } from './detect.ts';
import { buildPackage } from './script.ts';

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

/** live.json as the recorded match had it, replayed from `from` (UTC) at `speed` times real time. */
export function replaySource(from = '16:30', speed = 20): FeedSource & { over: () => boolean } {
  const rec = JSON.parse(readFileSync(resolve(ROOT, 'shared/test/fixtures/2026-10-22-trabzonspor-hearts.json'), 'utf8')) as {
    teamEvent: BbcEvent;
    snapshots: { at: string; page: BbcData }[];
  };
  const club = JSON.parse(readFileSync(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as { bbc: { team: string } };
  const start = Date.parse(`2026-10-22T${from.length === 5 ? `${from}:00` : from}Z`);
  const began = Date.now();
  const now = () => start + (Date.now() - began) * speed;
  // Over once the recording has run out, plus long enough for anything still waiting on a description.
  const end = Date.parse(rec.snapshots[rec.snapshots.length - 1].at) + 5 * 60_000;
  const source = async () => {
    const t = now();
    const snap = rec.snapshots.filter((s) => Date.parse(s.at) <= t).pop() ?? rec.snapshots[0];
    return { updated: new Date(t).toISOString(), match: liveMatch(rec.teamEvent, club.bbc.team, snap.page) };
  };
  return Object.assign(source, { over: () => now() > end });
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
}

export async function watchBreaking({ source, publish, pace = 1, persist = true, templates, stop }: WatchOptions): Promise<void> {
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
  console.log(`[breaking] Watching for goals and red cards${model ? '' : ' (plain lines, no AI)'}`);

  while (!stop?.()) {
    let feed: LiveFeed | undefined;
    try {
      feed = await source();
      const m = feed.match;
      const before = JSON.stringify(tracker.state);
      const ready = m ? tracker.update(m, Date.parse(feed.updated)) : [];
      if (persist && JSON.stringify(tracker.state) !== before) {
        await mkdir(dirname(STATE), { recursive: true });
        await writeFile(STATE, JSON.stringify(tracker.state));
      }
      for (const r of ready) {
        const started = Date.now();
        try {
          console.log(`[breaking] ${r.event.kind === 'goal' ? 'GOAL' : 'RED CARD'}: ${r.event.player} ${r.event.minute}${r.text.length ? '' : ' (no description from BBC)'}`);
          const pkg = await buildPackage({ key: r.key, match: r.match, event: r.event, text: r.text, channel, model });
          for (const line of pkg.segments.flatMap((s) => s.lines)) console.log(`  ${line.speaker}: ${line.text}`);
          await addToFeed(pkg);
          if (publish) await publish();
          console.log(`[breaking] ${publish ? 'On air' : 'Written'} in ${Math.round((Date.now() - started) / 1000)}s`);
        } catch (err) {
          console.error(`[breaking] Couldn't put out ${r.key}: ${said(err)}`);
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
  const replay = args.includes('--replay');
  const speed = Number(opt('--speed')) || 20;
  const source = replay ? replaySource(opt('--from'), speed) : workerSource();
  const run = async () => {
    // A replay starts from an empty feed, so its packages come out fresh.
    if (replay) await rm(DIR, { recursive: true, force: true });
    await watchBreaking({
      source,
      publish: args.includes('--publish') ? publishBreaking : undefined,
      pace: replay ? speed : 1,
      persist: !replay,
      templates: args.includes('--templates'),
      stop: replay ? (source as ReturnType<typeof replaySource>).over : undefined,
    });
  };
  run().catch((err) => {
    console.error(said(err));
    process.exit(1);
  });
}
