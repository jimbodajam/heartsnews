// HD ad breaks (#92): an advert's backdrop at 480×270 (breaks/<id>-<n>-hd.png, baked by `npm run adverts`) on the HD canvas, the
// brand panel and fine print over it on the SD canvas (drawAdvertOverlay). An advert with no backdrop (the code-drawn cards), or
// whose HD picture hasn't loaded, stays on the SD scene.

import type { Graphic, Segment } from '../../../shared/bulletin';
import type { FrameState } from '../render/state';

type Advert = Extract<Graphic, { type: 'advert' }>;

const photos = new Map<string, HTMLImageElement>();

/** The HD picture for an SD backdrop path (breaks/<id>-<n>.png), once loaded; loading starts the first time it's asked for. */
function hdPhoto(photo: string): HTMLImageElement | undefined {
  const path = photo.replace(/\.png$/, '-hd.png');
  let img = photos.get(path);
  if (!img) {
    img = new Image();
    img.src = path;
    photos.set(path, img);
  }
  return img.complete && img.naturalWidth ? img : undefined;
}

/** The advert this frame is showing, with its HD picture if it has one and it has loaded. */
export function hdAdvert(s: FrameState): { ad: Advert; img: HTMLImageElement } | undefined {
  const ad = s.line?.graphic;
  if (s.mode !== 'show' || ad?.type !== 'advert' || !ad.photo) return undefined;
  const img = hdPhoto(ad.photo);
  return img && { ad, img };
}

/** Ask for every ad break's backdrops ahead of time, so the first shot of a break isn't the plain card while its picture loads. */
export function preloadBreaks(segments: readonly Segment[]): void {
  for (const seg of segments) for (const l of seg.lines) if (l.graphic?.type === 'advert' && l.graphic.photo) hdPhoto(l.graphic.photo);
}

/** The picture on the 480×270 canvas. */
export function drawHdAdvert(g: CanvasRenderingContext2D, img: HTMLImageElement): void {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 480, 270);
  g.drawImage(img, 0, 0);
}
