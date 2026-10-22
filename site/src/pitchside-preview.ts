// Dev only: ?scene=pitchside opens on a short demo segment with our reporter at the ground, so the scene can be looked
// at without waiting for a goal. Add &live=replay&from=17:30 for the Trabzonspor crowd and venue, &night=0 or 1 to
// force the floodlights. The score card is the recorded match's final score.

import channel from '../../channel.json';
import club from '../../clubs/hearts.json';
import type { BbcData, BbcEvent } from '../../shared/bbc';
import type { Bulletin, Presenter, Segment } from '../../shared/bulletin';
import { liveMatch } from '../../shared/live';
import recording from '../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json';

export const PREVIEW_SEGMENT = 'pitchside-preview';

const rec = recording as unknown as { teamEvent: BbcEvent; snapshots: { at: string; page: BbcData }[] };

export function withPitchside(b: Bulletin): Bulletin {
  const reporter = channel.presenters.find((p) => p.id === channel.cast.pitchside) as Presenter;
  const m = liveMatch(rec.teamEvent, club.bbc.team, rec.snapshots[rec.snapshots.length - 1].page);
  const scorers = (side: 'home' | 'away') => m.events.filter((e) => e.kind === 'goal' && e.side === side).map((e) => `${e.player} ${e.minute}`);
  const seg: Segment = {
    id: PREVIEW_SEGMENT,
    kind: 'match',
    title: 'Live from the ground',
    strap: 'Pitchside preview',
    scene: 'pitchside',
    presenters: [reporter.id],
    lines: [
      { speaker: reporter.id, text: "Thanks, Isla. It's a cold one here, but the home fans have been making a racket since long before kick-off." },
      {
        speaker: reporter.id,
        text: "Here's how it stands, and I'll be honest, the pies are better than the football so far. Back to you in the studio.",
        graphic: {
          type: 'result', home: m.home.name, away: m.away.name, homeScore: m.home.score ?? 0, awayScore: m.away.score ?? 0,
          competition: m.competition, status: 'FULL TIME', homeScorers: scorers('home'), awayScorers: scorers('away'),
        },
      },
    ],
  };
  return {
    ...b,
    presenters: b.presenters.some((p) => p.id === reporter.id) ? b.presenters : [...b.presenters, reporter],
    segments: [seg, ...b.segments.filter((s) => s.id !== PREVIEW_SEGMENT)],
  };
}
