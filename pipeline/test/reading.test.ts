// Our reading of a game from the live stats: made-up numbers for each reading and the edges of its bar, then the
// recorded Trabzonspor v Hearts (22 Oct 2026). Run with `npm test`.

import assert from 'node:assert/strict';
import type { MatchStats, TeamStats } from '../../shared/live.ts';
import { test } from 'node:test';
import { howItsGone, pickReading, readGame, statsBrief } from '../src/reading.ts';

const names = { home: 'Hearts', away: 'Aberdeen' };
const side = (s: Partial<TeamStats>): TeamStats => ({ possession: 50, shots: 5, onTarget: 2, corners: 3, fouls: 8, saves: 1, touchesInBox: 10, ...s });
const stats = (home: Partial<TeamStats>, away: Partial<TeamStats>): MatchStats => {
  const h = side(home);
  return { home: h, away: side({ possession: 100 - h.possession, ...away }) };
};
const kinds = (st: MatchStats, score = { home: 0, away: 0 }, minute = 60) => readGame(names, st, score, minute).map((r) => `${r.kind}${r.side ? ` ${r.side}` : ''}`);

test('against the run of play: ahead with clearly less of the ball and fewer shots on target', () => {
  const st = stats({ possession: 35, onTarget: 1 }, { onTarget: 5, shots: 12 });
  const [r] = readGame(names, st, { home: 1, away: 0 }, 60);
  assert.equal(r.kind, 'run-of-play');
  assert.equal(r.text, "It's been against the run of play: Aberdeen have had 65 per cent of the ball, and five shots on target to one.");
  assert.deepEqual(r.numbers, [65, 5, 1]);
  // Not when they've had nearly as much of the ball, or nearly as many on target.
  assert.ok(!kinds(stats({ possession: 45, onTarget: 1 }, { onTarget: 5 }), { home: 1, away: 0 }).includes('run-of-play home'));
  assert.ok(!kinds(stats({ possession: 35, onTarget: 4 }, { onTarget: 5 }), { home: 1, away: 0 }).includes('run-of-play home'));
});

test('on top: lots of the ball and more on target; knocking on the door if they have just scored', () => {
  const st = stats({ possession: 63, shots: 14, onTarget: 6 }, { shots: 4, onTarget: 1 });
  assert.deepEqual(kinds(st), ['on-top home']);
  assert.equal(pickReading(readGame(names, st, { home: 0, away: 0 }, 60))?.text, 'Hearts have been on top, with 63 per cent of the ball and six shots on target to one.');
  assert.equal(pickReading(readGame(names, st, { home: 1, away: 0 }, 60), 'home')?.text, 'Hearts have been knocking on the door, with 63 per cent of the ball and six shots on target to one.');
  // A 52/48 game is never talked up.
  assert.deepEqual(kinds(stats({ possession: 52, shots: 9, onTarget: 6 }, { shots: 4, onTarget: 1 })), []);
});

test('even, cagey, a busy keeper and a side without a shot on target', () => {
  assert.deepEqual(kinds(stats({ possession: 52, shots: 6, onTarget: 3 }, { shots: 5, onTarget: 2 })), ['even']);
  assert.deepEqual(kinds(stats({ shots: 4, onTarget: 1 }, { shots: 3, onTarget: 0 })), ['even', 'cagey', 'no-shot-on-target away']);
  assert.deepEqual(kinds(stats({ possession: 45, shots: 3, onTarget: 3, saves: 5 }, { shots: 12, onTarget: 8 })), ['keeper-busy home']);
  // Even, cagey and no-shots need half an hour to mean anything.
  assert.deepEqual(kinds(stats({ shots: 4, onTarget: 1 }, { shots: 3, onTarget: 0 }), undefined, 25), []);
});

test('nothing at all before a quarter of an hour', () => {
  const st = stats({ possession: 70, shots: 6, onTarget: 4 }, { shots: 0, onTarget: 0 });
  assert.deepEqual(kinds(st, undefined, 14), []);
  assert.deepEqual(kinds(st, undefined, 15), ['on-top home']);
});

test('the recorded match: mixed numbers at the first goal, Trabzonspor on top by full time', () => {
  const tr = { home: 'Trabzonspor', away: 'Hearts' };
  // 32': Trabzonspor 59% of the ball, but Hearts with six shots to three: nothing to say about who's on top.
  const firstGoal = stats({ possession: 58.8, shots: 3, onTarget: 1 }, { shots: 6, onTarget: 1 });
  assert.deepEqual(readGame(tr, firstGoal, { home: 1, away: 0 }, 32).map((r) => r.kind), ['cagey']);
  // Full time.
  const ft = stats({ possession: 60.7, shots: 11, onTarget: 5, saves: 1 }, { shots: 10, onTarget: 1, saves: 3 });
  const gone = howItsGone(tr, ft, { home: 2, away: 0 }, 90);
  assert.equal(
    gone.text,
    "On shots it's Trabzonspor eleven, Hearts ten, and five to one on target. Trabzonspor have been on top, with 61 per cent of the ball and five shots on target to one.",
  );
  assert.deepEqual([...new Set(gone.numbers)].sort((a, b) => a - b), [1, 5, 10, 11, 39, 61]);
  // Half-time: nothing clears its bar, so just the facts.
  const ht = stats({ possession: 56.8, shots: 6, onTarget: 3 }, { shots: 8, onTarget: 1 });
  assert.equal(howItsGone(tr, ht, { home: 1, away: 0 }, 45).text, "Trabzonspor have had 57 per cent of the ball. On shots it's Trabzonspor six, Hearts eight, and three to one on target.");
  assert.match(statsBrief(tr, ht, { home: 1, away: 0 }, 45, 'half-time'), /possession 57-43 per cent, shots 6-8, on target 3-1.*nothing clear-cut/s);
});
