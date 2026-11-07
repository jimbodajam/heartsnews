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

let token: string | undefined;
async function api<T>(repo: string, path: string, method: string, body?: object): Promise<T> {
  token ??= execFileSync('gh', ['auth', 'token']).toString().trim();
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && !(method === 'GET' && res.status === 404)) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (res.status === 404 ? undefined : await res.json()) as T;
}

/** A file as it stands on the snapshots branch now, or undefined if it isn't there (or can't be read). */
async function previous(repo: string, path: string): Promise<string | undefined> {
  try {
    const blob = await api<{ content: string; encoding: string } | undefined>(repo, `/contents/${path}?ref=${BRANCH}`, 'GET');
    return blob ? Buffer.from(blob.content, blob.encoding as BufferEncoding).toString('utf8') : undefined;
  } catch (err) {
    console.warn(`  couldn't read the previous ${path}: ${(err as Error).message}`);
    return undefined;
  }
}

/** Replace the branch's contents with `files` as a single commit (no history, so the branch never grows). */
async function publish(repo: string, files: Record<string, string>, message: string): Promise<void> {
  const tree = await api<{ sha: string }>(repo, '/git/trees', 'POST', {
    tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
  });
  const commit = await api<{ sha: string }>(repo, '/git/commits', 'POST', { message, tree: tree.sha, parents: [] });
  const existing = await api<{ object: { sha: string } } | undefined>(repo, `/git/ref/heads/${BRANCH}`, 'GET');
  if (existing) await api(repo, `/git/refs/heads/${BRANCH}`, 'PATCH', { sha: commit.sha, force: true });
  else await api(repo, '/git/refs', 'POST', { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
}

async function main() {
  const club = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as ClubConfig;
  const now = new Date();
  const repo = githubRepo();
  const files: Record<string, string> = {};
  const failures: string[] = [];

  // One source failing (a feed 404s, a site times out) must not stop the others. The branch is replaced
  // wholesale on publish, so a failed source carries its previous file over instead of losing it.
  for (const src of club.sources.filter((s) => s.snapshot && s.enabled !== false)) {
    const path = `${src.id}.json`;
    try {
      const items = await collectOne(src, club, now);
      const snap: Snapshot = { collectedAt: now.toISOString(), items };
      files[path] = `${JSON.stringify(snap, null, 2)}\n`;
      console.log(`  ✔ ${src.name.padEnd(30)} ${items.length} items`);
    } catch (err) {
      failures.push(src.name);
      const old = await previous(repo, path);
      if (old) files[path] = old;
      console.log(`  ✘ ${src.name.padEnd(30)} ${(err as Error).message}${old ? ' (keeping the previous snapshot)' : ''}`);
    }
  }

  // Transcripts for the past week's videos on channels marked "transcripts".
  const videos = [];
  const failedChannels = new Set<string>();
  for (const src of club.sources.filter((s) => s.transcripts && s.enabled !== false)) {
    try {
      videos.push(...(await collectOne({ ...src, maxAgeDays: 7 }, club, now)));
    } catch (err) {
      failures.push(src.name);
      failedChannels.add(src.id);
      console.log(`  ✘ ${src.name.padEnd(30)} ${(err as Error).message} (keeping its previous transcripts)`);
    }
  }
  if (videos.length || failedChannels.size) {
    const { transcripts, fetched, failed } = await fetchTranscripts(videos, TRANSCRIPT_CACHE);
    // A channel whose feed failed this time keeps the transcripts it had in the last snapshot.
    let kept = 0;
    if (failedChannels.size) {
      const old = await previous(repo, 'transcripts.json');
      const carried = old ? (JSON.parse(old) as TranscriptSnapshot).items.filter((t) => failedChannels.has(t.sourceId)) : [];
      transcripts.push(...carried);
      kept = carried.length;
    }
    const snap: TranscriptSnapshot = { collectedAt: now.toISOString(), items: transcripts };
    files['transcripts.json'] = `${JSON.stringify(snap, null, 2)}\n`;
    console.log(
      `  ✔ ${'Video transcripts'.padEnd(30)} ${transcripts.length - kept} of ${videos.length} videos (${fetched} new, ${failed} without captions)` +
        (kept ? `, ${kept} kept from the last snapshot` : ''),
    );
  }
  if (!Object.keys(files).length) {
    if (failures.length) throw new Error(`every source failed: ${failures.join(', ')}`);
    return console.log('No sources are marked "snapshot" or "transcripts" in the club config.');
  }

  await publish(repo, files, `Home snapshot ${now.toISOString()}`);
  console.log(`Published to ${repo}@${BRANCH}${failures.length ? ` (failed: ${failures.join(', ')})` : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
