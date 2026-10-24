import { airings, type PresenterPrediction } from '../memory.ts';
import type { Story } from '../stories.ts';
import type { Draft } from './draft.ts';
import { teamName, type Facts } from './facts.ts';

/** What a bulletin adds to the channel's memory, for the store. */
export interface Remembered {
  aired: { title: string; storyline?: number; inDepth: boolean }[];
  takes: { presenter: string; topic: string; view: string }[];
  predictions: PresenterPrediction[];
}

/** After a bulletin is written: what aired, what the presenters said, and any predictions they made. */
export function remember(f: Facts, draft: Draft): Remembered {
  const all = [...f.pool, ...f.features, ...f.transfers];
  const byId = (id: string) => all.find((s) => s.id === id);
  const aired = new Map<string, Story>();
  for (const id of [...draft.headlines, ...draft.features, ...draft.transfers].map((x) => x.storyId)) {
    const s = byId(id);
    if (s) aired.set(s.id, s);
  }

  const at = f.now.toISOString();
  const predictions: PresenterPrediction[] = [];
  const next = f.nextFixtures[0];
  if (next && draft.debate) {
    // One prediction per presenter per match: the store replaces an earlier call with this one.
    const home = teamName(f.club, next.home);
    const away = teamName(f.club, next.away);
    for (const p of draft.debate.predictions) {
      predictions.push({ presenter: p.speaker, home, away, date: next.date, homeGoals: p.homeGoals, awayGoals: p.awayGoals, madeAt: at });
    }
  }

  return {
    aired: airings(f.memory, [...aired.values()], new Set(draft.features.map((x) => x.storyId))),
    takes: (draft.opinions ?? []).map((o) => ({ presenter: o.speaker, topic: o.topic, view: o.view })),
    predictions,
  };
}
