// Collects the sources that block GitHub's servers (marked "snapshot" in the club config, e.g. the Kickback)
// plus YouTube transcripts (channels marked "transcripts") from a home connection, and publishes them to the
// repo's `snapshots` branch. The scheduled build reads
// that branch whenever its own fetch of those sources is refused.
// Usage: npm run snapshot   (needs the GitHub CLI `gh` logged in; run it as often as you like)

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectOne, type Snapshot } from './collectors/index.ts';
import { fetchTranscripts, TRANSCRIPT_CACHE, type TranscriptSnapshot } from './collectors/transcripts.ts';
import type { ClubConfig } from './types.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BRANCH = 'snapshots';

function githubRepo(): string {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT }).toString().trim();
  const m = /github\.com[:/](.+?)(\.git)?$/.exec(url);
  if (!m) throw new Error(`origin is not a GitHub repo: ${url}`);
  return m[1];
}

/** Replace the branch's contents with `files` as a single commit (no history, so the branch never grows). */
async function publish(repo: string, files: Record<string, string>, message: string): Promise<void> {
  const token = execFileSync('gh', ['auth', 'token']).toString().trim();
  const api = async <T>(path: string, method: string, body?: object): Promise<T> => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !(method === 'GET' && res.status === 404)) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return (res.status === 404 ? undefined : await res.json()) as T;
  };

  const tree = await api<{ sha: string }>('/git/trees', 'POST', {
    tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
  });
  const commit = await api<{ sha: string }>('/git/commits', 'POST', { message, tree: tree.sha, parents: [] });
  const existing = await api<{ object: { sha: string } } | undefined>(`/git/ref/heads/${BRANCH}`, 'GET');
  if (existing) await api(`/git/refs/heads/${BRANCH}`, 'PATCH', { sha: commit.sha, force: true });
  else await api('/git/refs', 'POST', { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
}

async function main() {
  const club = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as ClubConfig;
  const now = new Date();
  const files: Record<string, string> = {};

  for (const src of club.sources.filter((s) => s.snapshot && s.enabled !== false)) {
    const items = await collectOne(src, club, now);
    const snap: Snapshot = { collectedAt: now.toISOString(), items };
    files[`${src.id}.json`] = `${JSON.stringify(snap, null, 2)}\n`;
    console.log(`  ✔ ${src.name.padEnd(30)} ${items.length} items`);
  }

  // Transcripts for the past week's videos on channels marked "transcripts".
  const videos = [];
  for (const src of club.sources.filter((s) => s.transcripts && s.enabled !== false)) {
    videos.push(...(await collectOne({ ...src, maxAgeDays: 7 }, club, now)));
  }
  if (videos.length) {
    const { transcripts, fetched, failed } = await fetchTranscripts(videos, TRANSCRIPT_CACHE);
    const snap: TranscriptSnapshot = { collectedAt: now.toISOString(), items: transcripts };
    files['transcripts.json'] = `${JSON.stringify(snap, null, 2)}\n`;
    console.log(`  ✔ ${'Video transcripts'.padEnd(30)} ${transcripts.length} of ${videos.length} videos (${fetched} new, ${failed} without captions)`);
  }
  if (!Object.keys(files).length) return console.log('No sources are marked "snapshot" or "transcripts" in the club config.');

  const repo = githubRepo();
  await publish(repo, files, `Home snapshot ${now.toISOString()}`);
  console.log(`Published to ${repo}@${BRANCH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
