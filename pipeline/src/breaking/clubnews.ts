// The team news from the club's own graphic (issue #40). The club posts the XI before BBC has the sheet, and BBC's early
// sheet can be wrong (Mendy and Mato on 25 Oct), so the club's graphic breaks the news. If BBC's sheet had gone out first,
// the graphic is only a check on it: when the two differ, a short correction goes out instead.

import type { BreakingPackage } from '../../../shared/breaking.ts';
import type { SheetPlayer, TeamSheet } from '../../../shared/live.ts';
import { clubSheet, compareSheets } from '../club-sheet.ts';
import type { ClubXI } from '../club-xi.ts';
import type { Face } from '../faces.ts';
import type { Channel } from '../script/facts.ts';
import { findPlayer, type RosterPlayer, type Totals } from '../tally.ts';
import { spokenList } from '../time.ts';
import type { ReadyClubLineup } from './detect.ts';
import { buildTeamNewsPackage, FLASH, playerName } from './teamnews.ts';

export interface ClubNewsInput {
  ready: ReadyClubLineup;
  xi: ClubXI;
  roster: RosterPlayer[];
  channel: Channel;
  previous?: { sheet: TeamSheet; against: string };
  faces?: Face[];
  totals?: Totals[];
  now?: Date;
}

/** A sheet from BBC with its players' ids swapped for the squad's, so it can be compared with the club's by player. */
export function withSquadIds(sheet: TeamSheet, roster: RosterPlayer[]): TeamSheet {
  const swap = (p: SheetPlayer): SheetPlayer => {
    const who = findPlayer(roster, p);
    return who ? { ...p, urn: `club:${who.id}` } : p;
  };
  return { ...sheet, rows: sheet.rows.map((r) => r.map(swap)), bench: sheet.bench.map(swap) };
}

/** "A correction to the Hearts team: Pollock starts, and Finley is on the bench." */
export function correctionLine(team: string, club: TeamSheet, bbc: TeamSheet, faces: Face[] = []): string | undefined {
  const { starts, notStarting } = compareSheets(club, bbc);
  if (!starts.length && !notStarting.length) return undefined;
  const say = (ps: SheetPlayer[]) => spokenList(ps.map((p) => playerName(p, faces).name));
  const benched = notStarting.filter((q) => club.bench.some((b) => b.shirt.toLowerCase() === q.shirt.toLowerCase()));
  const dropped = notStarting.filter((q) => !benched.includes(q));
  const parts = [
    starts.length ? `${say(starts)} ${starts.length === 1 ? 'starts' : 'start'}` : undefined,
    benched.length ? `${say(benched)} ${benched.length === 1 ? 'is' : 'are'} on the bench` : undefined,
    dropped.length ? `${say(dropped)} ${dropped.length === 1 ? 'is' : 'are'} not in the starting eleven` : undefined,
  ].filter(Boolean);
  return `A correction to the ${team} team: ${parts.join(', and ')}.`;
}

/**
 * The break-in for the club's graphic: the whole team news, or (when BBC's sheet already went out) a correction if the
 * club's differs, or nothing if they agree. Nothing too if a name on the graphic isn't in the squad: a correction on a
 * shaky reading is worse than none.
 */
export function buildClubNewsPackage({ ready, xi, roster, channel, previous, faces = [], totals, now = new Date() }: ClubNewsInput): BreakingPackage | undefined {
  const m = ready.match;
  const team = m[m.us].name;
  const { sheet, unmatched } = clubSheet(xi, roster, team);
  if (unmatched.length) console.warn(`[breaking] Club graphic: not in the squad table, shown as printed: ${unmatched.join(', ')}`);
  if (xi.starters.length !== 11) throw new Error(`the club graphic gave ${xi.starters.length} starters, not 11`);
  const bbc = m.lineups?.[m.us];
  if (ready.aired && bbc) {
    if (unmatched.length) return undefined;
    const line = correctionLine(team, sheet, bbc, faces);
    if (!line) {
      console.log("[breaking] The club's team matches BBC's: nothing to correct");
      return undefined;
    }
    const anchor = channel.presenters.find((p) => p.id === channel.cast.anchors[0])!;
    return {
      id: `${m.kickOff}|club-correction`,
      kind: 'lineup',
      publishedAt: now.toISOString(),
      kickOff: m.kickOff,
      flash: FLASH,
      presenters: [anchor],
      segments: [
        {
          id: 'breaking-desk-club-correction',
          kind: 'breaking',
          title: FLASH,
          strap: `${FLASH}: ${m.home.name} v ${m.away.name}`,
          scene: 'desk',
          presenters: [anchor.id],
          lines: [{ speaker: anchor.id, text: line }],
        },
      ],
    };
  }
  return buildTeamNewsPackage({
    key: ready.key,
    match: m,
    lineup: sheet,
    channel,
    previous: previous && { ...previous, sheet: withSquadIds(previous.sheet, roster) },
    faces,
    totals,
    now,
  });
}
