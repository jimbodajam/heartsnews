import { presenterMemory, recordAired } from '../memory.ts';
import type { Story } from '../stories.ts';
import type { Draft } from './draft.ts';
import { teamName, type Facts } from './facts.ts';

/** After a bulletin is written: note what aired, what the presenters said, and any predictions they made. */
export function remember(f: Facts, draft: Draft): void {
  const { memory, now } = f;
  const all = [...f.pool, ...f.features, ...f.transfers];
  const byId = (id: string) => all.find((s) => s.id === id);
  const aired = new Map<string, Story>();
  for (const id of [...draft.headlines, ...draft.features, ...draft.transfers].map((x) => x.storyId)) {
    const s = byId(id);
    if (s) aired.set(s.id, s);
  }
  recordAired(memory, [...aired.values()], new Set(draft.features.map((x) => x.storyId)), now);

  const at = now.toISOString();
  for (const o of draft.opinions ?? []) presenterMemory(memory, o.speaker).opinions.push({ topic: o.topic, view: o.view, at });

  const next = f.nextFixtures[0];
  if (next && draft.debate) {
    for (const p of draft.debate.predictions) {
      const pm = presenterMemory(memory, p.speaker);
      const home = teamName(f.club, next.home);
      const away = teamName(f.club, next.away);
      // One prediction per presenter per match: a later bulletin's call replaces the earlier one.
      pm.predictions = pm.predictions.filter((x) => !(x.home === home && x.away === away && x.date === next.date));
      pm.predictions.push({ home, away, date: next.date, homeGoals: p.homeGoals, awayGoals: p.awayGoals, madeAt: at });
    }
  }
}
