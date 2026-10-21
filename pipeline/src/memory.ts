import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { sameStory, tokens, type Story } from './stories.ts';

// The channel's memory between bulletins: what has been on air, and what each presenter has said and predicted.
// It is published with the site as memory.json, and each build starts from the live copy, so it survives
// GitHub's throwaway build machines without needing write access to the repo.

export interface AiredStory {
  title: string;
  firstAired: string;
  lastAired: string;
  times: number;
  inDepth: number;
}

export interface Opinion {
  topic: string;
  view: string;
  at: string;
}

export interface Prediction {
  home: string;
  away: string;
  date: string; // kick-off, ISO
  homeGoals: number;
  awayGoals: number;
  madeAt: string;
  outcome?: 'exact' | 'right' | 'wrong';
  actual?: string;
}

export interface PresenterMemory {
  opinions: Opinion[];
  predictions: Prediction[];
}

export interface Memory {
  version: 1;
  updatedAt: string;
  aired: AiredStory[];
  presenters: Record<string, PresenterMemory>;
}

const DAY_MS = 86_400_000;

export const emptyMemory = (): Memory => ({ version: 1, updatedAt: new Date(0).toISOString(), aired: [], presenters: {} });

/** Latest memory: the live site's copy if reachable, else a local file, else a blank slate. */
export async function loadMemory(url: string | undefined, localPath: string): Promise<{ memory: Memory; from: string }> {
  if (url) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const m = (await res.json()) as Memory;
        if (m.version === 1) return { memory: m, from: url };
      }
    } catch {
      // Fall through to the local copy.
    }
  }
  if (existsSync(localPath)) {
    const m = JSON.parse(await readFile(localPath, 'utf8')) as Memory;
    if (m.version === 1) return { memory: m, from: localPath };
  }
  return { memory: emptyMemory(), from: 'new' };
}

export function presenterMemory(memory: Memory, id: string): PresenterMemory {
  memory.presenters[id] ??= { opinions: [], predictions: [] };
  return memory.presenters[id];
}

export function findAired(memory: Memory, title: string): AiredStory | undefined {
  const t = tokens(title);
  return memory.aired.find((a) => sameStory(tokens(a.title), t));
}

/**
 * Score multiplier so the channel moves on: each airing halves a story's weight, unless it has fresh
 * coverage since it was last on, in which case it stays reasonably high (it's a genuine update).
 */
export function freshness(memory: Memory, story: Story): number {
  const a = findAired(memory, story.title);
  if (!a) return 1;
  const penalty = 0.5 ** a.times;
  return story.latest > a.lastAired ? Math.max(penalty, 0.7) : penalty;
}

export function recordAired(memory: Memory, stories: Story[], inDepth: Set<string>, now: Date): void {
  const at = now.toISOString();
  for (const s of stories) {
    const a = findAired(memory, s.title);
    if (a) {
      a.times++;
      a.lastAired = at;
      if (inDepth.has(s.id)) a.inDepth++;
    } else {
      memory.aired.push({ title: s.title, firstAired: at, lastAired: at, times: 1, inDepth: inDepth.has(s.id) ? 1 : 0 });
    }
  }
}

/** Mark predictions right or wrong once the result is in. `results` use on-air team names. */
export function settlePredictions(memory: Memory, results: { home: string; away: string; date: string; homeScore?: number; awayScore?: number }[]): void {
  for (const pm of Object.values(memory.presenters)) {
    for (const p of pm.predictions) {
      if (p.outcome) continue;
      const r = results.find(
        (x) => x.home === p.home && x.away === p.away && Math.abs(Date.parse(x.date) - Date.parse(p.date)) < 2 * DAY_MS,
      );
      if (!r || r.homeScore === undefined || r.awayScore === undefined) continue;
      const sign = (n: number) => Math.sign(n);
      p.actual = `${r.homeScore}-${r.awayScore}`;
      p.outcome =
        r.homeScore === p.homeGoals && r.awayScore === p.awayGoals
          ? 'exact'
          : sign(r.homeScore - r.awayScore) === sign(p.homeGoals - p.awayGoals)
            ? 'right'
            : 'wrong';
    }
  }
}

/** "3 right (1 exact) from 5" style summary of settled predictions. */
export function predictionRecord(pm: PresenterMemory): string | undefined {
  const settled = pm.predictions.filter((p) => p.outcome);
  if (!settled.length) return undefined;
  const right = settled.filter((p) => p.outcome !== 'wrong').length;
  const exact = settled.filter((p) => p.outcome === 'exact').length;
  return `${right} right${exact ? ` (${exact} exact)` : ''} from ${settled.length}`;
}

/** Keep memory small: a week of airings, and each presenter's latest opinions and predictions. */
export function trimMemory(memory: Memory, now: Date): void {
  memory.aired = memory.aired
    .filter((a) => now.getTime() - Date.parse(a.lastAired) < 7 * DAY_MS)
    .sort((a, b) => b.lastAired.localeCompare(a.lastAired))
    .slice(0, 80);
  for (const pm of Object.values(memory.presenters)) {
    pm.opinions = pm.opinions.slice(-15);
    pm.predictions = pm.predictions.slice(-15);
  }
  memory.updatedAt = now.toISOString();
}
