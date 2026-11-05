// On This Day in HD (#88): the museum, presented by a standing presenter (Fraser) at 1:1 on the baked 480x270 backdrops
// (tools/bake/set.mjs, from art/Museum). The first line is outside on the pavement by the steps, the sign to his right; the
// rest are in the gallery, with the line's graphic on the left over the wall panels (a GraphicBox at 'left') and the
// presenter on the right by the display case, glancing across at it every few seconds. As in SD, the scene is the same two
// pictures; only the figure is animated here, in the way /test animates a standing presenter.

import type { Graphic, Presenter } from '../../../shared/bulletin';
import type { FrameState } from '../render/state';
import { mouth } from './desk';
import { gesturePose, type Pools } from './gesture';
import { loadPresenter, type PresenterArt } from './presenter';
import { loadImage, type MuseumData, type Side } from './set';

/** The museum art once loaded: both backdrops and the standing presenters who can be drawn in it. */
export type MuseumArt = Readonly<{
  front: HTMLImageElement;
  inside: HTMLImageElement;
  data: MuseumData;
  cast: ReadonlyMap<string, PresenterArt>;
  /** Per presenter: the arms' last pose and when it changed (see `stagger`). */
  arms: Map<string, Arms>;
  /** Which side each standing sheet points (SetData.points). */
  points: Readonly<Record<string, Side>>;
}>;

export type Arms = { shown?: string; from?: string; to?: string; at: number };

/** Load the museum named in set.json (`museum`), or undefined if the set has none. */
export async function loadMuseum(dir: string, data: MuseumData | undefined, points: Readonly<Record<string, Side>> = {}): Promise<MuseumArt | undefined> {
  if (!data) return undefined;
  const [front, inside, ...art] = await Promise.all([
    loadImage(dir + data.front),
    loadImage(dir + data.inside),
    ...Object.values(data.presenters).map((base) => loadPresenter(base)),
  ]);
  const cast = new Map(Object.keys(data.presenters).map((id, i) => [id, art[i]] as const));
  return { front, inside, data, cast, arms: new Map(), points };
}

/** Whether the museum can be drawn for this frame: the segment's presenter has standing art. */
export function canMuseum(m: MuseumArt | undefined, presenters: readonly Presenter[]): m is MuseumArt {
  const p = presenters[0];
  return Boolean(m && p && m.cast.has(p.id));
}

/** The first line of the segment is outside, the rest in the gallery (as SD). */
export function isOutside(s: FrameState): boolean {
  return Boolean(s.seg && s.line && s.line === s.seg.lines[0]);
}

/** The graphic the museum shows: the line's own, in the gallery only. */
export function museumGraphic(s: FrameState): Graphic | undefined {
  return isOutside(s) || s.graphic?.type === 'caller' ? undefined : s.graphic;
}

const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/** The arms follow the head by this long (ms), as in /test. */
const STAGGER = 150;
/**
 * The standing poses for each kind of beat (#97): b2 points and b9 touches the screen (only with a graphic up), b3 is an open palm
 * for a number or a name, b4 hands together for explaining. b8 (arms open, welcoming) is for sign-offs and isn't used for talking.
 */
const GESTURES: Record<keyof Pools, readonly string[]> = {
  point: ['b2', 'b9'],
  number: ['b3'],
  name: ['b3', 'b4'],
  contrast: ['b3', 'b4'],
  open: ['b4', 'b3'],
};
const HEADS = ['b1', 'h3', 'b1', 'h5', 'b1', 'h4', 'h6', 'h2', 'b1'];
const FEET = ['b1', 'b1', 'f1', 'b1', 'f3', 'b1', 'f2', 'b1'];

/**
 * The arm pose to draw: a change holds the old pose for STAGGER ms after the head has moved, then cuts to the new one
 * (armMotion in /test).
 */
function stagger(a: Arms, want: string, now: number): string {
  if (a.shown === undefined) a.shown = want;
  if (a.to !== undefined && (now >= a.at || want !== a.to)) {
    a.shown = a.to;
    a.to = undefined;
  }
  if (a.to === undefined && want !== a.shown) {
    a.from = a.shown;
    a.to = want;
    a.at = now + STAGGER;
  }
  return a.to !== undefined ? a.from! : a.shown;
}

