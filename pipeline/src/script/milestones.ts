import type { Milestone } from '../tally.ts';

// Squad milestones (#35): a player close to a round number of Hearts appearances or goals, or just past one, from our own
// count (tally.ts). The writer is given them as facts for the Match Centre ("reached" after a game, "could reach" before
// one); if it leaves them out, the template line below says them, so every name and number is the count's.

const MARKS: Record<number, string> = {
  10: 'ten',
  25: 'twenty-five',
  50: 'fifty',
  100: 'one hundred',
  150: 'one hundred and fifty',
  200: 'two hundred',
  250: 'two hundred and fifty',
  300: 'three hundred',
};
const COUNT = ['no', 'one', 'two', 'three'];

const noun = (m: Milestone, n: number) => (m.kind === 'apps' ? (n === 1 ? 'appearance' : 'appearances') : n === 1 ? 'goal' : 'goals');

/**
 * What's worth saying for this kind of bulletin. Before a game only what the game itself could bring: the appearance a
 * player is one short of, and goals within reach. Straight after one, what was reached and what's still close. A game
 * on now says none: it isn't said as it's being reached.
 */
export function milestonesFor(kind: string, milestones: Milestone[]): Milestone[] {
  if (kind === 'live') return [];
  if (kind === 'preview') return milestones.filter((m) => !m.reached && (m.kind === 'goals' || m.to === 1));
  return milestones;
}

/** "Lawrence Shankland has now scored one hundred goals for Hearts." / "Cammy Devlin needs one more appearance to reach two hundred for Hearts." */
export function milestoneSentence(m: Milestone): string {
  const mark = MARKS[m.mark] ?? String(m.mark);
  if (m.reached) return `${m.name} has now ${m.kind === 'apps' ? 'made' : 'scored'} ${mark} ${noun(m, m.mark)} for Hearts.`;
  return `${m.name} needs ${COUNT[m.to] ?? m.to} more ${noun(m, m.to)} to reach ${mark} for Hearts.`;
}

/** Up to two milestones, those reached first, as one spoken passage. The fallback when the writer doesn't say them. */
export function milestoneLine(milestones: Milestone[] | undefined): string | undefined {
  const picked = (milestones ?? []).slice(0, 2);
  return picked.length ? `By our count: ${picked.map(milestoneSentence).join(' ')}` : undefined;
}

/** The facts given to the script writer, one per milestone. */
export function milestoneFacts(milestones: Milestone[] | undefined): string[] {
  return (milestones ?? [])
    .slice(0, 3)
    .map((m) => `${m.name}: ${m.total} Hearts ${m.kind === 'apps' ? 'appearances' : 'goals'} by our count; ${m.reached ? `has just reached ${MARKS[m.mark] ?? m.mark}` : `${COUNT[m.to] ?? m.to} short of ${MARKS[m.mark] ?? m.mark}`}`);
}

