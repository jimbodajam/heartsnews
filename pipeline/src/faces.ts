// Builds small pixel-art portraits of the squad and coaching staff from the club's website photos, so
// stories about a person can show their face. Re-run when the squad changes.
// Usage: npm run faces   → site/public/faces/<slug>.png + faces.json
// A hand-made portrait at art/faces/<slug>.png (transparent background) is used instead of the club photo.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fetchText } from './http.ts';
import { decodeEntities } from './text.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'site/public/faces');
const ART = resolve(ROOT, 'art/faces');
const PAGES = ['first-team-squad', 'first-team-coaching-staff'];
export const FACE_SIZE = 24;

export interface Face {
  name: string;
  surname: string;
  file: string;
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** People on a club page: name from the card heading (first + last name spans) and the cut-out photo. */
function people(html: string): { name: string; img: string }[] {
  return html
    .split('featured-card')
    .slice(1)
    .map((card) => {
      const first = /<span class="h6[^"]*">([^<]*)<\/span>/.exec(card)?.[1];
      const last = /<span class="h5[^"]*">([^<]*)<\/span>/.exec(card)?.[1];
      const img = /<img[^>]+src="([^"]+)"/.exec(card)?.[1];
      if (!last || !img || !/\.png/i.test(img)) return undefined;
      return { name: titleCase(decodeEntities(`${first ?? ''} ${last}`).replace(/\s+/g, ' ').trim()), img: `https:${img.replace(/&amp;/g, '&').replace(/width=\d+/, 'width=400')}` };
    })
    .filter((p): p is { name: string; img: string } => Boolean(p));
}

/**
 * Head and shoulders from a cut-out photo: trim the transparent edges, take a square from the top centre,
 * shrink to FACE_SIZE and limit the palette so it reads as pixel art.
 */
export async function portrait(png: Buffer): Promise<Buffer> {
  const trimmed = await sharp(png).trim().toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const side = Math.round(Math.min(width * 0.62, height));
  return sharp(trimmed.data)
    .extract({ left: Math.round((width - side) / 2), top: 0, width: side, height: side })
    .resize(FACE_SIZE, FACE_SIZE, { kernel: 'mitchell' })
    .modulate({ saturation: 1.15 })
    .png({ palette: true, colours: 24, dither: 0.3 })
    .toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const faces: Face[] = [];
  for (const page of PAGES) {
    for (const p of people(await fetchText(`https://www.heartsfc.co.uk/pages/${page}`))) {
      try {
        const file = `${slug(p.name)}.png`;
        const art = resolve(ART, file);
        if (existsSync(art)) {
          await writeFile(resolve(OUT, file), await portrait(await readFile(art)));
          faces.push({ name: p.name, surname: p.name.split(' ').pop() ?? p.name, file });
          console.log(`  ✔ ${p.name} (art/faces)`);
          continue;
        }
        const res = await fetch(p.img, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await writeFile(resolve(OUT, file), await portrait(Buffer.from(await res.arrayBuffer())));
        faces.push({ name: p.name, surname: p.name.split(' ').pop() ?? p.name, file });
        console.log(`  ✔ ${p.name}`);
      } catch (err) {
        console.log(`  ✘ ${p.name}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await writeFile(resolve(OUT, 'faces.json'), `${JSON.stringify(faces, null, 2)}\n`);
  console.log(`\n${faces.length} portraits → site/public/faces/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
