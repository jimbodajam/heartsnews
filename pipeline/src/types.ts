import type { MatchStats } from '../../shared/live.ts';

export type SourceKind ='press' | 'official' | 'aggregator' | 'video' | 'podcast' | 'forum';

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
  /**
   * Blocks GitHub's servers, so it's also collected at home with `npm run snapshot`. When the live
   * fetch fails, the build uses the latest snapshot from the repo's `snapshots` branch instead.
   */
  snapshot?: boolean;
  /** youtube: also fetch video transcripts (at home, in `npm run snapshot`, since YouTube blocks GitHub). */
  transcripts?: boolean;
  /** A supporters' channel: its videos are fan opinion for the debate and Fan Zone, credited to the channel. */
  fan?: boolean;
  /** Keep only items that mention one of the club's keywords (for general feeds). */
  filter?: boolean;
  maxAgeDays?: number;
  enabled?: boolean;
  note?: string;
}

export interface BigGames {
  /** Opponents that always make it a big game: their names as the fixture feeds give them, and the billing. */
  opponents: { names: string[]; billing: string }[];
  /** Competitions where every game is big (Europe), matched as part of the fixture's competition. */
  competitions: { name: string; billing: string }[];
  /** Cups whose semi-final and final are big. Fixtures don't say the round, so it comes from the news. */
  cups: string[];
}

export interface ClubConfig {
  id: string;
  name: string;
  shortName: string;
  nicknames: string[];
  colours: { primary: string; secondary: string; accent: string };
  keywords: string[];
  /** Other clubs' names and nicknames, to spot their fan sites and their angle on our news. */
  rivals?: string[];
  /** What makes a game a big one, and how it's billed on air (matchday.ts bigGame). */
  bigGames?: BigGames;
  sportsdb: { teamId: string; leagueId: string };
  /** BBC Sport slugs: the team page (bbc.co.uk/sport/football/teams/<team>) and the league table's tournament. */
  bbc?: { team: string; league: string };
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
  /** What was said in a video, from its captions. */
  transcript?: string;
}

export interface Fixture {
  date: string;
  home: string;
  away: string;
  competition: string;
  venue?: string;
  homeScore?: number;
  awayScore?: number;
  /** Where the match is up to. Missing means unknown (TheSportsDB). */
  status?: 'pre' | 'live' | 'done' | 'postponed';
  /** Live progress as the BBC shows it, e.g. "63'" or "HT". */
  period?: string;
  scorers?: { side: 'home' | 'away'; player: string; minute: string }[];
  /** BBC's team stats, for a game on now or just played (read from the match page). */
  stats?: MatchStats;
  /** BBC team page slugs (e.g. "motherwell") and the match page path, when the data came from the BBC. */
  homeSlug?: string;
  awaySlug?: string;
  link?: string;
}

/** A team's starting XI in formation: rows from the goalkeeper forwards, players by surname. */
export interface Lineup {
  team: string;
  formation: string; // "4-2-3-1"
  rows: string[][];
}

/** Matchday build-up material about the next opponent and both teams' line-ups. */
export interface OpponentFocus {
  fixture: Fixture;
  opponent: string;
  /** Their recent results, newest first. */
  results: Fixture[];
  theirXI?: Lineup;
  ourXI?: Lineup;
  /** True when the XIs are the confirmed teams for this match, not the last starting line-ups. */
  confirmed: boolean;
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
  /** Tables for the other competitions we're in (e.g. a European league phase), named as fixtures name them. */
  tables?: { competition: string; rows: Standing[] }[];
  opponent?: OpponentFocus;
}
