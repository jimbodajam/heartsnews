import type { Presenter } from '../../../shared/bulletin.ts';
import type { MatchStats } from '../../../shared/live.ts';
import { fanThreads, type Story } from '../stories.ts';
export type { Story };
import { detectPhase, type Phase } from '../matchday.ts';
import { minuteOf, READ } from '../reading.ts';
import { emptyMemory, findAired, type Memory } from '../memory.ts';
import { transferWindow } from '../time.ts';
import type { ClubConfig, Fixture, Item, MatchData, OpponentFocus } from '../types.ts';

/**
 * Every bulletin gets FEATURE_COUNT in-depth packages: the highest-weighted stories that have enough article or
 * transcript text. The top FEATURE_CANDIDATES always get text (the headlines use it too); after that the build
 * keeps reading down the order, up to FEATURE_MAX_SCAN, because many stories are unreadable Google News links.
 * Repeats are fine (with a fresh angle).
 */
export const FEATURE_COUNT = 5;
export const FEATURE_CANDIDATES = 12;
export const FEATURE_MAX_SCAN = 30;
export const MIN_BODY = 400;

export interface Channel {
  name: string;
  spokenName: string;
  /** Where the live site is published; memory.json is read back from here. */
  siteUrl?: string;
  cast: { anchors: [string, string]; transfers: string; analyst: string; debate?: [string, string]; /** Live from the ground on matchdays. */ pitchside?: string };
  presenters: Presenter[];
}

/** Everything a script writer is allowed to talk about for one bulletin. */
export interface Facts {
  club: ClubConfig;
  channel: Channel;
  now: Date;
  memory: Memory;
  /** Top stories overall, for the headlines (templates use the first four). */
  pool: Story[];
  /** The biggest stories, with article text, for in-depth packages. */
  features: Story[];
  transfers: Story[];
  fans: Item[];
  /** Recent videos from supporters' channels with transcripts: fan opinion, not fact. */
  fanVideos: Item[];
  lastResult?: Fixture;
  /** Recent results, newest first, for form. */
  results: Fixture[];
  nextFixtures: Fixture[];
  phase: Phase;
  /** Next opponent's form and both XIs, on build-up days. */
  opponent?: OpponentFocus;
  table: MatchData['table'];
  /** The table for the competition of the game we're building up to (or just played), when it isn't the league. */
  competitionTable?: { competition: string; rows: MatchData['table'] };
  /** BBC's team stats for the game on now or just played, once they mean something (READ.fromMinute in). */
  matchStats?: { fixture: Fixture; stats: MatchStats; minute: number; final: boolean };
  window: { open: boolean; days: number };
}

/** The stats for the game on now (from its minute; 45 at half-time) or just played. */
function statsOf(phase: Phase): Facts['matchStats'] {
  const fixture = phase.kind === 'live' ? phase.fixture : phase.kind === 'reaction' ? phase.result : undefined;
  if (!fixture?.stats) return undefined;
  const final = phase.kind === 'reaction';
  const minute = final ? 90 : fixture.period === 'HT' ? 45 : minuteOf(fixture.period ?? '');
  return minute >= READ.fromMinute ? { fixture, stats: fixture.stats, minute, final } : undefined;
}

/** The game the bulletin is built around: the one coming up, on now, or just played; otherwise the next one. */
export function focusFixture(f: Pick<Facts, 'phase' | 'nextFixtures'>): Fixture | undefined {
  const p = f.phase;
  return p.kind === 'preview' || p.kind === 'live' ? p.fixture : p.kind === 'reaction' ? p.result : f.nextFixtures[0];
}

