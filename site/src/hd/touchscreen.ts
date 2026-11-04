// The standing-presenter screen scenes in HD (#92): the Match Centre touchscreen (Kirsty on the right) and the Transfer Centre
// (Ross behind his podium on the left, a wall clock). Each is a baked 480x270 backdrop (hd/touchscreen.png, hd/transfer.png) with a
// dark screen box the line's graphic goes over (HTML for a type HD draws, else the SD panel; with no graphic the idle screen).
// Like the museum, only the figure is animated.

import type { Presenter } from '../../../shared/bulletin';
import type { FrameState } from '../render/state';
import { drawStanding, type Arms } from './museum';
import { loadPresenter, type PresenterArt } from './presenter';
import { loadImage, type SceneData } from './set';
import { drawTextCentred } from '../gfx/font';

export type SceneArt = Readonly<{
  backdrop: HTMLImageElement;
  data: SceneData;
  cast: ReadonlyMap<string, PresenterArt>;
  arms: Map<string, Arms>;
  /** The podium sprite, in a scene that has one. */
  podium?: HTMLImageElement;
}>;

/** Load a scene named in set.json (`touchscreen`, `transfer`), or undefined if the set has none. */
export async function loadScene(dir: string, data: SceneData | undefined): Promise<SceneArt | undefined> {
  if (!data) return undefined;
  const [backdrop, podium, ...art] = await Promise.all([
    loadImage(dir + data.file),
    data.podium ? loadImage(dir + data.podium.file) : undefined,
    ...Object.values(data.presenters).map((base) => loadPresenter(base)),
  ]);
  const cast = new Map(Object.keys(data.presenters).map((id, i) => [id, art[i]] as const));
  return { backdrop, podium, data, cast, arms: new Map() };
}

/** Whether the scene can be drawn in HD: the segment's presenter has standing art for it (else the SD scene). */
export function canScene(t: SceneArt | undefined, presenters: readonly Presenter[]): t is SceneArt {
  const p = presenters[0];
  return Boolean(t && p && t.cast.has(p.id));
}

/** A line of pixels with no smoothing, from the clock's centre. */
function hand(g: CanvasRenderingContext2D, cx: number, cy: number, frac: number, len: number, color: string): void {
  const a = frac * Math.PI * 2;
  g.fillStyle = color;
  for (let i = 0; i <= len; i++) g.fillRect(Math.round(cx + Math.sin(a) * i), Math.round(cy - Math.cos(a) * i), 1, 1);
}

/**
 * Draw the frame on the 480x270 canvas: the set, the clock's hands if it has a clock, the presenter (glancing at the screen
 * every few seconds while there is a graphic), then the podium over them if the scene has one.
 */
export function drawScene(g: CanvasRenderingContext2D, t: SceneArt, s: FrameState, now: number): void {
  const { data } = t;
  g.fillStyle = '#0e0c10';
  g.fillRect(0, 0, 480, 270);
  g.drawImage(t.backdrop, 0, 0);
  if (data.clock) {
    const d = new Date();
    const m = d.getMinutes() + d.getSeconds() / 60;
    const { x, y, r } = data.clock;
    hand(g, x, y, ((d.getHours() % 12) + m / 60) / 12, Math.round(r * 0.45), '#1d1a22');
    hand(g, x, y, m / 60, Math.round(r * 0.75), '#1d1a22');
    hand(g, x, y, d.getSeconds() / 60, Math.round(r * 0.85), '#c8322b');
  }
  const p = s.onScreen[0];
  const art = p && t.cast.get(p.id);
  if (p && art) {
    const glancing = Boolean(s.graphic) && (now / 1000) % data.glance.every < data.glance.for;
    drawStanding(g, art, t.arms, p.id, s, now, data.stand, glancing);
  }
  if (data.podium && t.podium) {
    const { x, feet, w, h, label } = data.podium;
    const left = Math.round(x - w / 2);
    const top = feet - h;
    g.drawImage(t.podium, left, top);
    drawTextCentred(g, 'TRANSFER', left + label.cx, top + label.cy - 7, '#e0b13a');
    drawTextCentred(g, 'CENTRE', left + label.cx, top + label.cy + 1, '#e0b13a');
  }
}