/** The figure at its place: sprite 1:1, centred on `x`, its last row on `feet`. The upper body breathes 1 px; the hem row is doubled to close the gap. */
function drawFigure(g: CanvasRenderingContext2D, art: PresenterArt, img: HTMLCanvasElement, x: number, feet: number, up: boolean): void {
  const left = Math.round(x - art.w / 2);
  const top = feet - art.h;
  const cut = art.feetTop ?? Math.round(art.h * 0.64);
  if (!up) {
    g.drawImage(img, left, top);
    return;
  }
  g.drawImage(img, 0, 0, img.width, cut, left, top - 1, img.width, cut);
  g.drawImage(img, 0, cut - 1, img.width, 1, left, top + cut - 1, img.width, 1);
  g.drawImage(img, 0, cut, img.width, img.height - cut, left, top + cut, img.width, img.height - cut);
}

/**
 * Draw the museum frame on the 480x270 canvas: the backdrop for this line and the presenter standing in it, idle (weight
 * shifts, the odd head turn) or gesturing while talking, blinking, with their mouth from the clip's timed shapes (else
 * its loudness). In the gallery they glance at the graphic every few seconds while it shows.
 */
export function drawMuseum(g: CanvasRenderingContext2D, m: MuseumArt, s: FrameState, now: number): void {
  const outside = isOutside(s);
  g.fillStyle = '#0e0c10';
  g.fillRect(0, 0, 480, 270);
  g.drawImage(outside ? m.front : m.inside, 0, 0);

  const p = s.onScreen[0];
  const art = p && m.cast.get(p.id);
  if (!p || !art) return;
  const place = outside ? m.data.outside : m.data.gallery;
  const glancing = !outside && Boolean(museumGraphic(s)) && (now / 1000) % m.data.glance.every < m.data.glance.for;
  drawStanding(g, art, m.arms, p.id, s, now, place, glancing, { screen: 'left', points: m.points[p.id] ?? 'left' });
}

/** The names a sheet has of one kind, from the wanted ones in order (so a presenter with fewer frames still has a full list). */
const have = (wanted: readonly string[], has: readonly string[], fallback: string) => {
  const list = wanted.filter((n) => has.includes(n));
  return list.length ? list : [fallback];
};

/**
 * A standing presenter at `place` (last row on `place.feet`): as /test's Fraser, gestures while talking (a new one every ~3 s),
 * otherwise their weight on one hip now and then, head drifting, blinking, mouth from the clip. `glancing` turns the head
 * (h2) and eyes to the graphic on their left. Frames the sheet lacks are left out of the rotation, and the screen touch
 * (b9) is a gesture only where the sheet has it.
 */
export function drawStanding(
  g: CanvasRenderingContext2D,
  art: PresenterArt,
  armsOf: Map<string, Arms>,
  id: string,
  s: FrameState,
  now: number,
  place: { x: number; feet: number },
  glancing: boolean,
  facing: { screen: Side; points: Side },
): void {
  const t = now / 1000;
  const talking = s.talking === id;
  const pools: Pools = Object.fromEntries(Object.entries(GESTURES).map(([k, v]) => [k, v.filter((n) => art.poses.includes(n))]));
  const heads = have(HEADS, art.heads, 'b1');
  const feets = have(FEET, art.feet, 'b1');
  // Arms at rest unless a gesture is on, which follows the speech (#97); a hand on the hip now and then while listening.
  const pose = talking ? (gesturePose(s, now, id, pools) ?? 'b1') : Math.floor(t / 6) % 3 === 0 && art.poses.includes('b6') ? 'b6' : 'b1';
  // Turns to the graphic when glancing, the way the sheet points (h2 and gazeL turn to the picture's left, h1 and gazeR to its
  // right; a flipped figure turns the other way on screen); otherwise the head drifts, and a gesture at the graphic turns it too.
  const turn = facing.points === 'left' ? 'h2' : 'h1';
  const gaze = facing.points === 'left' ? 'gazeL' : 'gazeR';
  const head = glancing && art.heads.includes(turn) ? turn : heads[Math.floor(hash(Math.floor(t / 2.6) * 1.7) * heads.length)];
  const feet = feets[Math.floor(hash(Math.floor(t / 7) * 3.3) * feets.length)];
  const eye = (t + 1.3) % 4.2 > 4.08 ? 'blink' : glancing && art.eyes.includes(gaze) ? gaze : 'open';
  const arms = armsOf.get(id) ?? { at: 0 };
  armsOf.set(id, arms);
  const img = art.frame({
    head,
    pose: stagger(arms, pose, now),
    feet,
    eye,
    mouth: mouth(s, art, talking, t, now),
  });
  // A sheet that points the other way from the screen is drawn mirrored about its centre.
  const flip = facing.points !== facing.screen;
  if (flip) {
    g.save();
    g.translate(place.x * 2, 0);
    g.scale(-1, 1);
  }
  drawFigure(g, art, img, place.x, place.feet, Math.sin(t * 1.85) > 0.6);
  if (flip) g.restore();
}
