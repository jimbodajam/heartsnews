export type SourceKind = 'press' | 'official' | 'aggregator' | 'video' | 'podcast' | 'forum';

export interface SourceConfig {
  id: string;
  name: string;
  kind: SourceKind;
  /**
   * rss: url is a feed. youtube: url is a channel id. reddit: url is a subreddit name.
   * ips-forum: url is an Invision Community forum board (e.g. the Kickback's Terrace).
   */
  type: 'rss' | 'youtube' | 'reddit' | 'ips-forum';
  url: string;
  /** ips-forum: how many of the busiest threads to read. */
  limit?: number;
  /** Keep only items that mention one of the club's keywords (for general feeds). */
  filter?: boolean;
  maxAgeDays?: number;
  enabled?: boolean;
  note?: string;
}

export interface ClubConfig {
  id: string;
  name: string;
  shortName: string;
  nicknames: string[];
  colours: { primary: string; secondary: string; accent: string };
  keywords: string[];
  sportsdb: { teamId: string; leagueId: string };
  sources: SourceConfig[];
}

/** One piece of collected content, normalised across every source. */
export interface Item {
  id: string;
  sourceId: string;
  sourceName: string;
  kind: SourceKind;
  /** Original outlet when it differs from the source (e.g. a Google News result). */
  publisher?: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  /** Views, comments or similar, when the source exposes it. */
  engagement?: number;
}

export interface Fixture {
  date: string;
  home: string;
  away: string;
  competition: string;
  venue?: string;
  homeScore?: number;
  awayScore?: number;
}

export interface Standing {
  pos: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gd: number;
  pts: number;
  form?: string;
}

export interface MatchData {
  next: Fixture[];
  last: Fixture[];
  table: Standing[];
}
