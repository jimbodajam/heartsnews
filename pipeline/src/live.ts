// Keeps the channel on air from the home PC: snapshot → bulletin (GPU voices) → build → publish, then waits and
// goes again. GitHub Actions still runs as the fallback, but skips its build while this loop is publishing.
// Alongside it, the breaking-news watcher (breaking/) polls the Worker and puts out a package for every goal and red
// card. The two take turns to build and publish, so neither publishes a half-built site.
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

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const every = Number(args[args.indexOf('--every') + 1]) || 30;

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

async function programme(): Promise<boolean> {
  console.log(`\n[live] ${new Date().toLocaleString('en-GB')}: making a new programme`);
  // The snapshot keeps the GitHub fallback supplied with Kickback threads and transcripts; it isn't essential here.
  if (!flag('--no-snapshot')) await run('snapshot');
  if (!(await run('bulletin', ...(flag('--templates') ? ['--templates'] : [])))) return false;
  // The build copies site/public, breaking news included, so a programme never takes a goal off air.
  return inTurn(async () => (await run('build')) && run('publish-site'));
}

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  if (!flag('--once') && !flag('--no-breaking')) {
    void watchBreaking({ source: workerSource(), publish: () => inTurn(publishBreaking), templates: flag('--templates') });
  }
  for (;;) {
    const started = Date.now();
    const ok = await programme();
    if (flag('--once')) process.exit(ok ? 0 : 1);
    const wait = Math.max(60_000, started + every * 60_000 - Date.now());
    console.log(`[live] ${ok ? 'On air' : 'Kept the previous programme on air'}; next at ${new Date(Date.now() + wait).toLocaleTimeString('en-GB')}`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

main();
