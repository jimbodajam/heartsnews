// Keeps the channel on air from the home PC: snapshot → bulletin (GPU voices) → build → publish, then waits and
// goes again. GitHub Actions still runs as the fallback, but skips its build while this loop is publishing.
// Usage: npm run live [-- --every 30] [--once] [--templates] [--no-snapshot]
//   --every N       minutes between the start of each programme (default 30)
//   --once          make one programme and stop
//   --templates     passed to the bulletin build (skip the AI writer)
//   --no-snapshot   don't refresh the snapshots branch first

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const every = Number(args[args.indexOf('--every') + 1]) || 30;

/** Run an npm script from the repo root, streaming its output. Returns true when it succeeded. */
function run(script: string, ...extra: string[]): boolean {
  const started = Date.now();
  const res = spawnSync('npm', ['run', '--silent', script, ...(extra.length ? ['--', ...extra] : [])], { cwd: ROOT, stdio: 'inherit' });
  const ok = res.status === 0;
  console.log(`[live] ${script} ${ok ? 'done' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s`);
  return ok;
}

function programme(): boolean {
  console.log(`\n[live] ${new Date().toLocaleString('en-GB')}: making a new programme`);
  // The snapshot keeps the GitHub fallback supplied with Kickback threads and transcripts; it isn't essential here.
  if (!flag('--no-snapshot')) run('snapshot');
  if (!run('bulletin', ...(flag('--templates') ? ['--templates'] : []))) return false;
  return run('build') && run('publish-site');
}

async function main() {
  for (;;) {
    const started = Date.now();
    const ok = programme();
    if (flag('--once')) process.exit(ok ? 0 : 1);
    const wait = Math.max(60_000, started + every * 60_000 - Date.now());
    console.log(`[live] ${ok ? 'On air' : 'Kept the previous programme on air'}; next at ${new Date(Date.now() + wait).toLocaleTimeString('en-GB')}`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

main();
