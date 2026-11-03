// Timed mouth shapes (#75, #82): Rhubarb's cues, one `<clip>.mouth.json` per clip (written by pipeline/src/lipsync.ts).

/** The mouth shapes a presenter can show. The seated HD sets have no `press`: draw it as `closed` (withoutPress). */
export type MouthShape = 'press' | 'small' | 'wide' | 'A' | 'O' | 'closed';

/** Cue times in seconds into the clip, each with Rhubarb's letter; a cue holds until the next one starts. */
export type MouthCues = [number, string][];

/** Rhubarb's shapes on to the presenters' mouths: A lips together (M B P), B slightly open, C open (EH), D wide open (AA), E rounded (AO), F puckered (OO W), G F and V, H L, X silence. */
const RHUBARB: Record<string, MouthShape> = { A: 'press', B: 'small', C: 'wide', D: 'A', E: 'O', F: 'O', G: 'small', H: 'wide', X: 'closed' };

/** The cues in a parsed `.mouth.json`, or undefined if it is not that shape. */
export function parseMouthCues(json: unknown): MouthCues | undefined {
  const cues = (json as { cues?: unknown } | null)?.cues;
  if (!Array.isArray(cues) || !cues.length) return undefined;
  const ok = cues.every((c) => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'string');
  return ok ? (cues as MouthCues) : undefined;
}

/** The shape `sec` seconds into the clip. Before the first cue, and for letters Rhubarb doesn't use, the mouth is closed. */
export function shapeAt(cues: MouthCues, sec: number): MouthShape {
  let v = 'X';
  for (const [at, c] of cues) {
    if (at > sec) break;
    v = c;
  }
  return RHUBARB[v] ?? 'closed';
}

/** For mouth sets with no `press` (the seated HD presenters). */
export const withoutPress = (shape: MouthShape): MouthShape => (shape === 'press' ? 'closed' : shape);
