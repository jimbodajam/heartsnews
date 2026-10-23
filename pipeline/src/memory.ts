import { sameStory, tokens, type Story } from './stories.ts';

// The channel's memory between bulletins: what has been on air, and what each presenter has said and predicted.
// It lives in the store (store.ts); each build reads this summary of it at the start and writes what's new at the end.

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

/** A presenter's prediction, with who made it, for writing to the store. */
export type PresenterPrediction = Prediction & { presenter: string };

export const emptyMemory = (): Memory => ({ version: 1, updatedAt: new Date(0).toISOString(), aired: [], presenters: {} });

export function findAired(memory: Memory, title: string): AiredStory | undefined {
  const t = tokens(title);
  return memory.aired.find((a) => sameStory(tokens(a.title), t));
}

/**
 * Score multiplier for a story that has been on recently. Like rolling news, a big story keeps coming back:
 * just after airing it drops to 40%, recovers to ~70% after an hour and ~90% after three, so other stories get
 * their turn in between. Many airings add a little fatigue, and fresh coverage since it last aired lifts the
 * cooldown entirely (it's a genuine update).
 */
export function freshness(memory: Memory, story: Story, now: Date): number {
  const a = findAired(memory, story.title);
  if (!a) return 1;
  const fatigue = Math.max(0.6, 1 - 0.04 * a.times);
  if (story.latest > a.lastAired) return fatigue;
  const hours = (now.getTime() - Date.parse(a.lastAired)) / 3_600_000;
  return (1 - 0.6 * Math.exp(-hours / 1.5)) * fatigue;
}

/**
 * The airings to record for these stories. A story already on air keeps the title it first aired under, so its
 * airings add up under one name however the headline changes.
 */
export function airings(memory: Memory, stories: Story[], inDepth: Set<string>): { title: string; inDepth: boolean }[] {
  return stories.map((s) => ({ title: findAired(memory, s.title)?.title ?? s.title, inDepth: inDepth.has(s.id) }));
}

/** Mark predictions right or wrong once the result is in, returning the ones settled. `results` use on-air team names. */
export function settlePredictions(
  memory: Memory,
  results: { home: string; away: string; date: string; homeScore?: number; awayScore?: number }[],
): PresenterPrediction[] {
  const settled: PresenterPrediction[] = [];
  for (const [presenter, pm] of Object.entries(memory.presenters)) {
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
      settled.push({ ...p, presenter });
    }
  }
  return settled;
}

/** "3 right (1 exact) from 5" style summary of settled predictions. */
export function predictionRecord(pm: PresenterMemory): string | undefined {
  const settled = pm.predictions.filter((p) => p.outcome);
  if (!settled.length) return undefined;
  const right = settled.filter((p) => p.outcome !== 'wrong').length;
  const exact = settled.filter((p) => p.outcome === 'exact').length;
  return `${right} right${exact ? ` (${exact} exact)` : ''} from ${settled.length}`;
}
