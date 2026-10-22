import type { PresenterLook } from '../../../shared/bulletin';
import { C, shade } from './palette';
import { offscreen, type Ctx } from './screen';

export interface Pose {
  /** 0 = closed, 1 = wide open. */
  mouth: number;
  blink: boolean;
  /** Idle bob offset in sprite pixels (0 or 1). */
  bob: number;
  /** Where they're looking: -1 left, 0 camera, 1 right (eyes and nose shift a pixel). */
  look?: number;
}

/** Sprite height in unscaled pixels: seated presenters are cut off by the desk around y = 26. */
export const SEATED_DESK_Y = 26;
export const STANDING_H = 58;

// Presenters are painted at 1× into a small sprite canvas, outlined, then scaled up onto the screen.
// Sprite x runs -14..13 and y -2..57 around an origin of (OX, OY) in that canvas.
const SPR_W = 40;
const SPR_H = 66;
const OX = 20;
const OY = 4;
const OUTLINE = '#0b0a0e';
const sprite = offscreen(SPR_W, SPR_H, () => {});
const silhouette = offscreen(SPR_W, SPR_H, () => {});

/**
 * Draws a presenter on a grid of `s`-sized pixels with a one-pixel dark outline, like hand-made pixel art.
 * `cx` is the horizontal centre of the face, `top` the top of the head.
 */
export function drawPresenter(g: Ctx, cx: number, top: number, look: PresenterLook, pose: Pose, s: number, standing = false): void {
  const sg = sprite.getContext('2d')!;
  sg.clearRect(0, 0, SPR_W, SPR_H);
  paintPresenter(sg, OX, OY, look, pose, 1, standing);

  const og = silhouette.getContext('2d')!;
  og.globalCompositeOperation = 'source-over';
  og.clearRect(0, 0, SPR_W, SPR_H);
  og.drawImage(sprite, 0, 0);
  og.globalCompositeOperation = 'source-in';
  og.fillStyle = OUTLINE;
  og.fillRect(0, 0, SPR_W, SPR_H);
  og.globalCompositeOperation = 'source-over';

  const x0 = Math.round(cx - OX * s);
  const y0 = Math.round(top - OY * s);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.drawImage(silhouette, x0 + dx * s, y0 + dy * s, SPR_W * s, SPR_H * s);
  g.drawImage(sprite, x0, y0, SPR_W * s, SPR_H * s);
}

