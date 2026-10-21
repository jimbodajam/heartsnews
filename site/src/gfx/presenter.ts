import type { PresenterLook } from '../../../shared/bulletin';
import { C, shade } from './palette';
import type { Ctx } from './screen';

export interface Pose {
  /** 0 = closed, 1 = wide open. */
  mouth: number;
  blink: boolean;
  /** Idle bob offset in sprite pixels (0 or 1). */
  bob: number;
}

/** Sprite height in unscaled pixels: seated presenters are cut off by the desk around y = 26. */
export const SEATED_DESK_Y = 26;
export const STANDING_H = 58;

/**
 * Draws a presenter built from rectangles on a grid of `s`-sized pixels.
 * `cx` is the horizontal centre of the face, `top` the top of the head.
 * Sprite x runs -14..13; y runs 0 (hair) to 31 (waist), or 57 (shoes) when standing.
 */
export function drawPresenter(g: Ctx, cx: number, top: number, look: PresenterLook, pose: Pose, s: number, standing = false): void {
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

  if (standing) {
    r(-8, 31, 7, 24, suitDark);
    r(1, 31, 7, 24, suitDark);
    r(-9, 55, 8, 2, C.ink);
    r(1, 55, 8, 2, C.ink);
  }

  // Hair that hangs behind the head and shoulders.
  if (look.hairStyle === 'long') r(-7, 2, 14, 18, hair);
  if (look.hairStyle === 'bob') r(-7, 2, 14, 10, hair);
  if (look.hairStyle === 'ponytail') {
    r(5, 4, 2, 2, hair);
    r(6, 6, 2, 8, hair);
  }

  // Torso and arms.
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
  if (look.tie) {
    r(-1, 17, 2, 1, shade(look.tie, -0.25));
    r(-1, 18, 2, 7, look.tie);
  }

  // Neck and head.
  r(-2, 13, 4, 4, skinShadow);
  r(-5, 2, 10, 12, look.skin);
  r(-6, 4, 12, 8, look.skin);
  r(-7, 7, 1, 2, look.skin);
  r(6, 7, 1, 2, look.skin);
  r(-4, 13, 8, 1, skinShadow);

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
      const len = look.hairStyle === 'long' ? 11 : 7;
      r(-5, 0, 10, 1, hair);
      r(-6, 1, 12, 3, hair);
      r(-7, 3, 2, len, hair);
      r(5, 3, 2, len, hair);
      r(-5, 4, 3, 1, hair);
      break;
    }
  }

  // Face.
  r(-4, 5, 2, 1, hairDark);
  r(2, 5, 2, 1, hairDark);
  if (look.glasses) {
    r(-5, 6, 4, 3, C.ink);
    r(-4, 7, 2, 1, shade(look.skin, 0.3));
    r(1, 6, 4, 3, C.ink);
    r(2, 7, 2, 1, shade(look.skin, 0.3));
    r(-1, 7, 2, 1, C.ink);
  }
  if (pose.blink) {
    r(-4, 7, 2, 1, skinShadow);
    r(2, 7, 2, 1, skinShadow);
  } else {
    r(-3, 7, 1, 1, C.ink);
    r(2, 7, 1, 1, C.ink);
  }
  r(-1, 9, 2, 1, skinShadow);
  if (look.beard) {
    r(-6, 9, 12, 4, hair);
    r(-4, 13, 8, 1, hair);
  }

  const lip = shade(look.skin, -0.4);
  const gap = '#3a1418';
  if (pose.mouth < 0.25) {
    r(-2, 11, 4, 1, lip);
  } else if (pose.mouth < 0.6) {
    r(-2, 11, 4, 1, C.white);
    r(-2, 12, 4, 1, gap);
  } else {
    r(-2, 11, 4, 1, C.white);
    r(-2, 12, 4, 2, gap);
  }
}

/** Natural-looking idle animation from a time (seconds) and a per-presenter phase. */
export function idlePose(t: number, phase: number, mouth: number): Pose {
  const blinkCycle = (t + phase * 1.7) % (3.6 + phase);
  return {
    mouth,
    blink: blinkCycle < 0.13,
    bob: Math.sin(t * 1.1 + phase * 2) > 0.75 ? 1 : 0,
  };
}
