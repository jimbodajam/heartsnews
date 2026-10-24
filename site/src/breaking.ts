// Breaking news: polls breaking.json (published by the home PC) from the team news until the match is over, and hands each new package
// to the player, which breaks in with it after the current line.

import type { BreakingFeed, BreakingPackage } from '../../shared/breaking';
import type { LiveScore } from './live';

/** Don't break in with a package older than this: it's no longer news. */
export const BREAKING_FRESH_MS = 10 * 60_000;
const SEEN_KEY = 'heartsnews:breaking-seen';
/** Look for the team news from this long before kick-off (BBC usually has it about an hour before). */
const TEAM_NEWS_MS = 2 * 3_600_000;

/** A package as seen once: a replay that rebuilds the same goal counts as new. */
const seenId = (p: BreakingPackage) => `${p.id}@${p.publishedAt}`;

export const isFresh = (p: BreakingPackage) => Date.now() - Date.parse(p.publishedAt) < BREAKING_FRESH_MS;

export class BreakingNews {
  onPackage?: (p: BreakingPackage) => void;
  private seen = new Set<string>();

  constructor(
    private url: string,
    private live: LiveScore,
    /** Speeds up polling, for replays. */
    private pace = 1,
  ) {
    try {
      this.seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
    } catch {
      // No storage (private window): a reload may show a goal again, which is fine.
    }
  }

  start(): void {
    void this.poll();
  }

  private remember(): void {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...this.seen].slice(-30)));
    } catch {
      // As above.
    }
  }

  private async poll(): Promise<void> {
    // Only on matchday: from the team news, about an hour before kick-off, until just after the game.
    const m = this.live.today();
    const live = m && m.status !== 'pre' && m.status !== 'postponed';
    const teamNews = m?.status === 'pre' && Date.parse(m.kickOff) - Date.now() < TEAM_NEWS_MS;
    const on = live || teamNews;
    if (m && on) {
      try {
        const res = await fetch(`${this.url}?t=${Date.now()}`, { cache: 'no-store' });
        // Before the first goal of a match there's no file yet.
        if (res.ok) {
          const feed = (await res.json()) as BreakingFeed;
          // Rebase clip paths on the feed's address, so the player doesn't need to know where it came from.
          for (const p of feed.packages ?? []) {
            if (this.seen.has(seenId(p)) || !isFresh(p) || p.kickOff !== m.kickOff) continue;
            this.seen.add(seenId(p));
            for (const line of p.segments.flatMap((s) => s.lines)) if (line.audio) line.audio = new URL(line.audio, new URL(this.url, location.href)).href;
            this.onPackage?.(p);
          }
          this.remember();
        }
      } catch (err) {
        console.warn('[breaking]', (err as Error).message);
      }
    }
    setTimeout(() => void this.poll(), (live ? 20_000 : 60_000) / this.pace);
  }
}
