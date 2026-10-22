// Makes each advert's backdrop pictures (adverts.json "photos", pixel art) screen-sized: a little wider than the
// screen so the player can pan slowly across, at roughly one source art-pixel per screen pixel so they stay sharp.
// Re-run after adding or changing a picture. Served from breaks/, not adverts/: ad blockers block any "/adverts/" URL.
// Usage: npm run adverts   → site/public/breaks/<advert id>-<n>.png

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadAdverts } from './script/adverts.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'site/public/breaks');
/**
 * 12% bigger than the 320×180 screen, for the pan. AI pixel art comes out around 1376 px wide with ~4 px art-pixels,
 * so this lands near one art-pixel per screen pixel. No dithering: the art has its own.
 */
const ADVERT_ART = { width: 360, height: 203 };

async function main() {
  const cfg = loadAdverts();
  if (!cfg) throw new Error('No adverts.json');
  await mkdir(OUT, { recursive: true });
  for (const ad of cfg.adverts) {
    for (const [n, { from, position = 'centre' }] of (ad.photos ?? []).entries()) {
      await sharp(resolve(ROOT, from))
        .resize(ADVERT_ART.width, ADVERT_ART.height, { fit: 'cover', position, kernel: 'mitchell' })
        .png({ palette: true, colours: 64, dither: 0 })
        .toFile(resolve(OUT, `${ad.id}-${n}.png`));
      console.log(`  ✔ ${ad.brand} ${n}: ${from}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
