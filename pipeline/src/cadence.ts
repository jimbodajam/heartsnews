// When the channel makes its next programme (the Worker's clock asks every minute, worker/src/clock.ts). Normally one
// per slot on the clock (:00 and :30); while our match is on, none at all (the break-ins carry it), except straight
// after half-time and full time, so the reaction is on air within minutes. After full time the slots resume.

import type { LiveFeed, LiveStatus } from '../../shared/live.ts';

/** A read of live.json older than this says nothing about now: BBC or the Worker has stopped answering. */
const STALE_MS = 10 * 60_000;

export type Reason = 'regular' | 'ht' | 'ft';

/** What the cadence remembers between runs of the clock (kept in the store). */
export interface CadenceState {
  kickOff?: string;
  status?: LiveStatus;
  /** When live.json was last read, by the clock `due` is given. */
  seenAt?: number;
  rebuild?: 'ht' | 'ft';
  /** The slot the last programme was made for. */
  slot?: number;
}

export class Cadence {
  state: CadenceState;
  private everyMs: number;

  constructor(everyMs: number, state: CadenceState = {}) {
    this.everyMs = everyMs;
    this.state = state;
  }

  /** Read in live.json as of `now` (ms). A change to half-time or full time calls for a programme. */
  see(feed: LiveFeed, now: number): void {
    const m = feed.match;
    const s = this.state;
    s.seenAt = now;
    if (!m) {
      s.status = undefined;
      return;
    }
    if (m.kickOff !== s.kickOff) s.rebuild = undefined;
    // Only a change seen happening: starting up at full time makes a programme anyway.
    else if (m.status !== s.status && (m.status === 'ht' || m.status === 'ft')) s.rebuild = m.status;
    s.kickOff = m.kickOff;
    s.status = m.status;
  }

  /** The match is on (or at half-time), as far as a fresh read says. */
  private on(now: number): boolean {
    return now - (this.state.seenAt ?? -Infinity) < STALE_MS && (this.state.status === 'live' || this.state.status === 'ht');
  }

  /** The start of the slot `now` falls in (ms). */
  slotOf(now: number): number {
    return Math.floor(now / this.everyMs) * this.everyMs;
  }

  /** Whether to make a programme at `now`, and why. Saying so takes the slot, so each slot gets one. */
  due(now: number): Reason | undefined {
    const s = this.state;
    const slot = this.slotOf(now);
    if (s.rebuild) {
      const r = s.rebuild;
      s.rebuild = undefined;
      s.slot = slot;
      return r;
    }
    if (this.on(now) || s.slot === slot) return undefined;
    s.slot = slot;
    return 'regular';
  }
}

/**
 * Whether a programme made for `reason` is still worth putting on air, given live.json now: one made at half-time
 * isn't once the second half is under way (the break-ins have moved on). Without a read, it goes out.
 */
export function stillWanted(reason: Reason, feed: LiveFeed | undefined): boolean {
  return reason !== 'ht' || feed?.match?.status !== 'live';
}
