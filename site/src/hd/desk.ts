// The HD desk scene (#83): Isla and Fraser seated behind the baked desk, as signed off in the spike
// (site/pixel-broadcast-spike.html?seated=1), driven by the player's state instead of the spike's timeline.

import type { Presenter } from '../../../shared/bulletin';
import { type MouthShape, withoutPress } from '../audio/voice';
import type { FrameState } from '../render/state';
import { loadPresenter, type PresenterArt } from './presenter';
import type { Camera, StudioSet } from './set';

/** Presenter id to their seated HD art. Anyone not in it can't be drawn at the HD desk. */
export type SeatedCast = ReadonlyMap<string, PresenterArt>;

/** Load every seated presenter the set names (set.json `seated.presenters`). */
export async function loadSeatedCast(set: StudioSet): Promise<SeatedCast> {
  const entries = await Promise.all(
    Object.entries(set.seated.presenters).map(async ([id, base]) => [id, await loadPresenter(base)] as const),
  );
  return new Map(entries);
}

/** Who can sit at the HD desk: one presenter with art, or two with art of whom at least one has seats of their own. */
export function canSeat(set: StudioSet, cast: SeatedCast, presenters: readonly Presenter[]): boolean {
  if (presenters.length < 1 || presenters.length > 2) return false;
  if (!presenters.every((p) => cast.has(p.id))) return false;
  return presenters.length === 1 || presenters.some((p) => p.id in set.seated.seats.wide && p.id in set.seated.seats.tight);
}

/**
 * A presenter's seat x in a two-shot (`wide` or `tight`). Someone with no seat of their own (Ross, #89: on the left with
 * Fraser, on the right with Isla) takes the seat their partner leaves free.
 */
export function seatFor(set: StudioSet, kind: 'wide' | 'tight', p: Presenter, partner: Presenter): number {
  const seats = set.seated.seats[kind];
  if (p.id in seats) return seats[p.id];
  return Object.entries(seats).find(([id, x]) => id !== partner.id && x !== seats[partner.id])?.[1] ?? set.seated.seats.alone;
}

const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/** How long a seated head holds before it cuts to the next one (s). */
const HEAD_SLOT = 1.9;
const WHILE_TALKING = ['b1', 'b1', 'h3', 'tilt3', 'b1', 'tilt-3', 'h4', 'b1', 'tilt6', 'b1', 'tilt-6', 'h3'];
const IDLE = ['b1', 'b1', 'b1', 'b1', 'tilt3', 'b1', 'b1', 'tilt-3'];

/**
 * Which head a seated presenter shows. While the other one speaks they look at them for most of the line (`lookTo`: h1 turns
 * to the right edge, h2 to the left). Otherwise the straight head, with a nod or a small lean every couple of seconds while
 * they talk. A head holds for a whole slot, then changes with a cut.
 */
function seatedHead(t: number, place: number, talking: boolean, lookTo?: 'h1' | 'h2'): string {
  const slot = Math.floor(t / HEAD_SLOT) + place * 37;
  if (lookTo) {
    const r = hash(slot * 3.1);
    return r < 0.75 ? lookTo : r < 0.88 ? 'h3' : 'b1';
  }
  const pool = talking ? WHILE_TALKING : IDLE;
  return pool[Math.floor(hash(slot * 7.7 + 1) * pool.length)];
}

/** Loudness on to a mouth, for lines with no timed cues. */
function mouthFromLevel(level: number): MouthShape {
  if (level < 0.05) return 'closed';
  if (level < 0.25) return 'small';
  if (level < 0.55) return 'wide';
  return 'A';
}

/** The mouth to draw: the clip's timed shape, else its loudness; at rest when not talking, with the odd smile. */
export function mouth(s: FrameState, art: PresenterArt, talking: boolean, t: number, now: number): string {
  if (talking && s.speaking) {
    const shape = s.speaking.shape(now);
    // `press` only where the sheet has it (the standing Isla); the others draw it as closed.
    return shape ? (art.mouths.includes('press') ? shape : withoutPress(shape)) : mouthFromLevel(s.speaking.level(now));
  }
  return art.mouths.includes('smile') && t % 5 < 1.2 ? 'smile' : 'rest';
}

/** Where a close-up puts the presenter across the frame when the side panel is up: on the left, as the SD close-up does. */
export const ASIDE = 0.3;

/**
 * The canvas's CSS transform for a camera, putting set x `x` at `at` across the frame (a fraction of its width): the canvas
 * fills the frame, so tight shots are a clean pixel zoom.
 */
function cameraTransform(set: StudioSet, cam: Camera, x: number, at = 0.5): string {
  const tx = ((set.w * at - cam.z * x) / set.w) * 100;
  const ty = ((cam.sy - cam.z * cam.y) / set.h) * 100;
  return `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${cam.z})`;
}

