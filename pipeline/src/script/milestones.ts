import type { Milestone } from '../tally.ts';

// Squad milestones (#35): a player close to a round number of Hearts appearances or goals, or just past one, from our own
// count (tally.ts). Template-written, like On This Day, so every name and number is the count's and nothing is made up.
// The line goes into the Match Centre; the AI is shown it in the DATA so the fact-check lets it stand.

const MARKS: Record<number, string> = {
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

/** "Lawrence Shankland has now scored one hundred goals for Hearts." / "Cammy Devlin needs one more appearance to reach two hundred for Hearts." */
export function milestoneSentence(m: Milestone): string {
  const mark = MARKS[m.mark] ?? String(m.mark);
  if (m.reached) return `${m.name} has now ${m.kind === 'apps' ? 'made' : 'scored'} ${mark} ${noun(m, m.mark)} for Hearts.`;
  return `${m.name} needs ${COUNT[m.to] ?? m.to} more ${noun(m, m.to)} to reach ${mark} for Hearts.`;
}

/** Up to two milestones, those reached first, as one spoken passage. Nothing while a game is on. */
export function milestoneLine(milestones: Milestone[] | undefined): string | undefined {
  const picked = (milestones ?? []).slice(0, 2);
  return picked.length ? `By our count: ${picked.map(milestoneSentence).join(' ')}` : undefined;
}
