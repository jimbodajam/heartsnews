import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { YoutubeTranscript } from 'youtube-transcript';
import { decodeEntities } from '../text.ts';
import type { Item } from '../types.ts';

// Video transcripts from YouTube captions (usually auto-generated). YouTube refuses these requests from
// GitHub's servers, so they're fetched at home by `npm run snapshot` and published for the online build.

export interface Transcript {
  videoId: string;
  url: string;
  title: string;
  sourceId: string;
  publishedAt: string;
  text: string;
}

export interface TranscriptSnapshot {
  collectedAt: string;
  items: Transcript[];
}

/** Each video's transcript is fetched once and kept here (shared by `npm run snapshot` and local builds). */
export const TRANSCRIPT_CACHE = fileURLToPath(new URL('../../out/transcripts', import.meta.url));

/** Keeps the published file and prompts a sensible size; a 30-minute show is ~25k characters. */
const MAX_CHARS = 15_000;

export function videoId(url: string): string | undefined {
  return /[?&]v=([\w-]{11})/.exec(url)?.[1] ?? /youtu\.be\/([\w-]{11})/.exec(url)?.[1];
}

/** Caption text with stage directions ("[music]") and speaker-change marks (">>") removed. */
function clean(segments: { text: string }[]): string {
  return decodeEntities(decodeEntities(segments.map((s) => s.text).join(' ')))
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/>>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Transcripts for the given videos, using a local cache so each video is only fetched once.
 * Videos without usable captions (e.g. goal clips with only music) are skipped.
 */
export async function fetchTranscripts(videos: Item[], cacheDir: string): Promise<{ transcripts: Transcript[]; fetched: number; failed: number }> {
  await mkdir(cacheDir, { recursive: true });
  const transcripts: Transcript[] = [];
  let fetched = 0;
  let failed = 0;
  for (const v of videos) {
    const id = videoId(v.url);
    if (!id) continue;
    const cached = resolve(cacheDir, `${id}.json`);
    let text: string | undefined;
    if (existsSync(cached)) {
      text = (JSON.parse(await readFile(cached, 'utf8')) as { text: string }).text;
    } else {
      try {
        text = clean(await YoutubeTranscript.fetchTranscript(id, { lang: 'en' }));
        fetched++;
      } catch {
        text = '';
        failed++;
      }
      await writeFile(cached, JSON.stringify({ text }));
      await new Promise((r) => setTimeout(r, 500));
    }
    if (text.length < 300) continue;
    transcripts.push({
      videoId: id,
      url: v.url,
      title: v.title,
      sourceId: v.sourceId,
      publishedAt: v.publishedAt,
      text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text,
    });
  }
  return { transcripts, fetched, failed };
}

/**
 * Transcripts available to this build: the published snapshot (in CI, unpacked from the `snapshots` branch),
 * otherwise whatever the local cache has from earlier `npm run snapshot` runs.
 */
export async function loadTranscripts(snapshotFile: string, cacheDir: string): Promise<Transcript[]> {
  if (existsSync(snapshotFile)) return (JSON.parse(await readFile(snapshotFile, 'utf8')) as TranscriptSnapshot).items;
  if (!existsSync(cacheDir)) return [];
  const { readdir } = await import('node:fs/promises');
  const out: Transcript[] = [];
  for (const f of await readdir(cacheDir)) {
    const { text } = JSON.parse(await readFile(resolve(cacheDir, f), 'utf8')) as { text: string };
    if (text.length >= 300) {
      out.push({ videoId: f.replace(/\.json$/, ''), url: '', title: '', sourceId: '', publishedAt: '', text: text.slice(0, MAX_CHARS) });
    }
  }
  return out;
}

/** Put transcripts onto the matching video items. */
export function attachTranscripts(items: Item[], transcripts: Transcript[]): number {
  const byId = new Map(transcripts.map((t) => [t.videoId, t.text]));
  let attached = 0;
  for (const it of items) {
    const id = it.kind === 'video' ? videoId(it.url) : undefined;
    const text = id ? byId.get(id) : undefined;
    if (text) {
      it.transcript = text;
      attached++;
    }
  }
  return attached;
}
