// Publishes the built site (site/dist) to the repo's gh-pages branch, which GitHub Pages serves. Used both by the
// home PC (`npm run live`) and by the GitHub Actions fallback, so either can put a new programme on air.
// Each publish replaces the branch with a single commit, so it never grows.
// Usage: npm run build && npm run publish-site
// Auth: GITHUB_TOKEN in CI, otherwise the token from the GitHub CLI (`gh auth token`).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = resolve(ROOT, 'site/dist');
const BRANCH = 'gh-pages';

function repo(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT }).toString().trim();
  const m = /github\.com[:/](.+?)(\.git)?$/.exec(url);
  if (!m) throw new Error(`origin is not a GitHub repo: ${url}`);
  return m[1];
}

function token(): string {
  return process.env.GITHUB_TOKEN ?? execFileSync('gh', ['auth', 'token']).toString().trim();
}

export async function publishSite(builtBy: string): Promise<void> {
  if (!existsSync(resolve(DIST, 'index.html'))) throw new Error('site/dist is missing: run `npm run build` first');
  const dir = await mkdtemp(join(tmpdir(), 'heartsnews-pages-'));
  try {
    await cp(DIST, dir, { recursive: true });
    await writeFile(join(dir, '.nojekyll'), ''); // serve files as-is, no Jekyll processing
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('checkout', '-q', '-b', BRANCH);
    git('add', '-A');
    git('-c', 'user.name=Hearts News 24', '-c', 'user.email=heartsnews24@users.noreply.github.com', 'commit', '-q', '-m', `Publish (${builtBy}) ${new Date().toISOString()}`);
    git('push', '-q', '--force', `https://x-access-token:${token()}@github.com/${repo()}.git`, `${BRANCH}:${BRANCH}`);
    console.log(`Published site/dist to ${repo()}@${BRANCH} (${builtBy})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishSite(process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'home PC').catch((err) => {
    // Never print the token-bearing push URL.
    console.error(String((err as Error).message).replace(/x-access-token:[^@]+@/g, 'x-access-token:***@'));
    process.exit(1);
  });
}
