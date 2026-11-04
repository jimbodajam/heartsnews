// The Match Centre in HD (#92): the touchscreen set (hd/touchscreen.png, baked by tools/bake/set.mjs from art/scenes) with a
// standing presenter (Kirsty) on its right, at 1:1. The line's graphic goes over the screen's dark panel (HTML for a type HD
// draws, else the SD panel; with no graphic the idle screen). Like the museum, only the figure is animated.

import type { Presenter } from '../../../shared/bulletin';
import type { FrameState } from '../render/state';
import { drawStanding, type Arms } from './museum';
import { loadPresenter, type PresenterArt } from './presenter';
import { loadImage, type TouchData } from './set';

export type TouchArt = Readonly<{
  backdrop: HTMLImageElement;
  data: TouchData;
  cast: ReadonlyMap<string, PresenterArt>;
  arms: Map<string, Arms>;
}>;

/** Load the touchscreen set named in set.json (`touchscreen`), or undefined if the set has none. */
export async function loadTouch(dir: string, data: TouchData | undefined): Promise<TouchArt | undefined> {
  if (!data) return undefined;
  const [backdrop, ...art] = await Promise.all([loadImage(dir + data.file), ...Object.values(data.presenters).map((base) => loadPresenter(base))]);
  const cast = new Map(Object.keys(data.presenters).map((id, i) => [id, art[i]] as const));
  return { backdrop, data, cast, arms: new Map() };
}

/** Whether the touchscreen can be drawn in HD: the segment's presenter has standing art for it (else the SD scene). */
export function canTouch(t: TouchArt | undefined, presenters: readonly Presenter[]): t is TouchArt {
  const p = presenters[0];
  return Boolean(t && p && t.cast.has(p.id));
}

/** Draw the frame on the 480x270 canvas: the set, and the presenter glancing at the screen every few seconds while there is a graphic. */
export function drawTouch(g: CanvasRenderingContext2D, t: TouchArt, s: FrameState, now: number): void {
  g.fillStyle = '#0e0c10';
  g.fillRect(0, 0, 480, 270);
  g.drawImage(t.backdrop, 0, 0);
  const p = s.onScreen[0];
  const art = p && t.cast.get(p.id);
  if (!p || !art) return;
  const glancing = Boolean(s.graphic) && (now / 1000) % t.data.glance.every < t.data.glance.for;
  drawStanding(g, art, t.arms, p.id, s, now, t.data.stand, glancing);
}
