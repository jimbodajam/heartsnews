// The team news break-in: the anchor hands over to the video wall, where our presenter reads the XI out one player
// at a time, announcer style, each one's card up on the wall ("In goal, number 1, Beau Reus"). Then the whole team in
// formation with any changes from the last game picked out, the bench, and a line on the opposition's team. Plain
// lines only: it's names and numbers, and every word comes from BBC's team sheets (no reasons for changes, no
// injuries, nothing we don't have).

import type { BreakingPackage } from '../../../shared/breaking.ts';
import type { Graphic, Line, Presenter, Segment } from '../../../shared/bulletin.ts';
import type { LiveMatch, SheetPlayer, TeamSheet } from '../../../shared/live.ts';
import { toLineup } from '../collectors/bbc.ts';
import type { Face } from '../faces.ts';
import type { Channel } from '../script/facts.ts';
import { describeXI } from '../script/opponent.ts';
import { spokenList } from '../time.ts';
import { SIGN_OFF } from './script.ts';

export const FLASH = 'TEAM NEWS';

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const key = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * A player's portrait, by the name on their shirt ("McCart", "Cláudio Braga"; faces.json has "Mccart" and
 * "Claudio Braga"), when only one of the squad goes by it.
 */
function faceOf(p: SheetPlayer, faces: Face[]): Face | undefined {
  const shirt = key(p.shirt);
  const full = p.first ? key(`${p.first} ${p.shirt}`) : undefined;
  const found = faces.filter((f) => key(f.surname) === shirt || key(f.name) === shirt || key(f.name) === full);
  return found.length === 1 ? found[0] : undefined;
}

/**
 * A player's name to say: their first name and the name on their shirt ("Beau Reus"), or just the shirt name when
 * it's already a full one ("Cláudio Braga", "JJ Williams"). The first name is the club's if we have their portrait
 * (BBC's can be both of them: "Jamie Daniel").
 */
export function playerName(p: SheetPlayer, faces: Face[] = []): { name: string; face?: string } {
  const face = faceOf(p, faces);
  const first = face && key(face.surname) === key(p.shirt) ? face.name.slice(0, -face.surname.length).trim() : p.first;
  const name = p.shirt.includes(' ') || !first || key(first) === key(p.shirt) ? p.shirt : `${first} ${p.shirt}`;
  return { name, ...(face ? { face: `faces/${face.file}` } : {}) };
}

/** How the announcer opens each line of the team: "In goal", "At the back", "In midfield", "Ahead of them", "Up front". */
export function rowOpening(sheet: TeamSheet, i: number): string {
  if (i === 0) return 'in goal';
  if (i === sheet.rows.length - 1) return 'up front';
  const position = sheet.rows[i][0]?.position;
  if (position === 'Defender') return 'at the back';
  const before = sheet.rows.slice(1, i).some((r) => r[0]?.position === 'Midfielder');
  if (position === 'Midfielder') return before ? 'ahead of them' : 'in midfield';
  return 'then';
}

/** "In goal, number 1, Beau Reus." The first of each line of the team gets the opening. */
export function playerLine(sheet: TeamSheet, i: number, j: number, name: string): string {
  const p = sheet.rows[i][j];
  const parts = [j === 0 ? rowOpening(sheet, i) : undefined, p.number !== undefined ? `number ${p.number}` : undefined, `${p.captain ? 'the captain, ' : ''}${name}`];
  return `${capital(parts.filter(Boolean).join(', '))}.`;
}

/** Who's in and who's out since the last game's starting XI, by BBC's player ids. */
export function changes(sheet: TeamSheet, previous: TeamSheet): { in: SheetPlayer[]; out: SheetPlayer[] } {
  const now = sheet.rows.flat();
  const before = previous.rows.flat();
  return { in: now.filter((p) => !before.some((b) => b.urn === p.urn)), out: before.filter((b) => !now.some((p) => p.urn === b.urn)) };
}