export function buildFacts(
  club: ClubConfig,
  channel: Channel,
  stories: Story[],
  items: Item[],
  match: MatchData | undefined,
  now: Date,
  memory: Memory = emptyMemory(),
): Facts {
  const phase = detectPhase(match, now);
  const nextFixtures = (match?.next ?? []).filter((f) => new Date(f.date) > now && f.status !== 'postponed').slice(0, 3);
  const competition = focusFixture({ phase, nextFixtures })?.competition;
  return {
    club,
    channel,
    now,
    memory,
    pool: stories.slice(0, 10),
    features: stories
      .slice(0, FEATURE_MAX_SCAN)
      .filter((s) => (s.body?.length ?? 0) >= MIN_BODY)
      .slice(0, FEATURE_COUNT),
    transfers: stories.filter((s) => s.category === 'transfer').slice(0, 3),
    fans: fanThreads(items).slice(0, 5),
    fanVideos: items
      .filter((it) => it.transcript && club.sources.find((s) => s.id === it.sourceId)?.fan)
      .filter((it) => now.getTime() - Date.parse(it.publishedAt) < 4 * 86_400_000)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 2),
    lastResult: match?.last.find((f) => f.homeScore !== undefined && f.awayScore !== undefined),
    results: (match?.last ?? []).filter((f) => f.homeScore !== undefined).slice(0, 5),
    nextFixtures,
    phase,
    // Not during or straight after a game: then the match itself is the story.
    opponent: ['preview', 'normal'].includes(phase.kind) ? match?.opponent : undefined,
    table: match?.table ?? [],
    competitionTable: match?.tables?.find((t) => t.competition === competition),
    matchStats: statsOf(phase),
    window: transferWindow(now),
  };
}

/** One slot in the bulletin's running order: the segment id and who is on screen for it. */
export interface Slot {
  id: string;
  what: string;
  presenters: string[];
}

/**
 * The order segments air in, like a rolling news hour: headlines → story → Match Centre → opposition → story →
 * debate → story → Transfer Centre → stories → Fan Zone. The script prompt (for hand-overs) and the layout share it.
 */
export function runningOrder(f: Facts, opts: { features: Story[]; debate: boolean; match: boolean }): Slot[] {
  const { anchors, analyst, transfers } = f.channel.cast;
  const pundits = f.channel.cast.debate ?? [anchors[1], transfers];
  const story = (s?: Story): Slot | undefined => s && { id: `story-${s.id}`, what: `in-depth package: "${s.title}"`, presenters: [anchors[0], expertFor(f, s)] };
  const [f1, f2, f3, f4, f5] = opts.features;
  const slots: (Slot | undefined)[] = [
    { id: 'headlines', what: 'the headlines', presenters: [...anchors] },
    story(f1),
    opts.match ? { id: 'match', what: 'Match Centre at the touchscreen: results, tables and the next match', presenters: [analyst] } : undefined,
    opts.match && f.opponent ? { id: 'opponent', what: `opposition focus on ${f.opponent.opponent}: form and line-ups`, presenters: [analyst] } : undefined,
    story(f2),
    opts.debate ? { id: 'debate', what: 'The Debate, ending with score predictions', presenters: [...pundits] } : undefined,
    story(f3),
    { id: 'transfers', what: 'the Transfer Centre', presenters: [transfers] },
    story(f4),
    story(f5),
    { id: 'fans', what: 'the Fan Zone: what supporters are saying', presenters: [...anchors] },
  ];
  return slots.filter((s): s is Slot => Boolean(s));
}

/** Data feeds use the full club name; on air it's the short one. */
export function teamName(club: ClubConfig, name: string): string {
  return name === club.name ? club.shortName : name;
}

/** BBC uses the short name, TheSportsDB the full one. */
export function isUs(club: ClubConfig, name: string): boolean {
  return name === club.name || name === club.shortName;
}

export function presenter(facts: Facts, id: string): Presenter {
  return facts.channel.presenters.find((p) => p.id === id) ?? facts.channel.presenters[0];
}

export const firstName = (p: Presenter) => p.name.split(' ')[0];

/**
 * Who joins the lead anchor to discuss a story: the Transfer Centre reporter, the analyst, or the other anchor.
 * When a story comes round again, the other anchor and the specialist take turns, so a repeat sounds different.
 */
export function expertFor(f: Facts, s: Story): string {
  const { transfers, analyst, anchors } = f.channel.cast;
  const specialist = s.category === 'transfer' ? transfers : s.category === 'match' || s.category === 'injury' ? analyst : anchors[1];
  const times = findAired(f.memory, s.title)?.inDepth ?? 0;
  if (times % 2 === 0) return specialist;
  return specialist === anchors[1] ? analyst : anchors[1];
}
