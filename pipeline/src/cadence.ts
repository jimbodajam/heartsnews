// When `npm run live` makes its next programme. Normally every so often; while our match is on, not at all (the
// break-ins carry it), except straight after half-time and full time, so the reaction is on air within minutes.
// After full time the usual cadence resumes.

import type { LiveFeed, LiveStatus } from '../../shared/live.ts';

/** A read of live.json older than this says nothing about now: the Worker or the watcher has stopped. */
const STALE_MS = 10 * 60_000;

export type Reason = 'regular' | 'ht' | 'ft';

export class Cadence {
  private kickOff?: string;
  private status?: LiveStatus;
  /** When live.json was last read, by the clock `due` is given. */
  private seenAt = -Infinity;
  private rebuild?: 'ht' | 'ft';
  private everyMs: number;

  constructor(everyMs: number) {
    this.everyMs = everyMs;
  }

  /** Read in live.json as of `now` (ms). A change to half-time or full time calls for a programme. */
  see(feed: LiveFeed, now: number): void {
    const m = feed.match;
    this.seenAt = now;
    if (!m) {
      this.status = undefined;
      return;
    }
    if (m.kickOff !== this.kickOff) this.rebuild = undefined;
    // Only a change seen happening: starting up at full time makes a programme anyway.
    else if (m.status !== this.status && (m.status === 'ht' || m.status === 'ft')) this.rebuild = m.status;
    this.kickOff = m.kickOff;
    this.status = m.status;
  }

  /** The match is on (or at half-time), as far as a fresh read says. */
  private on(now: number): boolean {
    return now - this.seenAt < STALE_MS && (this.status === 'live' || this.status === 'ht');
  }

  /** Whether to start a programme at `now`, given when the last one started, and why. */
  due(now: number, lastStarted: number): Reason | undefined {
    if (this.rebuild) {
      const r = this.rebuild;
      this.rebuild = undefined;
      return r;
    }
    if (this.on(now)) return undefined;
    return now - lastStarted >= this.everyMs ? 'regular' : undefined;
  }

  /**
   * Whether a programme started for `reason` is still worth putting on air at `now`: one made at half-time isn't
   * once the second half is under way (the break-ins have moved on).
   */
  wanted(reason: Reason, now: number): boolean {
    return reason !== 'ht' || this.status === 'ht' || !this.on(now);
  }
}
