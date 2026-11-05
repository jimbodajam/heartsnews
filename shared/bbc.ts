// BBC Sport pages embed their data as JSON (window.__INITIAL_DATA__). The parts used by both the pipeline and the
// live Worker: reading that data, and the fixtures in it.

export interface BbcAction {
  playerName: string;
  actionType: string; // goal | goal-unconfirmed | card
  actions: { type: string; timeLabel?: { value: string } }[]; // type: Goal, Penalty, Own Goal, Red Card, Two Yellow Cards…
}

export interface BbcSide {
  shortName: string;
  urn?: string;
  score?: string;
  scoreUnconfirmed?: string;
  runningScores?: { fulltime?: string };
  actions?: BbcAction[];
}

export interface BbcEvent {
  home: BbcSide;
  away: BbcSide;
  startDateTime: string;
  status: string; // PreEvent | MidEvent | PostEvent | Postponed | ...
  periodLabel?: { value: string };
  tournament?: { name: string };
  venue?: { name: string };
  onwardJourneyLink?: string;
}

export type BbcData = Record<string, { data?: unknown }>;

export function initialData(html: string): BbcData {
  // An unrolled string-literal pattern: several times faster than (?:[^"\\]|\\.)* on a 1MB+ match page.
  const m = /window\.__INITIAL_DATA__\s*=\s*("[^"\\]*(?:\\.[^"\\]*)*")/.exec(html);
  if (!m) throw new Error('BBC page has no __INITIAL_DATA__');
  return (JSON.parse(JSON.parse(m[1])) as { data: BbcData }).data;
}

/** The data block whose key starts with `prefix` (keys carry query strings, e.g. "live-header?assetId=…"). */
export function block<T>(data: BbcData, prefix: string): T | undefined {
  const key = Object.keys(data).find((k) => k.startsWith(prefix));
  return key === undefined ? undefined : (data[key]?.data as T | undefined);
}

/** The fixtures and results listed in a scores-fixtures page's data. */
export function eventsIn(data: BbcData): BbcEvent[] {
  const groups = block<{ eventGroups?: { secondaryGroups: { events: BbcEvent[] }[] }[] }>(data, 'sport-data-scores-fixtures')?.eventGroups ?? [];
  return groups.flatMap((g) => g.secondaryGroups.flatMap((s) => s.events));
}

/** The data blocks the live feed reads (shared/live.ts): the team page's fixtures and the match page's header, live
 * text, stats and line-ups. The rest of a match page (a megabyte or more) is left out when a page is relayed. */
export const LIVE_BLOCKS = ['sport-data-scores-fixtures', 'live-header?', 'stream?', 'match-stats?', 'match-lineups?'];

/** Only the blocks the live feed reads. */
export function liveBlocks(data: BbcData): BbcData {
  return Object.fromEntries(Object.entries(data).filter(([k]) => LIVE_BLOCKS.some((p) => k.startsWith(p))));
}