/** A prop centred on `cx`, standing on the desk; `k` > 1 in a tight shot. */
function drawProp(g: CanvasRenderingContext2D, set: StudioSet, name: string, cx: number, k: number): void {
  const p = set.props.items[name];
  if (!p) return;
  const kk = name === 'laptop' && k > 1 ? k * set.props.laptopTight : k;
  const [sx, sy, sw, sh] = p.sheet;
  const w = Math.round(sw * p.s * kk);
  const h = Math.round(sh * p.s * kk);
  const y = set.props.base + Math.round((k - 1) * 26) - (k > 1 && p.side ? 4 : 0) - h - (name === 'laptop' ? set.props.laptopLift : 0);
  // Props are scaled smoothly, unlike everything else.
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(set.propsImg, sx, sy, sw, sh, Math.round(cx - w / 2), y, w, h);
  g.imageSmoothingEnabled = false;
}

/**
 * Draw the desk with `s.onScreen` seated at it (canSeat must hold) and return the canvas's CSS transform.
 * Wide: both at their seats, or one centred alone. Single: tight on the speaker, drawn alone. Hard cuts between them.
 * `at` is where across the frame the shot is centred: 0.5, ASIDE when a panel takes the right, or left of centre while
 * the side column is in (#87).
 */
export function drawDeskScene(
  g: CanvasRenderingContext2D, set: StudioSet, cast: SeatedCast, s: FrameState, now: number, at = 0.5,
): string {
  const t = now / 1000;
  const seated = s.onScreen;
  const both = seated.length === 2;
  const tightOn = s.shot === 'single' ? seated.find((p) => p.id === s.speaker?.id) : undefined;
  const seatX = (p: Presenter) => {
    if (!both) return set.seated.seats.alone;
    return seatFor(set, tightOn ? 'tight' : 'wide', p, seated.find((o) => o.id !== p.id)!);
  };

  g.fillStyle = '#0e0c10';
  g.fillRect(0, 0, set.w, set.h);
  g.save();
  g.translate(0, -set.stack);
  g.drawImage(set.backdropImg, set.backdrop.x, set.backdrop.y);

  const drawn = tightOn ? [tightOn] : seated;
  // Who's talking, if they're at the desk: the other one turns to look at them.
  const talker = seated.find((p) => p.id === s.talking);
  for (const p of drawn) {
    const art = cast.get(p.id)!;
    // Each one's timing is phased by their place in the cast, so they don't nod or blink together.
    const place = Math.max(0, s.cast.findIndex((c) => c.id === p.id));
    const tp = t + place * HEAD_SLOT;
    const talking = p.id === talker?.id;
    const lookTo = talker && !talking && both ? (seatX(talker) > seatX(p) ? 'h1' : 'h2') : undefined;
    const img = art.frame({
      head: seatedHead(tp, place, talking, lookTo),
      pose: talking && Math.sin(tp * 1.7 + 0.5) > 0.35 ? 'd4' : 'b1',
      eye: tp % 3.4 > 3.28 ? 'blink' : 'open',
      mouth: mouth(s, art, talking, tp, now),
    });
    // The sprite row `hcut` meets the desk's back edge; seated figures don't bob.
    g.drawImage(img, seatX(p) - art.w / 2, set.desk.top - set.seated.hcut);
  }
  g.drawImage(set.deskImg, set.desk.x, set.desk.y);

  for (const p of drawn) {
    const name = set.props.default[p.id] ?? 'none';
    const prop = set.props.items[name];
    if (!prop) continue;
    const big = Boolean(tightOn);
    // Small props sit to the side, towards the middle of the desk.
    const toMiddle = seatX(p) <= set.w / 2 ? 1 : -1;
    const dx = (prop.side * set.props.slotSide * (big ? 2 : 1) + set.seated.propx * (big ? 1.3 : 1)) * toMiddle;
    drawProp(g, set, name, seatX(p) + dx, big ? set.props.tightScale : 1);
  }
  g.restore();

  if (!tightOn) return cameraTransform(set, set.camera.wide, set.camera.wide.x as number, at);
  return cameraTransform(set, set.camera.tight, seatX(tightOn), at);
}

/** How dark the studio goes behind a full-screen graphic. */
const FULL_DIM = 0.62;

/** The empty studio, dimmed, in the wide shot: behind a full-screen HD graphic (#87). Returns the canvas's CSS transform. */
export function drawStudioBackdrop(g: CanvasRenderingContext2D, set: StudioSet): string {
  g.fillStyle = '#0e0c10';
  g.fillRect(0, 0, set.w, set.h);
  g.drawImage(set.backdropImg, set.backdrop.x, set.backdrop.y - set.stack);
  g.fillStyle = `rgba(14, 12, 16, ${FULL_DIM})`;
  g.fillRect(0, 0, set.w, set.h);
  return cameraTransform(set, set.camera.wide, set.camera.wide.x as number);
}
