// Keeps the channel on air from the home PC: snapshot → bulletin (GPU voices) → build → publish, then waits and
// goes again. GitHub Actions still runs as the fallback, but skips its build while this loop is publishing.
// Alongside it, the breaking-news watcher (breaking/) polls the Worker and puts out a package for every goal and red
// card, both kick-offs, half-time and full time. The two take turns to build and publish, so neither publishes a
// half-built site. While our match is on there are no regular programmes (the break-ins carry it): just one straight
// after half-time and one after full time (cadence.ts).
// Usage: npm run live [-- --every 30] [--once] [--templates] [--no-snapshot] [--no-breaking]
//   --every N       minutes between the start of each programme (default 30)
//   --once          make one programme and stop (no breaking news)
//   --templates     passed to the bulletin build (skip the AI writer), and plain lines for breaking news
//   --no-snapshot   don't refresh the snapshots branch first
//   --no-breaking   don't watch for goals and red cards

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishBreaking, watchBreaking, workerSource } from './breaking/index.ts';
import { Cadence, type Reason } from './cadence.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const every = Number(args[args.indexOf('--every') + 1]) || 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run an npm script from the repo root, streaming its output. Resolves true when it succeeded. */
function run(script: string, ...extra: string[]): Promise<boolean> {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn('npm', ['run', '--silent', script, ...(extra.length ? ['--', ...extra] : [])], { cwd: ROOT, stdio: 'inherit' });
    child.on('error', () => done(false));
    child.on('close', (code) => {
      const ok = code === 0;
      console.log(`[live] ${script} ${ok ? 'done' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s`);
      done(ok);
    });
  });
}

/** One at a time: building and publishing the site (a programme, or breaking news). */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const next = turn.then(job);
  turn = next.catch(() => undefined);
  return next;
}

const WHY: Record<Reason, string> = { regular: 'a new programme', ht: 'the half-time programme', ft: 'the full-time programme' };

/** Make a programme and put it on air, unless `wanted` says it's been overtaken by the time it's ready. */
async function programme(reason: Reason, wanted: () => boolean): Promise<boolean> {
  console.log(`\n[live] ${new Date().toLocaleString('en-GB')}: making ${WHY[reason]}`);
  // The snapshot keeps the GitHub fallback supplied with Kickback threads and transcripts; it isn't essential here.
  if (!flag('--no-snapshot')) await run('snapshot');
  if (!(await run('bulletin', ...(flag('--templates') ? ['--templates'] : [])))) return false;
  if (!wanted()) {
    console.log('[live] The second half is under way: not putting the half-time programme on air');
    return false;
  }
  // The build copies site/public, breaking news included, so a programme never takes a goal off air.
  return inTurn(async () => (await run('build')) && run('publish-site'));
}

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const cadence = new Cadence(every * 60_000);
  if (!flag('--once') && !flag('--no-breaking')) {
    void watchBreaking({
      source: workerSource(),
      publish: () => inTurn(publishBreaking),
      templates: flag('--templates'),
      onFeed: (feed) => cadence.see(feed, Date.now()),
    });
  }
  let reason: Reason = 'regular';
  for (;;) {
    const started = Date.now();
    const ok = await programme(reason, () => cadence.wanted(reason, Date.now()));
    if (flag('--once')) process.exit(ok ? 0 : 1);
    const next = new Date(Math.max(Date.now(), started + every * 60_000)).toLocaleTimeString('en-GB');
    console.log(`[live] ${ok ? 'On air' : 'Kept the previous programme on air'}; next at ${next}, or after half-time or full time while the match is on`);
    let due: Reason | undefined;
    // At least a minute between programmes; then check every 15s, so half-time and full time go straight out.
    await sleep(60_000);
    while (!(due = cadence.due(Date.now(), started))) await sleep(15_000);
    reason = due;
  }
}

main();
