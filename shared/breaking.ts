// The breaking.json format: short break-in packages for goals and red cards, written by the home PC (npm run live)
// and published to gh-pages beside the site. The player polls it during a match and breaks in after the current line.

import type { Presenter, Segment } from './bulletin.ts';

/** Where the feed sits, relative to the site root. Clip paths in it are relative to this file. */
export const BREAKING_PATH = 'breaking/breaking.json';

export interface BreakingPackage {
  /** One per event: the same goal rebuilt keeps its id. */
  id: string;
  kind: 'goal' | 'red';
  publishedAt: string; // ISO
  /** The match it belongs to. */
  kickOff: string; // ISO
  /** The big word on the break-in flash: "GOAL" or "RED CARD". */
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
