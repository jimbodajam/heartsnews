// Breaking news from the ground: for each goal or red card, both kick-offs, half-time and full time, a short package
// (the anchor hands over, our reporter gives the score and a line from BBC's description), and the team news when
// it's out (read at the video wall, teamnews.ts), voiced with Kokoro and
// added to breaking/breaking.json. On air, the Worker's clock spots each one and queues it as a job (worker/src/clock.ts),
// which the home PC or GitHub builds and publishes (jobs.ts). The watcher here does the same against a replay, writing
// to site/public/breaking for `npm run dev`.
// Usage, to try it on its own: npm run breaking [-- --replay [--from 17:15] [--speed 20]] [--templates]
// (`npm run replay` runs a replay with the player as well.)
//   --replay      replay the recorded Trabzonspor v Hearts (22 Oct 2026) through the Worker's code instead of reading it
//   --from HH:MM  where the replay starts, UTC (default 16:30; kick-off was 16:45)
//   --speed N     how much faster than real time the replay runs (default 20)
//   --templates   plain lines only, no AI

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKING_PATH, type BreakingFeed, type BreakingPackage, type Period } from '../../../shared/breaking.ts';
import { LIVE_URL, type LiveFeed } from '../../../shared/live.ts';
import { openFixture, replay } from '../recording.ts';
import type { Channel } from '../script/facts.ts';
import { geminiFromEnv, type ScriptModel } from '../script/llm.ts';
import { dropUnusedClips, voiceLines } from '../voice.ts';
import { previousSheet } from '../collectors/bbc.ts';
import { loadFaces } from '../script/faces.ts';
import { EventTracker, type ReadyClubLineup, type ReadyEvent, type ReadyLineup, type ReadyPeriod } from './detect.ts';
import { buildPackage, buildPeriodPackage } from './script.ts';
import { storeFromEnv } from '../store.ts';
import { loadPlayers, loadTotals } from '../tally.ts';
import { instagramFrom } from '../club-post.ts';
import { downloadPost, readClubXI } from '../club-xi.ts';
import { buildClubNewsPackage } from './clubnews.ts';
import { buildTeamNewsPackage } from './teamnews.ts';
import { matchWeather, type Place } from '../weather.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** The breaking news for `npm run dev` (and the programme builds, which copy it into the site). */
export const LOCAL_DIR = resolve(ROOT, 'site/public', dirname(BREAKING_PATH));
/** Packages kept in the feed: enough that a player polling every 20s never misses one. */
const KEEP = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  await rm(LOCAL_DIR, { recursive: true, force: true });
}

/** How long until the next read: every 20s while the game's on, less often either side of it. */
function interval(feed?: LiveFeed): number {
  const m = feed?.match;
  if (!m) return 10 * 60_000;
  if (m.status === 'live' || m.status === 'ht') return 20_000;
  if (m.status === 'pre') return Date.parse(m.kickOff) - Date.parse(feed.updated) < 30 * 60_000 ? 30_000 : 10 * 60_000;
  return 2 * 60_000;
}

const PERIOD: Record<Period, string> = { ko1: 'KICK-OFF', ko2: 'SECOND HALF UNDER WAY', ht: 'HALF TIME', ft: 'FULL TIME' };

/** What a package is built from: the team news, a goal or red card, or a period. The clock queues these as breaking jobs. */
export type Ready = ReadyLineup | ReadyClubLineup | ReadyEvent | ReadyPeriod;

/** A line for the log saying what happened. */
export const describe = (r: Ready) =>
  'club' in r
    ? `TEAM NEWS (club graphic): ${r.club.permalink}${r.aired ? ' (BBC already out: check)' : ''}`
    : 'lineup' in r
    ? `TEAM NEWS: ${r.lineup.team}`
    : 'period' in r
      ? PERIOD[r.period]
      : `${r.event.kind === 'goal' ? 'GOAL' : 'RED CARD'}: ${r.event.player} ${r.event.minute}`;

/** Whether BBC's description is missing from what a package is built from (the team news never has one). */
export const undescribed = (r: Ready) => !('lineup' in r) && !('club' in r) && !r.text.length;

