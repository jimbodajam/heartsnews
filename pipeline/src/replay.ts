// Replays a recorded match through the live pipeline at speed, to try the Worker, the breaking news and the player end
// to end without waiting for a game. Serves live.json from the Worker's own code (worker/src/feed.ts) reading the
// recording on a sped-up clock, and runs the breaking-news watcher against it, writing packages to site/public/breaking
// (never published). Then `npm run dev` and open the player address it prints: the score bug, ticker and break-ins all
// follow the one clock.
// Usage: npm run replay [-- --from 17:15] [--speed 20] [--recording <name>] [--port 8788] [--ai] [--no-breaking]
//   --from HH:MM        where to start, UTC on the match day (default: the start of the recording, 16:30 for the
//                       committed Trabzonspor v Hearts; kick-off was 16:45)
//   --speed N           how much faster than real time (default 20)
//   --recording <name>  a full recording in pipeline/out/recordings/ (home PC) instead of the committed fixture
//   --port N            where live.json is served (default 8788; `npm run worker:dev` has 8787)
//   --ai                write the breaking news with Gemini Flash-Lite rather than plain lines
//   --no-breaking       just serve live.json

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetBreaking, watchBreaking, workerSource } from './breaking/index.ts';
import { openFixture, openRecording, replay } from './recording.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const club = JSON.parse(readFileSync(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as { bbc: { team: string } };
  const port = Number(opt('--port')) || 8788;
  const name = opt('--recording');
  const rec = name ? openRecording(name) : openFixture();
  const r = replay(rec, { team: club.bbc.team, from: opt('--from'), speed: Number(opt('--speed')) || 20 });
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
    await watchBreaking({ source: workerSource(url), pace: r.speed, persist: false, templates: !args.includes('--ai'), stop: r.over });
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
