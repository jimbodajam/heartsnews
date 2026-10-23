// Publishes the built site (site/dist) to the repo's gh-pages branch, which GitHub Pages serves. Used by both runners,
// the home PC and GitHub Actions (jobs.ts), so either can put a programme or breaking news on air.
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

export function repo(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT }).toString().trim();
  const m = /github\.com[:/](.+?)(\.git)?$/.exec(url);
  if (!m) throw new Error(`origin is not a GitHub repo: ${url}`);
  return m[1];
}

export function token(): string {
  return process.env.GITHUB_TOKEN ?? execFileSync('gh', ['auth', 'token']).toString().trim();
}

/**
 * What's on air: unpacks the gh-pages branch (or just `path` in it) into `dir`. False if there's no such path there
 * yet; throws if the branch can't be fetched.
 */
export function pagesTree(dir: string, path?: string): boolean {
  execFileSync('git', ['fetch', '-q', '--depth=1', '--no-tags', 'origin', BRANCH], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let tar: Buffer;
  try {
    tar = execFileSync('git', ['archive', 'FETCH_HEAD', ...(path ? [path] : [])], { cwd: ROOT, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return false;
  }
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return true;
}

/** Publishes `from` (the built site by default) as the whole of gh-pages. */
export async function publishSite(builtBy: string, from = DIST): Promise<void> {
  if (!existsSync(resolve(from, 'index.html'))) throw new Error(`${from === DIST ? 'site/dist' : from} is missing: run \`npm run build\` first`);
  const dir = await mkdtemp(join(tmpdir(), 'heartsnews-pages-'));
  try {
    await cp(from, dir, { recursive: true });
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