/** Writes the package (no voices yet), or nothing if there's none to put out (the club's team matches BBC's). Flash-Lite only: Flash's 20 free requests a day are for the bulletins. */
export async function writePackage(r: Ready, model?: ScriptModel): Promise<BreakingPackage | undefined> {
  const channel = JSON.parse(await readFile(resolve(ROOT, 'channel.json'), 'utf8')) as Channel;
  if ('club' in r) {
    const auth = instagramFrom(process.env);
    // The image first, straight away: the URL is signed and expires.
    const { image, mime } = await downloadPost(r.club, auth);
    await mkdir(resolve(ROOT, 'pipeline/out/club-xi'), { recursive: true });
    await writeFile(resolve(ROOT, `pipeline/out/club-xi/${r.club.id}.${mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'}`), image).catch(() => undefined);
    const xi = await readClubXI(image, mime, 'gemini-flash-lite-latest');
    if (xi.unsure.length) console.warn(`[breaking] Club graphic, not read clearly: ${xi.unsure.join('; ')}`);
    const store = storeFromEnv();
    if (!store) throw new Error('STORE_TOKEN is not set: the club graphic is matched to the squad table in the store');
    const roster = await loadPlayers(store);
    const config = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as { bbc: { team: string } };
    const previous = await previousSheet(config.bbc.team, r.match.kickOff).catch(() => undefined);
    const totals = await loadTotals(store).catch(() => undefined);
    return buildClubNewsPackage({ ready: r, xi, roster, channel, previous, faces: loadFaces(), totals });
  }
  if ('lineup' in r) {
    const club = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as { bbc: { team: string } };
    const previous = await previousSheet(club.bbc.team, r.match.kickOff).catch(() => undefined);
    if (!previous) console.log("[breaking] Couldn't read our last team from BBC: no changes line");
    // Our own appearances and goals count, for a milestone the team could bring (issue #35). Without it there is no line.
    const store = storeFromEnv();
    const totals = store ? await loadTotals(store).catch(() => undefined) : undefined;
    return buildTeamNewsPackage({ ...r, channel, previous, faces: loadFaces(), totals });
  }
  if ('period' in r) {
    const club = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as { ground?: Place };
    // Not at the second-half kick-off: the weather has had its say by then.
    const weather = r.period === 'ko2' ? undefined : await matchWeather(r.match, club);
    return buildPeriodPackage({ ...r, channel, model, weather });
  }
  return buildPackage({ ...r, channel, model });
}

export const breakingModel = (templates?: boolean) => (templates ? undefined : geminiFromEnv([30_000], ['gemini-flash-lite-latest']));

/** Voices a package's lines into `<dir>/audio/`. */
export async function voicePackage(pkg: BreakingPackage, dir: string): Promise<void> {
  await voiceLines(pkg.presenters, pkg.segments.flatMap((s) => s.lines), dir);
}

async function readFeed(dir: string): Promise<BreakingFeed> {
  try {
    return JSON.parse(await readFile(resolve(dir, 'breaking.json'), 'utf8')) as BreakingFeed;
  } catch {
    return { version: 1, updated: new Date(0).toISOString(), packages: [] };
  }
}

/** Adds a voiced package to `<dir>/breaking.json`, dropping other matches' packages and their clips. */
export async function addToFeed(pkg: BreakingPackage, dir: string): Promise<void> {
  const feed = await readFeed(dir);
  const packages = [...feed.packages.filter((p) => p.kickOff === pkg.kickOff && p.id !== pkg.id), pkg].slice(-KEEP);
  await writeFile(resolve(dir, 'breaking.json'), `${JSON.stringify({ version: 1, updated: pkg.publishedAt, packages } satisfies BreakingFeed, null, 2)}\n`);
  await dropUnusedClips(packages.flatMap((p) => p.segments.flatMap((s) => s.lines)), dir);
}

export interface WatchOptions {
  source: FeedSource;
  /** Replays run faster than real time. */
  pace?: number;
  /** Plain lines only. */
  templates?: boolean;
  /** Stop when this says so (a replay that's run out). */
  stop?: () => boolean;
}

/** Watches a feed and writes a package to site/public/breaking for each event, as the clock and a runner would. */
export async function watchBreaking({ source, pace = 1, templates, stop }: WatchOptions): Promise<void> {
  const model = breakingModel(templates);
  const tracker = new EventTracker();
  await mkdir(LOCAL_DIR, { recursive: true });
  console.log(`[breaking] Watching for the team news, goals, red cards, kick-offs, half-time and full time${model ? '' : ' (plain lines, no AI)'}`);

  while (!stop?.()) {
    let feed: LiveFeed | undefined;
    try {
      feed = await source();
      const m = feed.match;
      const now = Date.parse(feed.updated);
      const lineup = m && tracker.lineup(m);
      const events = m ? tracker.update(m, now) : [];
      const period = m && tracker.period(m, now);
      const ready: Ready[] = [...(lineup ? [lineup] : []), ...events, ...(period ? [period] : [])];
      for (const r of ready) {
        const started = Date.now();
        try {
          console.log(`[breaking] ${describe(r)}${undescribed(r) ? ' (no description from BBC)' : ''}`);
          const pkg = await writePackage(r, model);
          if (!pkg) {
            console.log('[breaking] Nothing to put out');
            continue;
          }
          for (const line of pkg.segments.flatMap((s) => s.lines)) console.log(`  ${line.speaker}: ${line.text}`);
          await voicePackage(pkg, LOCAL_DIR);
          await addToFeed(pkg, LOCAL_DIR);
          console.log(`[breaking] Written in ${Math.round((Date.now() - started) / 1000)}s`);
        } catch (err) {
          console.error(`[breaking] Couldn't put out ${r.key}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.warn(`[breaking] ${(err as Error).message}`);
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
      pace: replaying ? speed : 1,
      templates: args.includes('--templates'),
      stop: replaying ? (source as ReturnType<typeof replaySource>).over : undefined,
    });
  };
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
