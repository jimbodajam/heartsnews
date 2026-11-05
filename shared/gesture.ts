// Speech-led arm gestures (#97): when, in a spoken line, a presenter lifts a hand, and which kind of gesture it is.
// Pure: the line's text and its timing in, a list of beats out. The HD scenes (site/src/hd/gesture.ts) turn a beat into a pose.

/** What a gesture is for. `point` is at the screen, so only when a graphic is up and the line refers to it. */
export type BeatKind = 'point' | 'number' | 'name' | 'contrast' | 'open';

/** A gesture held from `start` to `end`, in seconds into the line. */
export type Beat = { start: number; end: number; kind: BeatKind };

/** How long the line runs and where it is silent (seconds), from the clip's mouth cues; `pauses` is empty when there are none. */
export type Timing = { duration: number; pauses: [number, number][] };

/** Silences shorter than this are just the gaps between words. */
const PAUSE = 0.25;
/** The longest a gesture is held, and the least between one gesture ending and the next starting (a calm presenter). */
const HOLD = 2.4;
const GAP = 1.6;
/** A gesture starts this long before its phrase does, so the hand is already up on the first word. */
const LEAD = 0.12;
/** Plain phrases (no number, name, contrast or screen) only gesture sometimes, and only when long enough to be an explanation. */
const PLAIN_MIN_WORDS = 6;
const PLAIN_CHANCE = 0.35;

/** The silent stretches in Rhubarb's cues (`[time, letter]`, a cue holding until the next), at least PAUSE long. The last cue runs to `duration`. */
export function pausesFromCues(cues: readonly [number, string][], duration: number): [number, number][] {
  const out: [number, number][] = [];
  cues.forEach(([at, letter], i) => {
    const end = i + 1 < cues.length ? cues[i + 1][0] : duration;
    if (letter === 'X' && end - at >= PAUSE) out.push([at, end]);
  });
  return out;
}

/** A phrase of the text: its words and where it starts and ends as a fraction of the characters. */
type Phrase = { text: string; from: number; to: number };

/** Split a line at sentence ends and commas, folding very short pieces ("Well,", "Now,") into the next. */
export function phrasesOf(text: string): Phrase[] {
  const pieces: Phrase[] = [];
  const re = /[^.!?,;:—–]+[.!?,;:—–]*\s*/g;
  const total = Math.max(1, text.length);
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    if (raw.trim()) pieces.push({ text: raw.trim(), from: m.index! / total, to: (m.index! + raw.length) / total });
  }
  const out: Phrase[] = [];
  let carry: Phrase | undefined;
  for (const p of pieces) {
    const merged = carry ? { text: `${carry.text} ${p.text}`, from: carry.from, to: p.to } : p;
    carry = undefined;
    if (merged.text.split(/\s+/).length < 3) carry = merged;
    else out.push(merged);
  }
  if (carry) {
    if (out.length) out[out.length - 1] = { text: `${out[out.length - 1].text} ${carry.text}`, from: out[out.length - 1].from, to: carry.to };
    else out.push(carry);
  }
  return out;
}

const NUMBER_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|third|fourth|fifth|nil|double|treble|hat-?trick|brace)\b/i;
const CONTRAST = /^(but|however|although|though|yet|still|despite|whereas|while|instead|even so)\b|\b(but|however|although|despite)\b/i;
const SCREEN = /\b(as you can see|you can see|on screen|on the screen|here we have|here's|here is|look at|take a look|have a look|this table|the table|the graphic|this graphic|this picture|the picture|this chart|these figures|the figures|the numbers|the league table|the standings)\b/i;
const NOT_NAMES = new Set(['Hearts', 'Tynecastle', 'Scotland', 'Scottish', 'Edinburgh', 'The', 'A', 'An', 'In', 'On', 'At', 'And', 'But', 'It', 'He', 'She', 'They', 'We', 'That', 'This', 'There', 'Hearts.', 'I']);

/** What stands out in a phrase, if anything: the first that applies of screen, contrast, number or score, name. */
export function kindOf(phrase: string, screenUp: boolean): BeatKind | undefined {
  if (screenUp && SCREEN.test(phrase)) return 'point';
  if (CONTRAST.test(phrase)) return 'contrast';
  if (/\d/.test(phrase) || NUMBER_WORDS.test(phrase)) return 'number';
  // Two capitalised words in a row that aren't the start of the sentence: a person or a club ("Lawrence Shankland").
  const words = phrase.split(/\s+/).map((w) => w.replace(/[^A-Za-z'’-]/g, ''));
  for (let i = 1; i + 1 < words.length; i++) {
    const [a, b] = [words[i], words[i + 1]];
    if (/^[A-Z]/.test(a) && /^[A-Z]/.test(b) && !NOT_NAMES.has(a) && !NOT_NAMES.has(b)) return 'name';
  }
  return undefined;
}

/** Real time of the `c`th fraction of the spoken characters, counting only the time they're actually being spoken (skipping `pauses`). */
export function timeOfChar(c: number, t: Timing): number {
  const silent = t.pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t.duration) - a), 0);
  const target = c * Math.max(0.001, t.duration - silent);
  let at = 0;
  let spoken = 0;
  for (const [a, b] of t.pauses) {
    const seg = Math.max(0, a - at);
    if (spoken + seg > target) return at + (target - spoken);
    spoken += seg;
    at = Math.max(at, b);
  }
  return at + (target - spoken);
}

const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Where a presenter gestures in a line. A gesture starts just before a phrase that has something to stress, or (some of the time)
 * a long plain one, is held through the phrase up to HOLD, and ends at the next silence. Never more often than GAP apart.
 * `screenUp` is whether a graphic is on screen for them to point at; `seed` varies which plain phrases get one.
 */
export function planBeats(text: string, timing: Timing, screenUp: boolean, seed = 0): Beat[] {
  const beats: Beat[] = [];
  let lastEnd = -Infinity;
  phrasesOf(text).forEach((p, i) => {
    const kind = kindOf(p.text, screenUp) ?? (p.text.split(/\s+/).length >= PLAIN_MIN_WORDS && hash(seed + i * 3.7 + p.from * 11) < PLAIN_CHANCE ? 'open' : undefined);
    if (!kind) return;
    const spoken = timeOfChar(p.from, timing);
    const start = Math.max(0, spoken - LEAD);
    if (start < lastEnd + GAP) return;
    let end = Math.min(timeOfChar(p.to, timing), start + HOLD, timing.duration);
    // Settle at the first real pause inside the phrase.
    const pause = timing.pauses.find(([a]) => a > start + 0.5);
    if (pause) end = Math.min(end, pause[0]);
    if (end - start < 0.8) return;
    beats.push({ start, end, kind });
    lastEnd = end;
  });
  return beats;
}

/** The beat that's on at `sec` into the line, if any. */
export function beatAt(beats: readonly Beat[], sec: number): Beat | undefined {
  return beats.find((b) => sec >= b.start && sec < b.end);
}
