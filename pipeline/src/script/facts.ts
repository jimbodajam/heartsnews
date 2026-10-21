import type { Presenter } from '../../../shared/bulletin.ts';
import { fanThreads, type Story } from '../stories.ts';
export type { Story };
import { transferWindow } from '../time.ts';
import type { ClubConfig, Fixture, Item, MatchData } from '../types.ts';

/** How many stories get an in-depth package, chosen from the top FEATURE_CANDIDATES that have enough article text. */
export const FEATURE_COUNT = 3;
export const FEATURE_CANDIDATES = 6;
const MIN_BODY = 400;

export interface Channel {
  name: string;
  spokenName: string;
  cast: { anchors: [string, string]; transfers: string; analyst: string };
  presenters: Presenter[];
}

/** Everything a script writer is allowed to talk about for one bulletin. */
export interface Facts {
  club: ClubConfig;
  channel: Channel;
  now: Date;
  /** Top stories overall, for the headlines (templates use the first four). */
  pool: Story[];
  /** The biggest stories, with article text, for in-depth packages. */
  features: Story[];
  transfers: Story[];
  fans: Item[];
  lastResult?: Fixture;
  nextFixtures: Fixture[];
  table: MatchData['table'];
  window: { open: boolean; days: number };
}

export function buildFacts(club: ClubConfig, channel: Channel, stories: Story[], items: Item[], match: MatchData | undefined, now: Date): Facts {
  return {
    club,
    channel,
    now,
    pool: stories.slice(0, 10),
    features: stories
      .slice(0, FEATURE_CANDIDATES)
      .filter((s) => (s.body?.length ?? 0) >= MIN_BODY)
      .slice(0, FEATURE_COUNT),
    transfers: stories.filter((s) => s.category === 'transfer').slice(0, 3),
    fans: fanThreads(items).slice(0, 5),
    lastResult: match?.last.find((f) => f.homeScore !== undefined && f.awayScore !== undefined),
    nextFixtures: (match?.next ?? []).filter((f) => new Date(f.date) > now).slice(0, 3),
    table: match?.table ?? [],
    window: transferWindow(now),
  };
}

/** Data feeds use the full club name; on air it's the short one. */
export function teamName(club: ClubConfig, name: string): string {
  return name === club.name ? club.shortName : name;
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
