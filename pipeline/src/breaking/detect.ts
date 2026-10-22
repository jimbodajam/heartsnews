// Spots new goals and red cards in successive reads of live.json, and says when each is ready to build a package
// for: once BBC's live text describes it, or after DESCRIPTION_WAIT_MS without (then the line stays plain).

import type { LiveEvent, LiveMatch } from '../../../shared/live.ts';

/** How long to wait for BBC's description of an event before going with a plain line. */
export const DESCRIPTION_WAIT_MS = 2 * 60_000;
/**
 * BBC often posts a one-line reaction first ("Goodness me, what a goal that is.") and the description a minute
 * later, so a single paragraph only counts once it has stood this long. Two paragraphs are taken straight away.
 */
const SETTLE_MS = 45_000;

export interface ReadyEvent {
  key: string;
  event: LiveEvent;
  match: LiveMatch;
  /** BBC's description: empty if it never came. */
  text: string[];
}

/** What's been handled, kept on disk so a restart mid-match doesn't break in again for old goals. */
export interface TrackerState {
  kickOff?: string;
  done: string[];
}

/**
 * A stable name for each confirmed event: kind, side, player and which of theirs it is ("goal:home:Mohamed Salah:1"),
 * so it survives BBC filling in the minute later. Unconfirmed goals (VAR) get none until they stand.
 */
export function eventKeys(events: LiveEvent[]): { key: string; event: LiveEvent }[] {
  const count = new Map<string, number>();
  return events
    .filter((e) => !e.unconfirmed)
    .map((event) => {
      const base = `${event.kind}:${event.side}:${event.player}`;
      const n = (count.get(base) ?? 0) + 1;
      count.set(base, n);
      return { key: `${base}:${n}`, event };
    });
}

export class EventTracker {
  /** Events seen but not built yet: when first seen, and their text when it last changed. */
  private pending = new Map<string, { since: number; text: string; changed: number }>();
  state: TrackerState;

  constructor(state: TrackerState = { done: [] }) {
    this.state = state;
  }

  /** Read in live.json's match as of `now` (ms); returns the events to build packages for now. */
  update(m: LiveMatch, now: number): ReadyEvent[] {
    const events = eventKeys(m.events);
    if (this.state.kickOff !== m.kickOff) {
      // A new match. If it's already under way (the PC started mid-match), what's happened so far is old news.
      this.state = { kickOff: m.kickOff, done: m.status === 'pre' ? [] : events.map((e) => e.key) };
      this.pending.clear();
    }
    const ready: ReadyEvent[] = [];
    for (const { key, event } of events) {
      if (this.state.done.includes(key)) continue;
      const paras = event.post?.text ?? [];
      const text = paras.join('\n');
      let p = this.pending.get(key);
      if (!p) this.pending.set(key, (p = { since: now, text, changed: now }));
      else if (p.text !== text) Object.assign(p, { text, changed: now });
      const settled = paras.length >= 2 || (paras.length === 1 && now - p.changed >= SETTLE_MS);
      if (!settled && now - p.since < DESCRIPTION_WAIT_MS) continue;
      ready.push({ key, event, match: m, text: paras });
      this.state.done.push(key);
      this.pending.delete(key);
    }
    // A goal that's gone (ruled out after all) is no longer waiting.
    for (const key of this.pending.keys()) if (!events.some((e) => e.key === key)) this.pending.delete(key);
    return ready;
  }
}
