// The breaking.json format: short break-in packages for goals, red cards, both kick-offs, half-time and full time,
// written by the home PC (npm run live)
// and published to gh-pages beside the site. The player polls it during a match and breaks in after the current line.

import type { Presenter, Segment } from './bulletin.ts';

/** Where the feed sits, relative to the site root. Clip paths in it are relative to this file. */
export const BREAKING_PATH = 'breaking/breaking.json';

/** The match's milestones: first-half kick-off, half-time, second-half kick-off, full time. */
export type Period = 'ko1' | 'ht' | 'ko2' | 'ft';

export interface BreakingPackage {
  /** One per event: the same goal rebuilt keeps its id. */
  id: string;
  kind: 'goal' | 'red' | Period;
  publishedAt: string; // ISO
  /** The match it belongs to. */
  kickOff: string; // ISO
  /** The big word on the break-in flash: "GOAL", "RED CARD", "KICK-OFF", "HALF TIME"… */
  flash: string;
  presenters: Presenter[];
  /** The anchor's hand-over at the desk, then the reporter at the ground. */
  segments: Segment[];
}

export interface BreakingFeed {
  version: 1;
  updated: string; // ISO
  /** Today's match's packages, oldest first (the last few only). */
  packages: BreakingPackage[];
}
