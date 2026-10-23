// Replays a recorded match through the live pipeline at speed, to try the Worker, the breaking news and the player end
// to end without waiting for a game. Serves live.json from the Worker's own code (worker/src/feed.ts) reading the
// recording on a sped-up clock, and runs the breaking-news watcher against it, writing packages to site/public/breaking
// (never published). Then `npm run dev` and open the player address it prints: the score bug, ticker and break-ins all
// follow the one clock.
// With --queue it instead tries the channel's real set-up (issue #29): the Worker's clock (worker/src/clock.ts) runs
// against the replay from here, queueing test jobs in the store, and GitHub builds each one (never publishing it).
// At the end it prints how long each package took, from being queued to being built.
// Usage: npm run replay [-- --from 17:15] [--speed 20] [--recording <name>] [--port 8788] [--ai] [--no-breaking]
//        npm run replay -- --queue [--from 17:15] [--speed 20] [--recording <name>]
//   --from HH:MM        where to start, UTC on the match day (default: the start of the recording, 16:30 for the
//                       committed Trabzonspor v Hearts; kick-off was 16:45)
//   --speed N           how much faster than real time (default 20)
//   --recording <name>  a full recording in pipeline/out/recordings/ (home PC) instead of the committed fixture
//   --port N            where live.json is served (default 8788; `npm run worker:dev` has 8787)
//   --ai                write the breaking news with Gemini Flash-Lite rather than plain lines
//   --no-breaking       just serve live.json
//   --queue             queue the breaking news as test jobs for GitHub (needs STORE_TOKEN and `gh` logged in)

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatcher, tick } from '../../worker/src/clock.ts';
import { resetBreaking, watchBreaking, workerSource } from './breaking/index.ts';
import { repo, token } from './publish.ts';
import { openFixture, openRecording, replay } from './recording.ts';
import { clearTestState, jobsLike, storeAsD1, storeFromEnv } from './store.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** How long to wait for GitHub to finish the last test jobs once the recording has run out. */
const WAIT_MS = 20 * 60_000;

/** The clock against the replay, every replayed minute; then waits for GitHub and reports the timings. */
async function queue(r: ReturnType<typeof replay>): Promise<void> {
  const store = storeFromEnv();
  if (!store) throw new Error('STORE_TOKEN is not set (.env): --queue puts its jobs in the store');
  const runId = new Date().toISOString();
  const prefix = `test:${runId}:`;
  const db = storeAsD1(store);
  // `gh`'s own token can run workflows; the Worker uses its narrower one.
  const dispatch = dispatcher(repo(), token());
  await clearTestState(store);
  console.log(`[replay] Queueing test jobs as ${prefix}…`);
  while (!r.over()) {
    const feed = await r.feed();
    const t = await tick(db, feed, { dispatch, test: runId });
    for (const id of t.queued) console.log(`[replay] ${new Date(r.now()).toISOString().slice(11, 19)} queued ${id.slice(prefix.length)}`);
    for (const e of t.errors) console.warn(`[replay] Couldn't send ${e}`);
    await sleep(60_000 / r.speed);
  }

  console.log('[replay] The recording has run out. Waiting for GitHub to finish…');
  const until = Date.now() + WAIT_MS;
  let jobs = await jobsLike(store, prefix);
  while (jobs.some((j) => j.status === 'queued' || j.status === 'claimed') && Date.now() < until) {
    await sleep(15_000);
    jobs = await jobsLike(store, prefix);
  }
  const secs = (from: string | null, to: string | null) => (from && to ? `${Math.round((Date.parse(to) - Date.parse(from)) / 1000)}s` : '-');
  console.log('\n[replay] Queued → sent to GitHub → claimed → built');
  for (const j of jobs) {
    console.log(
      `  ${j.status.padEnd(8)} ${secs(j.queuedAt, j.dispatchedAt).padStart(5)} ${secs(j.queuedAt, j.claimedAt).padStart(5)} ${secs(j.queuedAt, j.finishedAt).padStart(5)}  ${j.id.slice(prefix.length)}${j.error ? ` (${j.error})` : ''}`,
    );
  }
}

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const club = JSON.parse(readFileSync(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as { bbc: { team: string } };
  const port = Number(opt('--port')) || 8788;
  const name = opt('--recording');
  const rec = name ? openRecording(name) : openFixture();
  const r = replay(rec, { team: club.bbc.team, from: opt('--from'), speed: Number(opt('--speed')) || 20 });
  if (args.includes('--queue')) return queue(r);
  const url = `http://localhost:${port}/live.json`;

  const server = createServer(async (req, res) => {
    const response = await r.respond(new Request(`http://localhost:${port}${req.url}`, { method: req.method }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((done, fail) => server.once('error', fail).listen(port, done));

  const clock = (t: number) => new Date(t).toISOString().slice(11, 19);
  console.log(`[replay] ${rec.name} (${clock(rec.start)}-${clock(rec.end)} UTC) from ${clock(r.now())} at ${r.speed}x`);
  console.log(`[replay] live.json: ${url}`);
  console.log(`[replay] Player (npm run dev): http://localhost:5173/?live=${encodeURIComponent(url)}&speed=${r.speed}`);
  // The match clock, every few minutes of it.
  const tick = setInterval(() => console.log(`[replay] ${clock(r.now())} UTC`), (5 * 60_000) / r.speed);

  if (!args.includes('--no-breaking')) {
    await resetBreaking();
    await watchBreaking({ source: workerSource(url), pace: r.speed, templates: !args.includes('--ai'), stop: r.over });
  } else {
    while (!r.over()) await new Promise((done) => setTimeout(done, 1000));
  }
  clearInterval(tick);
  // Keep serving full time, so the player doesn't drop the score; the breaking news stays in site/public/breaking.
  console.log('[replay] The recording has run out. Still serving full time: Ctrl+C to stop.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
