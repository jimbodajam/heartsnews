import type { AdArt, Graphic } from '../../../shared/bulletin';
import { drawText, drawTextCentred, fit, LINE_H, measure, wrap } from './font';
import { C, shade } from './palette';
import { clamp01, ditherV, frame, offscreen, rect, W, H, type Ctx } from './screen';

type Advert = Extract<Graphic, { type: 'advert' }>;

const easeOut = (v: number) => 1 - (1 - v) ** 3;

// 16×16 pictures for the advert cards. Letters pick colours from each picture's own palette; "." is transparent.
const ART: Record<AdArt, { rows: string[]; ink: Record<string, string> }> = {
  pig: {
    ink: { k: '#2a1a1e', p: '#f2a7b5', P: '#d9778b', b: C.ink },
    rows: [
      '..kk........kk..',
      '.kPPk......kPPk.',
      '.kPPpkkkkkkpPPk.',
      '..kppppppppppk..',
      '.kppppppppppppk.',
      '.kppbbppppbbppk.',
      '.kppbbppppbbppk.',
      '.kppppppppppppk.',
      '.kpppPPPPPPpppk.',
      '.kppPPkPPkPPppk.',
      '.kppPPkPPkPPppk.',
      '.kpppPPPPPPpppk.',
      '..kppppppppppk..',
      '...kppppppppk...',
      '....kkkkkkkk....',
      '................',
    ],
  },
  fish: {
    ink: { k: C.ink, y: '#e8b04a', Y: '#b8792a', b: C.ink, c: '#f5d76e', w: C.white, g: '#9aa0ae' },
    rows: [
      '................',
      '................',
      '...kkkkkkkk..kk.',
      '..kyyyyyyyyk.kyk',
      '.kyyYyyYyyyykyyk',
      '.kybyyYyyYyyyyk.',
      '..kyyyyyyyyk.kyk',
      '...kkkkkkkk..kk.',
      '..kckcckcckcck..',
      '.kkkkkkkkkkkkkk.',
      '.kwwwwwwwwwwwwk.',
      '.kwggwwggwwgwwk.',
      '..kwwwwwwwwwwk..',
      '..kwggwwgggwwk..',
      '...kwwwwwwwwk...',
      '....kkkkkkkk....',
    ],
  },
  shirt: {
    ink: { k: C.ink, m: C.maroonLight, M: C.maroon, w: C.white, g: C.gold },
    rows: [
      '................',
      '...kkkk..kkkk...',
      '..kmmmwkkwmmmk..',
      '.kmmmmmwwmmmmmk.',
      'kmmmmmmmmmmmmmmk',
      'kmmkmmmmmmmmkmmk',
      'kkkkmmmmmmmmkkkk',
      '...kmmmmmggmk...',
      '...kmmmmmggmk...',
      '...kmmmmmmmmk...',
      '...kmmmmmmmmk...',
      '...kmmmmmmmmk...',
      '...kmmmmmmmmk...',
      '...kMMMMMMMMk...',
      '...kkkkkkkkkk...',
      '................',
    ],
  },
  pint: {
    ink: { k: C.light, w: C.white, a: '#a85a1c', A: '#6e3510', s: '#e0a060' },
    rows: [
      '................',
      '...kkkkkkkkkk...',
      '...kwwwwwwwwk...',
      '...kwwwwwwwwk...',
      '...kaaaaaaaak...',
      '...kasaaaaaak...',
      '...kasaaaaaak...',
      '....kasaaaak....',
      '....kasaaaak....',
      '....kaAaaAak....',
      '....kaaaaaak....',
      '....kaaaaaak....',
      '....kAAAAAAk....',
      '....kkkkkkkk....',
      '................',
      '................',
    ],
  },
  ticket: {
    ink: { k: C.ink, m: C.maroon, w: C.white, g: C.gold },
    rows: [
      '................',
      '................',
      '................',
      'kkkkkkkkkkkkkkkk',
      'kmmmmmk.wwwwwwwk',
      'kmgmgmkwkkkkkkwk',
      'kgggggkwwwwwwwwk',
      'kmgggmk.wkkkkwwk',
      'kmmgmmkwwwwwwwwk',
      'kmmmmmk.wkkkkkwk',
      'kmmmmmkwwwwwwwwk',
      'kkkkkkkkkkkkkkkk',
      '................',
      '................',
      '................',
      '................',
    ],
  },
};

const artCache = new Map<AdArt, HTMLCanvasElement>();
function artImage(id: AdArt): HTMLCanvasElement {
  let c = artCache.get(id);
  if (!c) {
    const { rows, ink } = ART[id];
    c = offscreen(16, 16, (o) =>
      rows.forEach((row, j) =>
        [...row].forEach((p, i) => {
          if (p === '.' || !ink[p]) return;
          o.fillStyle = ink[p];
          o.fillRect(i, j, 1, 1);
        }),
      ),
    );
    artCache.set(id, c);
  }
  return c;
}

const bgCache = new Map<string, HTMLCanvasElement>();
function background(colour: string): HTMLCanvasElement {
  let c = bgCache.get(colour);
  if (!c) {
    c = offscreen(W, H, (o) => ditherV(o, 0, 0, W, H, [shade(colour, 0.12), colour, shade(colour, -0.35)]));
    bgCache.set(colour, c);
  }
  return c;
}

