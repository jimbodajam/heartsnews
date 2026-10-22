import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AdArt, Graphic, Presenter, Segment } from '../../../shared/bulletin.ts';

// Ad breaks: a few spoof adverts for Gorgie institutions, written once in adverts.json. Their lines never change,
// so their voice clips render once and every later bulletin reuses them (clips are named by a hash of voice and text).

export interface Advert {
  id: string;
  brand: string;
  tagline: string;
  /** Fine print along the bottom, e.g. the address. */
  small?: string;
  art: AdArt;
  colours: { bg: string; fg: string; accent: string };
  /**
   * Backdrop pictures (pixel art), made screen-sized by `npm run adverts` into site/public/adverts/<id>-<n>.png. The
   * advert cuts between them line by line. `position` is which part to keep when cropping to widescreen.
   */
  photos?: { from: string; position?: 'centre' | 'top' | 'bottom' | 'left' | 'right' }[];
  /** Stop airing after this (e.g. a ticket advert after kick-off). */
  until?: string;
  /** The voiceover: `voice` is one of the config's voices; `shot` picks the backdrop (default: the next in turn). */
  lines: { voice: string; text: string; shot?: number }[];
}

export interface AdvertsConfig {
  /** Voiceover artists, in the same shape as presenters so the voice renderer and player can use them. */
  voices: Presenter[];
  /** Each break is a list of advert ids, played in order. */
  breaks: string[][];
  adverts: Advert[];
}

const FILE = fileURLToPath(new URL('../../../adverts.json', import.meta.url));

export function loadAdverts(path = FILE): AdvertsConfig | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as AdvertsConfig) : undefined;
}

/** The ad break segments for this bulletin, leaving out adverts that are past their date. */
export function adBreaks(cfg: AdvertsConfig, now: Date): Segment[] {
  const voices = new Set(cfg.voices.map((v) => v.id));
  return cfg.breaks
    .map((ids, i): Segment => {
      const ads = ids
        .map((id) => cfg.adverts.find((a) => a.id === id))
        .filter((a): a is Advert => Boolean(a) && (!a!.until || Date.parse(a!.until) > now.getTime()));
      return {
        id: `adverts-${i + 1}`,
        kind: 'adverts',
        title: 'Back after the break',
        strap: '',
        scene: 'advert',
        presenters: [],
        lines: ads.flatMap((ad) => {
          const shots = ad.photos?.length ?? 0;
          return ad.lines
            .filter((l) => voices.has(l.voice))
            .map((l, i) => {
              const photo = shots ? `adverts/${ad.id}-${Math.min(l.shot ?? i % shots, shots - 1)}.png` : undefined;
              const graphic: Graphic = { type: 'advert', id: ad.id, brand: ad.brand, tagline: ad.tagline, small: ad.small, art: ad.art, colours: ad.colours, photo };
              return { speaker: l.voice, text: l.text, graphic };
            });
        }),
      };
    })
    .filter((s) => s.lines.length);
}
