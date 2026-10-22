// Dev only: live.json replayed from the recording of Trabzonspor v Hearts (22 Oct 2026), sped up, to watch the live
// score in the ticker without a match on. ?live=replay[&from=17:15][&speed=20] (UTC time; kick-off was 16:45 UTC).
// For the Worker's code and the break-ins too, use `npm run replay` instead.

import club from '../../clubs/hearts.json';
import type { BbcData, BbcEvent } from '../../shared/bbc';
import { liveMatch } from '../../shared/live';
import recording from '../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json';
import type { FeedSource } from './live';

const rec = recording as unknown as { teamEvent: BbcEvent; snapshots: { at: string; page: BbcData }[] };

export function replaySource(from = '16:30', speed = 20): FeedSource {
  const start = Date.parse(`2026-10-22T${from.length === 5 ? `${from}:00` : from}Z`);
  const began = Date.now();
  return async () => {
    const now = new Date(start + (Date.now() - began) * speed);
    const snap = rec.snapshots.filter((s) => Date.parse(s.at) <= now.getTime()).pop() ?? rec.snapshots[0];
    return { updated: now.toISOString(), match: liveMatch(rec.teamEvent, club.bbc.team, snap.page) };
  };
}