/** "That's a 4-3-3, with two changes from the side that started against Motherwell: Mato and Wilson come in for…" */
export function shapeLine(sheet: TeamSheet, previous?: { sheet: TeamSheet; against: string }): string {
  const shape = sheet.formation ? `That's a ${sheet.formation}` : "That's the team";
  if (!previous) return `${shape}.`;
  const c = changes(sheet, previous.sheet);
  const side = `the side that started against ${previous.against}`;
  if (!c.in.length) return `${shape}, and it's unchanged from ${side}.`;
  const n = c.in.length;
  const names = (ps: SheetPlayer[]) => spokenList(ps.map((p) => p.shirt));
  return `${shape}, with ${NUMBERS[n] ?? n} change${n === 1 ? '' : 's'} from ${side}: ${names(c.in)} come${n === 1 ? 's' : ''} in for ${names(c.out)}.`;
}

/** "On the bench: Clark, Fulton… and JJ Williams." */
export const benchLine = (sheet: TeamSheet) => (sheet.bench.length ? `On the bench: ${spokenList(sheet.bench.map((p) => p.shirt))}.` : undefined);

export interface TeamNewsInput {
  key: string;
  match: LiveMatch;
  /** Our team. */
  lineup: TeamSheet;
  channel: Channel;
  /** Our last starting XI and who it was against, for the changes. */
  previous?: { sheet: TeamSheet; against: string };
  faces?: Face[];
  now?: Date;
}

const formation = (sheet: TeamSheet, ours: boolean, label: string, changed: string[] = []): Graphic => ({
  type: 'formation',
  label,
  team: sheet.team,
  formation: sheet.formation,
  rows: toLineup(sheet).rows,
  ours,
  ...(changed.length ? { changes: changed } : {}),
});

/** The whole package, ready to voice. */
export function buildTeamNewsPackage({ key, match: m, lineup: sheet, channel, previous, faces = [], now = new Date() }: TeamNewsInput): BreakingPackage {
  const find = (id?: string) => channel.presenters.find((p) => p.id === id);
  const anchor = find(channel.cast.anchors[0])!;
  const wall: Presenter = find(channel.cast.teamNews) ?? find(channel.cast.analyst) ?? anchor;
  const us = m.us;
  const them = us === 'home' ? 'away' : 'home';
  const opponent = m[them].name;
  const theirs = m.lineups?.[them];
  const fresh = previous ? changes(sheet, previous.sheet).in : [];

  const say = (text: string, graphic?: Graphic): Line => ({ speaker: wall.id, text, ...(graphic ? { graphic } : {}) });
  const lines: Line[] = [say(`Here's the ${sheet.team} team to face ${opponent}.`)];
  sheet.rows.forEach((row, i) =>
    row.forEach((p, j) => {
      const { name, face } = playerName(p, faces);
      lines.push(
        say(playerLine(sheet, i, j, name), {
          type: 'player',
          team: sheet.team,
          name,
          ...(p.number !== undefined ? { number: p.number } : {}),
          ...(p.position ? { position: p.position } : {}),
          ...(face ? { face } : {}),
          ...(p.captain ? { captain: true } : {}),
          ...(fresh.includes(p) ? { isNew: true } : {}),
        }),
      );
    }),
  );
  lines.push(say(shapeLine(sheet, previous), formation(sheet, true, 'TEAM NEWS', fresh.map((p) => p.shirt))));
  const bench = benchLine(sheet);
  if (bench) lines.push(say(bench));
  if (theirs) lines.push(say(`${opponent} go with ${describeXI(toLineup(theirs))}.`, formation(theirs, false, 'OPPOSITION')));
  const last = lines[lines.length - 1];
  last.text = `${last.text} ${SIGN_OFF}`;

  const strap = `${FLASH}: ${m.home.name} v ${m.away.name}`;
  const segment = (where: string, scene: Segment['scene'], who: Presenter, ls: Line[]): Segment => ({
    id: `breaking-${where}-${key}`, kind: 'breaking', title: FLASH, strap, scene, presenters: [who.id], lines: ls,
  });
  const handOver = `The ${sheet.team} team to face ${opponent} is in. ${wall.name.split(' ')[0]} has it on the big screen.`;
  return {
    id: `${m.kickOff}|${key}`,
    kind: 'lineup',
    publishedAt: now.toISOString(),
    kickOff: m.kickOff,
    flash: FLASH,
    presenters: [anchor, wall].filter((p, i, all) => all.indexOf(p) === i),
    segments: [segment('desk', 'desk', anchor, [{ speaker: anchor.id, text: handOver }]), segment('wall', 'videowall', wall, lines)],
  };
}
