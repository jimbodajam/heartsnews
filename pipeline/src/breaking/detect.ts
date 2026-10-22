// Spots new goals and red cards, kick-offs, half-time and full time in successive reads of live.json, and says when
// each is ready to build a package for: once BBC's live text describes it, or after DESCRIPTION_WAIT_MS without (then
// the line stays plain).

import type { Period } from '../../../shared/breaking.ts';
import type { LiveEvent, LiveMatch, LivePost } from '../../../shared/live.ts';
import { minuteOf } from '../reading.ts';

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

export interface ReadyPeriod {
  key: string;
  period: Period;
  match: LiveMatch;
  /** BBC's kick-off, half-time or full-time post: empty if it never came. */
  text: string[];
}

/** The periods a match has reached, in order. The second half is under way once the clock reads 46'. */
export function periodsReached(m: LiveMatch): Period[] {
  if (m.status === 'pre' || m.status === 'postponed') return [];
  const second = m.status === 'ft' || (m.status === 'live' && minuteOf(m.clock ?? '') >= 46);
  return ['ko1', ...(m.status === 'ht' || second ? ['ht' as const] : []), ...(second ? ['ko2' as const] : []), ...(m.status === 'ft' ? ['ft' as const] : [])];
}

/**
 * BBC's posts for a period, oldest first. KICK_OFF posts are split into halves by the HALF_TIME post (or by the
 * minute, 46' and on being the second half); the first half's can include a pre-match one about the team news.
 */
export function periodPosts(m: LiveMatch, period: Period): LivePost[] {
  const posts = [...m.posts].reverse();
  const ht = posts.find((p) => p.code === 'HALF_TIME');
  const secondHalf = (p: LivePost) => minuteOf(p.minute ?? '') >= 46 || (ht !== undefined && p.at > ht.at);
  if (period === 'ko1') return posts.filter((p) => p.code === 'KICK_OFF' && !secondHalf(p));
  if (period === 'ko2') return posts.filter((p) => p.code === 'KICK_OFF' && secondHalf(p));
  return posts.filter((p) => p.code === (period === 'ht' ? 'HALF_TIME' : 'FULL_TIME'));
}

const periodKey = (p: Period) => `period:${p}`;

type Pending = { since: number; text: string; changed: number };

/** Whether text that's been waiting since `p` is worth going with now. Updates `p` when the text has changed. */
function ready(p: Pending, paras: string[], now: number): boolean {
  const text = paras.join('\n');
  if (p.text !== text) Object.assign(p, { text, changed: now });
  const settled = paras.length >= 2 || (paras.length === 1 && now - p.changed >= SETTLE_MS);
  return settled || now - p.since >= DESCRIPTION_WAIT_MS;
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
  /** Events and periods seen but not built yet: when first seen, and their text when it last changed. */
  private pending = new Map<string, Pending>();
  private pendingPeriod = new Map<string, Pending>();
  state: TrackerState;

  constructor(state: TrackerState = { done: [] }) {
    this.state = state;
  }

  private see(m: LiveMatch): void {
    if (this.state.kickOff === m.kickOff) return;
    // A new match. If it's already under way (the PC started mid-match), what's happened so far is old news.
    const old = m.status === 'pre' ? [] : [...eventKeys(m.events).map((e) => e.key), ...periodsReached(m).map(periodKey)];
    this.state = { kickOff: m.kickOff, done: old };
    this.pending.clear();
    this.pendingPeriod.clear();
  }

  /** Read in live.json's match as of `now` (ms); returns the events to build packages for now. */
  update(m: LiveMatch, now: number): ReadyEvent[] {
    this.see(m);
    const events = eventKeys(m.events);
    const out: ReadyEvent[] = [];
    for (const { key, event } of events) {
      if (this.state.done.includes(key)) continue;
      const paras = event.post?.text ?? [];
      let p = this.pending.get(key);
      if (!p) this.pending.set(key, (p = { since: now, text: '', changed: now }));
      if (!ready(p, paras, now)) continue;
      out.push({ key, event, match: m, text: paras });
      this.state.done.push(key);
      this.pending.delete(key);
    }
    // A goal that's gone (ruled out after all) is no longer waiting.
    for (const key of this.pending.keys()) if (!events.some((e) => e.key === key)) this.pending.delete(key);
    return out;
  }

  /**
   * The kick-off, half-time or full-time break-in to build now, if any. Only the latest period reached is news: one
   * still waiting when the next comes round (or missed while the PC was off) is dropped.
   */
  period(m: LiveMatch, now: number): ReadyPeriod | undefined {
    this.see(m);
    const reached = periodsReached(m);
    const period = reached[reached.length - 1];
    for (const key of reached.slice(0, -1).map(periodKey)) {
      if (!this.state.done.includes(key)) this.state.done.push(key);
      this.pendingPeriod.delete(key);
    }
    if (!period) return undefined;
    const key = periodKey(period);
    if (this.state.done.includes(key)) return undefined;
    const paras = periodPosts(m, period).flatMap((p) => p.text);
    let p = this.pendingPeriod.get(key);
    if (!p) this.pendingPeriod.set(key, (p = { since: now, text: '', changed: now }));
    if (!ready(p, paras, now)) return undefined;
    this.state.done.push(key);
    this.pendingPeriod.delete(key);
    return { key, period, match: m, text: paras };
  }
}
