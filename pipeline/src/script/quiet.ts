// Quiet slots (issue #50): when nothing on the desk has changed since the last programme, don't write the whole
// bulletin again. The news segments (and their voice clips) stay as they were; only the links between them are
// rewritten. This file decides which kind of build a slot gets, and swaps the new links into the last bulletin.

import type { Bulletin, DeskSignature, Line } from '../../../shared/bulletin.ts';
import type { Fixture } from '../types.ts';
import { dateKey } from '../time.ts';
import type { Draft } from './draft.ts';
import type { Facts } from './facts.ts';

/** The phase as one string: its kind, the fixture's date and teams, and the score once a result is in. */
function phaseKey(f: Facts): string {
  const p = f.phase;
  if (p.kind === 'normal') return 'normal';
  const x: Fixture = p.kind === 'reaction' ? p.result : p.fixture;
  const score = p.kind === 'reaction' ? ` ${x.homeScore}-${x.awayScore}` : '';
  return `${p.kind} ${x.date} ${x.home} v ${x.away}${score}`;
}

/** What a bulletin is built from, stored on it so the next slot can compare. */
export function deskSignature(f: Facts, draft: Draft, kind: DeskSignature['kind'] = 'full'): DeskSignature {
  return {
    features: f.features.map((s) => s.id),
    top: f.pool.slice(0, 4).map((s) => s.id),
    lead: f.pool[0]?.id,
    transfers: f.transfers.map((s) => s.id),
    aired: [...new Set([...draft.headlines, ...draft.features, ...draft.transfers].map((x) => x.storyId))],
    phase: phaseKey(f),
    day: dateKey(f.now),
    kind,
  };
}

export type QuietDecision = { partial: true; summary: string } | { partial: false; reason: string };

export interface QuietOptions {
  /** --full, --fresh or --templates: always a full build. */
  forced?: string;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a: string[], b: string[]) => same([...a].sort(), [...b].sort());

/** Whether this slot can rewrite just the links of the last bulletin, or needs a full build, and why. */
export function quietSlot(prev: Bulletin | undefined, f: Facts, opts: QuietOptions = {}): QuietDecision {
  const full = (reason: string): QuietDecision => ({ partial: false, reason });
  if (opts.forced) return full(`${opts.forced} was passed`);
  if (!prev) return full('no last programme to reuse');
  const was = prev.desk;
  if (!was) return full("the last programme doesn't record its running order");
  if (prev.generatedBy?.startsWith('templates')) return full('the last programme was written by templates');

  const now: Omit<DeskSignature, 'aired' | 'kind'> = {
    features: f.features.map((s) => s.id),
    top: f.pool.slice(0, 4).map((s) => s.id),
    lead: f.pool[0]?.id,
    transfers: f.transfers.map((s) => s.id),
    phase: phaseKey(f),
    day: dateKey(f.now),
  };
  if (f.phase.kind === 'live') return full('a match is live, and its lines carry the score and the time');
  if (now.day !== was.day) return full('a new UK day');
  if (now.phase !== was.phase) return full(`the matchday phase changed (${was.phase} → ${now.phase})`);

  const onAir = [...f.pool.slice(0, 4), ...f.features, ...f.transfers];
  const fresh = onAir.find((s) => s.storyline?.isNew);
  if (fresh) return full(`new claim on "${fresh.title}"`);

  if (!same(now.features, was.features)) return full('the in-depth packages changed');
  if (now.lead !== was.lead) return full('a different lead story');
  if (!sameSet(now.top, was.top)) return full('a different set of top stories');
  if (!sameSet(now.transfers, was.transfers)) return full('a different set of transfer stories');
  const inPool = new Set([...f.pool, ...f.features, ...f.transfers].map((s) => s.id));
  const gone = was.aired.find((id) => !inPool.has(id));
  if (gone) return full('a story the last programme aired has dropped out');

  return { partial: true, summary: `nothing new on the ${onAir.length} top stories, order unchanged` };
}

/** The new wording for each link in the last bulletin. `handovers` are by the id of the segment they lead into. */
export interface NewLinks {
  welcome?: string;
  comingUp?: string;
  handovers: { to: string; text: string; speaker?: string }[];
  outro?: string;
}

/**
 * The last bulletin with its link lines reworded. Every other line, with its clip, is left exactly as it was. A link
 * the writer didn't give keeps its old wording.
 */
export function swapLinks(prev: Bulletin, links: NewLinks): { bulletin: Bulletin; changed: Line[] } {
  const bulletin = structuredClone(prev);
  const changed: Line[] = [];
  const set = (line: Line, text: string | undefined, speaker?: string) => {
    if (!text || text.trim() === line.text) return;
    line.text = text.trim();
    if (speaker) line.speaker = speaker;
    delete line.audio;
    changed.push(line);
  };
  bulletin.segments.forEach((seg, i) => {
    // A hand-over sits at the end of the segment before the one it leads into.
    const into = bulletin.segments[i + 1]?.id;
    for (const line of seg.lines) {
      if (line.link === 'welcome') set(line, links.welcome);
      else if (line.link === 'comingUp') set(line, links.comingUp);
      else if (line.link === 'outro') set(line, links.outro);
      else if (line.link === 'handover') {
        const h = links.handovers.find((x) => x.to === into);
        // Only someone on screen in this segment can say it.
        set(line, h?.text, h?.speaker && seg.presenters.includes(h.speaker) ? h.speaker : undefined);
      }
    }
  });
  return { bulletin, changed };
}