/** Paints a presenter from rectangles. `cx`/`top` are the face centre and top of head, in `s`-sized pixels. */
function paintPresenter(g: Ctx, cx: number, top: number, look: PresenterLook, pose: Pose, s: number, standing = false): void {
  const y0 = top + pose.bob * s;
  const r = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(Math.round(cx + x * s), Math.round(y0 + y * s), w * s, h * s);
  };
  const skinShadow = shade(look.skin, -0.18);
  const hairDark = shade(look.hair, -0.3);
  const suitDark = shade(look.suit, -0.28);
  const suitLight = shade(look.suit, 0.15);
  const { hair } = look;
  const fem = look.build === 'female';

  if (standing) {
    r(-8, 31, 7, 24, suitDark);
    r(1, 31, 7, 24, suitDark);
    r(-9, 55, 8, 2, C.ink);
    r(1, 55, 8, 2, C.ink);
  }

  // Hair that hangs behind the head and shoulders. Women's styles are fuller and fall past the shoulders.
  if (look.hairStyle === 'long') r(fem ? -8 : -7, 2, fem ? 16 : 14, fem ? 21 : 18, hair);
  if (look.hairStyle === 'bob') r(fem ? -8 : -7, 2, fem ? 16 : 14, fem ? 13 : 10, hair);
  if (look.hairStyle === 'ponytail') {
    r(5, 4, 2, 2, hair);
    r(6, 6, 2, 8, hair);
  }

  // Torso and arms: a narrower, tailored jacket with an open neckline for women; suit, shirt and tie for men.
  if (fem) {
    r(-10, 17, 20, 1, look.suit);
    r(-11, 18, 22, 14, look.suit);
    r(-13, 21, 3, standing ? 12 : 11, suitDark);
    r(10, 21, 3, standing ? 12 : 11, suitDark);
    if (standing) {
      r(-13, 33, 3, 3, look.skin);
      r(10, 33, 3, 3, look.skin);
    }
    r(-3, 16, 6, 6, look.shirt);
    r(-2, 16, 4, 3, look.skin);
    r(-1, 19, 2, 1, look.skin);
    r(-2, 18, 4, 1, C.gold);
    r(-1, 19, 2, 1, C.gold);
    r(-4, 17, 1, 8, suitLight);
    r(3, 17, 1, 8, suitLight);
    r(-10, 18, 5, 1, suitLight);
    r(5, 19, 5, 13, shade(look.suit, -0.12));
  } else {
    r(-11, 17, 22, 1, look.suit);
    r(-12, 18, 24, 14, look.suit);
    r(-14, 21, 3, standing ? 12 : 11, suitDark);
    r(11, 21, 3, standing ? 12 : 11, suitDark);
    if (standing) {
      r(-14, 33, 3, 3, look.skin);
      r(11, 33, 3, 3, look.skin);
    }
    r(-3, 16, 6, 2, look.shirt);
    r(-2, 18, 4, 3, look.shirt);
    r(-1, 21, 2, 3, look.shirt);
    r(-4, 17, 1, 7, suitLight);
    r(3, 17, 1, 7, suitLight);
    // Light from the left: a lit shoulder, and the far side of the jacket in shade.
    r(-11, 18, 5, 1, suitLight);
    r(5, 19, 6, 13, shade(look.suit, -0.12));
    if (look.tie) {
      r(-1, 17, 2, 1, shade(look.tie, -0.25));
      r(-1, 18, 2, 7, look.tie);
    }
  }

  // Neck and head. Women get a softer, narrower jaw.
  r(-2, 13, 4, 4, skinShadow);
  if (fem) {
    r(-5, 2, 10, 11, look.skin);
    r(-6, 4, 12, 7, look.skin);
    r(-4, 12, 8, 1, look.skin);
    r(-3, 13, 6, 1, look.skin);
  } else {
    r(-5, 2, 10, 12, look.skin);
    r(-6, 4, 12, 8, look.skin);
    r(-4, 13, 8, 1, skinShadow);
  }
  r(-7, 7, 1, 2, look.skin);
  r(6, 7, 1, 2, look.skin);
  // Shade down the far side of the face, and a little light on the near cheek.
  r(5, 4, 1, fem ? 7 : 8, skinShadow);
  r(-5, 6, 1, 3, shade(look.skin, 0.12));

  switch (look.hairStyle) {
    case 'short':
    case 'ponytail':
      r(-5, 0, 10, 1, hair);
      r(-6, 1, 12, 3, hair);
      r(-6, 4, 1, look.hairStyle === 'short' ? 3 : 2, hair);
      r(5, 4, 1, look.hairStyle === 'short' ? 3 : 2, hair);
      break;
    case 'quiff':
      r(-2, -2, 6, 1, hair);
      r(-4, -1, 8, 1, hair);
      r(-1, -1, 3, 1, shade(hair, 0.25));
      r(-5, 0, 10, 1, hair);
      r(-6, 1, 12, 3, hair);
      r(-6, 4, 1, 3, hair);
      r(5, 4, 1, 3, hair);
      break;
    case 'bald':
      r(-6, 5, 1, 4, hair);
      r(5, 5, 1, 4, hair);
      r(-2, 3, 2, 1, shade(look.skin, 0.25));
      break;
    case 'long':
    case 'bob': {
      if (fem) {
        // Fuller crown, a side-swept fringe, and strands framing the face rather than covering it.
        const len = look.hairStyle === 'long' ? 16 : 10;
        r(-5, -1, 10, 1, hair);
        r(-6, 0, 12, 3, hair);
        r(-7, 2, 14, 1, hair);
        r(-6, 3, 6, 1, hair);
        r(-6, 4, 3, 1, hair);
        r(-7, 3, 1, len, hair);
        r(6, 3, 1, len, hair);
        r(-1, 0, 4, 1, shade(hair, 0.25));
      } else {
        const len = look.hairStyle === 'long' ? 11 : 7;
        r(-5, 0, 10, 1, hair);
        r(-6, 1, 12, 3, hair);
        r(-7, 3, 2, len, hair);
        r(5, 3, 2, len, hair);
        r(-5, 4, 3, 1, hair);
      }
      break;
    }
  }

  // A highlight where the studio lights catch the hair.
  if (look.hairStyle !== 'bald') r(-4, look.hairStyle === 'quiff' ? 0 : 1, 3, 1, shade(hair, 0.3));

  // Face.
  r(-4, 5, 2, 1, hairDark);
  r(2, 5, 2, 1, hairDark);
  if (fem) {
    // Earrings, and a touch of blush on the cheeks.
    r(-7, 9, 1, 2, C.gold);
    r(6, 9, 1, 2, C.gold);
    g.globalAlpha = 0.35;
    r(-5, 9, 2, 1, '#e0606a');
    r(3, 9, 2, 1, '#e0606a');
    g.globalAlpha = 1;
  }
  if (look.glasses) {
    r(-5, 6, 4, 3, C.ink);
    r(-4, 7, 2, 1, shade(look.skin, 0.3));
    r(1, 6, 4, 3, C.ink);
    r(2, 7, 2, 1, shade(look.skin, 0.3));
    r(-1, 7, 2, 1, C.ink);
  }
  // Eyes (and nose) shift a pixel towards whoever they're looking at.
  const lx = pose.look ?? 0;
  if (pose.blink) {
    r(-4, 7, 2, 1, skinShadow);
    r(2, 7, 2, 1, skinShadow);
  } else if (fem) {
    // Wider eyes with a lash flick at the outer corners.
    r(-4 + (lx > 0 ? 1 : 0), 7, lx ? 1 : 2, 1, C.ink);
    r(2 + (lx > 0 ? 1 : 0), 7, lx ? 1 : 2, 1, C.ink);
    r(-5, 6, 1, 1, C.ink);
    r(4, 6, 1, 1, C.ink);
  } else {
    r(-3 + lx, 7, 1, 1, C.ink);
    r(2 + lx, 7, 1, 1, C.ink);
  }
  r(-1 + lx, 9, 2, 1, skinShadow);
  if (look.beard) {
    r(-6, 9, 12, 4, hair);
    r(-4, 13, 8, 1, hair);
  }

  const lip = fem ? '#b8434f' : shade(look.skin, -0.4);
  const gap = '#3a1418';
  if (pose.mouth < 0.25) {
    r(-2, 11, 4, 1, lip);
  } else if (pose.mouth < 0.6) {
    r(-2, 11, 4, 1, fem ? lip : C.white);
    r(-2, 12, 4, 1, gap);
  } else {
    r(-2, 11, 4, 1, fem ? lip : C.white);
    r(-2, 12, 4, 2, gap);
  }
}

/** Natural-looking idle animation from a time (seconds) and a per-presenter phase. */
export function idlePose(t: number, phase: number, mouth: number, look = 0): Pose {
  const blinkCycle = (t + phase * 1.7) % (3.6 + phase);
  return {
    mouth,
    blink: blinkCycle < 0.13,
    bob: Math.sin(t * 1.1 + phase * 2) > 0.75 ? 1 : 0,
    look,
  };
}

/** How far (in sprite pixels) a speaker's hand is raised: a gesture every few seconds while they talk. */
export function gestureLift(t: number, phase: number, talking: boolean): number {
  if (!talking) return 0;
  const wave = Math.sin(t * 1.3 + phase * 3);
  return wave > 0.8 ? 4 : wave > 0.6 ? 2 : 0;
}