// Pixel-art backdrops (`npm run adverts` → breaks/<id>-<n>.png, a little bigger than the screen), loaded on first
// use. An advert without one keeps the code-drawn card.
const photos = new Map<string, HTMLImageElement>();
function photoFor(path?: string): HTMLImageElement | undefined {
  if (!path) return undefined;
  let img = photos.get(path);
  if (!img) {
    img = new Image();
    img.src = path;
    photos.set(path, img);
  }
  return img.complete && img.naturalWidth ? img : undefined;
}

/** Fetch an advert's backdrops ahead of time, so a cut to the next shot doesn't flash the plain card. */
export function preloadAdvert(ad: Advert): void {
  photoFor(ad.photo);
}

/** Fine print in a band along the bottom, below the subtitles' area. */
function finePrint(g: Ctx, ad: Advert): void {
  const { bg, fg } = ad.colours;
  rect(g, 0, H - 22, W, 22, shade(bg, -0.5));
  rect(g, 0, H - 22, W, 1, ad.colours.accent);
  if (ad.small) drawTextCentred(g, fit(ad.small.toUpperCase(), W - 20), W / 2, H - 18, fg);
  drawTextCentred(g, 'A FAN-MADE SPOOF ADVERT', W / 2, H - 9, shade(fg, -0.35));
}

/**
 * Over a backdrop: it pans slowly left to right from each cut (`shotAge` ms ago), with the brand and tagline in a
 * panel top left that stays put across cuts.
 */
function drawPhotoAdvert(g: Ctx, ad: Advert, photo: HTMLImageElement, age: number, shotAge: number): void {
  const { bg, fg, accent } = ad.colours;
  const ox = Math.round(Math.min(photo.naturalWidth - W, shotAge * 0.005));
  const oy = Math.round((photo.naturalHeight - H) / 2);
  g.drawImage(photo, ox, oy, W, H, 0, 0, W, H);

  const brand = ad.brand.toUpperCase();
  const tag = wrap(ad.tagline.toUpperCase(), 150).slice(0, 2);
  const pw = Math.max(measure(brand, 2), ...tag.map((l) => measure(l))) + 16;
  const ph = 14 + LINE_H * 2 + tag.length * LINE_H + 4;
  const slide = easeOut(clamp01(age / 450));
  const px = Math.round(8 - (1 - slide) * (pw + 10));
  g.globalAlpha = 0.9;
  rect(g, px, 8, pw, ph, bg);
  g.globalAlpha = 1;
  frame(g, px, 8, pw, ph, accent);
  drawText(g, brand, px + 8, 14, fg, 2);
  rect(g, px + 8, 14 + LINE_H * 2, Math.round(measure(brand, 2) * easeOut(clamp01((age - 400) / 400))), 2, accent);
  const tagIn = clamp01((age - 700) / 300);
  if (tagIn > 0) {
    g.globalAlpha = tagIn;
    tag.forEach((l, i) => drawText(g, l, px + 8, 20 + LINE_H * 2 + i * LINE_H, accent));
    g.globalAlpha = 1;
  }
  finePrint(g, ad);
}

/**
 * A full-screen advert. With a backdrop, see drawPhotoAdvert; otherwise the picture bobs on the left while the
 * brand, a rule and the tagline slide in on the right. `age` is ms since the advert began, `shotAge` since this line.
 */
export function drawAdvert(g: Ctx, ad: Advert, age: number, t: number, shotAge = age): void {
  const photo = photoFor(ad.photo);
  if (photo) return drawPhotoAdvert(g, ad, photo, age, shotAge);
  const { bg, fg, accent } = ad.colours;
  g.drawImage(background(bg), 0, 0);
  frame(g, 4, 4, W - 8, H - 8, accent);

  const artIn = easeOut(clamp01(age / 450));
  const scale = 5;
  const ax = Math.round(20 - (1 - artIn) * 120);
  const ay = Math.round(18 + Math.sin(t * 2.4) * 2);
  // The shadow sits under the picture's lowest row, not the bottom of its 16×16 grid.
  const bottom = ART[ad.art].rows.reduce((b, r, i) => (/[^.]/.test(r) ? i + 1 : b), 0);
  rect(g, ax + 6, 18 + bottom * scale + 2, 16 * scale - 12, 3, shade(bg, -0.5));
  g.drawImage(artImage(ad.art), ax, ay, 16 * scale, 16 * scale);

  const tx = 116;
  const tw = W - tx - 14;
  const brandIn = easeOut(clamp01((age - 200) / 400));
  g.save();
  g.beginPath();
  g.rect(tx, 0, tw + 8, H);
  g.clip();
  const brand = wrap(ad.brand.toUpperCase(), tw, 2).slice(0, 2);
  const by = 24;
  brand.forEach((l, i) => drawText(g, l, Math.round(tx + (1 - brandIn) * tw), by + i * LINE_H * 2, fg, 2));
  const ruleY = by + brand.length * LINE_H * 2 + 2;
  rect(g, tx, ruleY, Math.round(Math.min(tw, measure(brand[0] ?? '', 2)) * easeOut(clamp01((age - 500) / 400))), 2, accent);
  g.restore();

  const tagIn = clamp01((age - 800) / 300);
  if (tagIn > 0) {
    g.globalAlpha = tagIn;
    wrap(ad.tagline.toUpperCase(), tw).slice(0, 3).forEach((l, i) => drawText(g, l, tx, ruleY + 8 + i * LINE_H, accent));
    g.globalAlpha = 1;
  }

  finePrint(g, ad);
}
