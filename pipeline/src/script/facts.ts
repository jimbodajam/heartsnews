import type { Presenter } from '../../../shared/bulletin.ts';
import { fanThreads, type Story } from '../stories.ts';
export type { Story };
import { detectPhase, type Phase } from '../matchday.ts';
import { emptyMemory, findAired, type Memory } from '../memory.ts';
import { transferWindow } from '../time.ts';
import type { ClubConfig, Fixture, Item, MatchData } from '../types.ts';

/** How many stories get an in-depth package, chosen from the top FEATURE_CANDIDATES that have enough article text. */
export const FEATURE_COUNT = 3;
export const FEATURE_CANDIDATES = 6;
const MIN_BODY = 400;

export interface Channel {
  name: string;
  spokenName: string;
  /** Where the live site is published; memory.json is read back from here. */
  siteUrl?: string;
  cast: { anchors: [string, string]; transfers: string; analyst: string; debate?: [string, string] };
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
  table: MatchData['table'];
  window: { open: boolean; days: number };
}

/** A story already covered in depth only gets another package if there's been new coverage since. */
function needsDepth(memory: Memory, s: Story): boolean {
  const a = findAired(memory, s.title);
  return !a || a.inDepth === 0 || s.latest > a.lastAired;
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
  return {
    club,
    channel,
    now,
    memory,
    pool: stories.slice(0, 10),
    features: stories
      .slice(0, FEATURE_CANDIDATES)
      .filter((s) => (s.body?.length ?? 0) >= MIN_BODY && needsDepth(memory, s))
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
    nextFixtures: (match?.next ?? []).filter((f) => new Date(f.date) > now && f.status !== 'postponed').slice(0, 3),
    phase: detectPhase(match, now),
    table: match?.table ?? [],
    window: transferWindow(now),
  };
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

/** Who joins the lead anchor to discuss a story: the Transfer Centre reporter, the analyst, or the other anchor. */
export function expertFor(f: Facts, s: Story): string {
  if (s.category === 'transfer') return f.channel.cast.transfers;
  if (s.category === 'match' || s.category === 'injury') return f.channel.cast.analyst;
  return f.channel.cast.anchors[1];
}
