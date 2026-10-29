// Spots the team news, new goals and red cards, kick-offs, half-time and full time in successive reads of live.json,
// and says when each is ready to build a package for: the team news as soon as it's out; the rest once BBC's live text
// describes it, or after DESCRIPTION_WAIT_MS without (then the line stays plain).

import type { Period } from '../../../shared/breaking.ts';
import type { LiveEvent, LiveMatch, LivePost, TeamSheet } from '../../../shared/live.ts';
import { findTeamNews, type ClubPost, inPollWindow } from '../club-post.ts';
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

/** Our team is out before kick-off: the team news break-in. */
export interface ReadyLineup {
  key: typeof LINEUP_KEY;
  lineup: TeamSheet;
  match: LiveMatch;
  /** No description to wait for: the team sheet is the news. */
  text: string[];
}

export const LINEUP_KEY = 'lineup';
export const CLUB_KEY = 'club-lineup';

/**
 * The club's own team-news graphic is out (issue #40), ahead of BBC. The runner reads the names off the image. If
 * BBC's sheet had already gone out (`aired`), the club's is only checked against it, and a correction goes out if they differ.
 */
export interface ReadyClubLineup {
  key: typeof CLUB_KEY;
  club: ClubPost;
  match: LiveMatch;
  aired: boolean;
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

/**
 * What's been handled, and what's seen but waiting for BBC's description. The Worker's clock keeps it in the store
 * between runs, so it never breaks in twice for the same goal.
 */
export interface TrackerState {
  kickOff?: string;
  done: string[];
  /** Events and periods seen but not built yet: when first seen, and their text when it last changed. */
  waiting?: Record<string, Pending>;
  waitingPeriod?: Record<string, Pending>;
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
  state: TrackerState;

  constructor(state: TrackerState = { done: [] }) {
    this.state = state;
  }

  private get pending(): Record<string, Pending> {
    return (this.state.waiting ??= {});
  }

  private get pendingPeriod(): Record<string, Pending> {
    return (this.state.waitingPeriod ??= {});
  }

  private see(m: LiveMatch): void {
    if (this.state.kickOff === m.kickOff) return;
    // A new match. If it's already under way (the clock started mid-match), what's happened so far is old news.
    const old = m.status === 'pre' ? [] : [...eventKeys(m.events).map((e) => e.key), ...periodsReached(m).map(periodKey)];
    this.state = { kickOff: m.kickOff, done: old };
  }

  /** Read in live.json's match as of `now` (ms); returns the events to build packages for now. */
  update(m: LiveMatch, now: number): ReadyEvent[] {
    this.see(m);
    const events = eventKeys(m.events);
    const out: ReadyEvent[] = [];
    for (const { key, event } of events) {
      if (this.state.done.includes(key)) continue;
      const paras = event.post?.text ?? [];
      const p = (this.pending[key] ??= { since: now, text: '', changed: now });
      if (!ready(p, paras, now)) continue;
      out.push({ key, event, match: m, text: paras });
      this.state.done.push(key);
      delete this.pending[key];
    }
    // A goal that's gone (ruled out after all) is no longer waiting.
    for (const key of Object.keys(this.pending)) if (!events.some((e) => e.key === key)) delete this.pending[key];
    return out;
  }

  /**
   * The team news break-in from BBC's match page, once our team is out there: only before kick-off, and once a match. A
   * match first seen after kick-off counts its team news as old. If the club's own graphic already went out, BBC's sheet
   * is not news again.
   */
  lineup(m: LiveMatch): ReadyLineup | undefined {
    this.see(m);
    const ours = m.lineups?.[m.us];
    if (m.status !== 'pre' || !ours || this.state.done.includes(LINEUP_KEY)) return undefined;
    this.state.done.push(LINEUP_KEY);
    if (this.state.done.includes(CLUB_KEY)) return undefined;
    return { key: LINEUP_KEY, lineup: ours, match: m, text: [] };
  }

  /** Whether the clock should look at the club's posts now: in the window before kick-off, until its graphic has been seen. */
  wantsClubPost(m: LiveMatch, now: number): boolean {
    this.see(m);
    return inPollWindow(m, now) && !this.state.done.includes(CLUB_KEY);
  }

  /** The team news break-in from the club's graphic, once a match, the first time a "TEAM NEWS" post for this match turns up. */
  clubLineup(m: LiveMatch, posts: ClubPost[], now: number): ReadyClubLineup | undefined {
    if (!this.wantsClubPost(m, now)) return undefined;
    const club = findTeamNews(posts, m.kickOff);
    if (!club) return undefined;
    this.state.done.push(CLUB_KEY);
    return { key: CLUB_KEY, club, match: m, aired: this.state.done.includes(LINEUP_KEY), text: [] };
  }

  /**
   * The kick-off, half-time or full-time break-in to build now, if any. Only the latest period reached is news: one
   * still waiting when the next comes round (or missed while the clock was down) is dropped.
   */
  period(m: LiveMatch, now: number): ReadyPeriod | undefined {
    this.see(m);
    const reached = periodsReached(m);
    const period = reached[reached.length - 1];
    for (const key of reached.slice(0, -1).map(periodKey)) {
      if (!this.state.done.includes(key)) this.state.done.push(key);
      delete this.pendingPeriod[key];
    }
    if (!period) return undefined;
    const key = periodKey(period);
    if (this.state.done.includes(key)) return undefined;
    const paras = periodPosts(m, period).flatMap((p) => p.text);
    const p = (this.pendingPeriod[key] ??= { since: now, text: '', changed: now });
    if (!ready(p, paras, now)) return undefined;
    this.state.done.push(key);
    delete this.pendingPeriod[key];
    return { key, period, match: m, text: paras };
  }
}
