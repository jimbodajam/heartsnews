import type { Presenter } from '../../../shared/bulletin.ts';
import { fanThreads, type Story } from '../stories.ts';
import { transferWindow } from '../time.ts';
import type { ClubConfig, Fixture, Item, MatchData } from '../types.ts';

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
