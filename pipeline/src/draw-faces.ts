// Pixel-art portraits of the squad and coaching staff in the style of art/faces/wouter-vrancken.png, drawn by hand in
// the Gemini app (Nano Banana 2 has no free tier on the API): this gets the photos ready and turns the drawings into
// art/faces/<slug>.png, which `npm run faces` then uses in place of the photo.
// Usage: npm run faces:draw -- --photos   each club photo without art yet → pipeline/out/faces-photos/<slug>.png,
//                                         with the prompt in PROMPT.txt beside them
//        npm run faces:draw -- --import   each drawing saved as pipeline/out/faces-drawn/<slug>.png (or .jpg/.webp)
//                                         → art/faces/<slug>.png: background cut out, sized and tidied, and on air
//                                         for anyone already in site/public/faces/faces.json

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ART_SIZE, artPortrait, type Face, PAGES, people } from './faces.ts';
import { fetchText } from './http.ts';
import { slug } from './text.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ART = resolve(ROOT, 'art/faces');
const PHOTOS = resolve(ROOT, 'pipeline/out/faces-photos');
const DRAWN = resolve(ROOT, 'pipeline/out/faces-drawn');
const OUT = resolve(ROOT, 'site/public/faces');

export const PROMPT = `I've attached two images. The first is a pixel-art portrait in our house style. The second is a
photo of a footballer.

Draw the person in the photo as a pixel-art portrait in exactly the same style as the first image: framed like it,
a close crop from the top of the head to just below the shoulders with the head filling the top half (not down to
the waist), facing the camera, a dark outline, a few flat shades per colour with no
gradients or blur, and big clean square pixels on a grid of about 100 by 100. Keep what makes them recognisable:
face shape, skin tone, hair colour and style, facial hair, and the kit they're wearing in the photo. No text, no
border. Put them on a plain flat magenta background (#FF00FF) with nothing else in it.`;

/**
 * A magenta background ("#FF00FF") is cut out: anything as much red and blue over green, including where a JPEG has
 * blended it into the dark outline. Maroon (a lot less blue than red) and skin stay.
 */
const isKey = (r: number, g: number, b: number) => r - g > 60 && b - g > 60 && Math.abs(r - b) < 80;

/** Head and shoulders are this many head-widths across, as in Vrancken's portrait. */
const FRAME_HEADS = 2.4;

/**
 * A drawing as our art: the magenta background cut out, framed head and shoulders like Vrancken's portrait (the
 * model often draws down to the waist), and shrunk to ART_SIZE on the nearest pixel with the colours limited, so it
 * stays crisp.
 */
export async function toArt(drawn: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(drawn).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  for (let i = 0; i < data.length; i += 4) if (isKey(data[i], data[i + 1], data[i + 2])) data[i + 3] = 0;
  // Where the person is: each row's leftmost and rightmost solid pixel.
  const rows: { left: number; right: number }[] = [];
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 128) continue;
      if (left < 0) left = x;
      right = x;
    }
    rows.push({ left, right });
  }
  const top = rows.findIndex((r) => r.left >= 0);
  if (top < 0) throw new Error('nothing but background');
  const bottom = rows.length - 1 - [...rows].reverse().findIndex((r) => r.left >= 0);
  // The head is its widest (at the ears) in the top quarter of the person; the frame is centred on it.
  let head = { left: 0, right: -1 };
  for (const r of rows.slice(top, top + Math.max(1, Math.round((bottom - top) / 4)))) if (r.right - r.left > head.right - head.left) head = r;
  const side = Math.min(Math.round((head.right - head.left + 1) * FRAME_HEADS), width, bottom - top + 1);
  const left = Math.max(0, Math.min(width - side, Math.round((head.left + head.right) / 2 - side / 2)));
  return sharp(data, { raw: info })
    .extract({ left, top, width: side, height: side })
    .resize(ART_SIZE, ART_SIZE, { kernel: 'nearest' })
    .png({ palette: true, colours: 48, dither: 0 })
    .toBuffer();
}

/** The club photos of everyone without art yet, ready to drag into the Gemini app. */
async function photos(): Promise<void> {
  await mkdir(PHOTOS, { recursive: true });
  await writeFile(resolve(PHOTOS, 'PROMPT.txt'), `${PROMPT}\n`);
  let saved = 0;
  for (const page of Object.keys(PAGES)) {
    for (const p of people(await fetchText(`https://www.heartsfc.co.uk/pages/${page}`))) {
      const name = slug(p.name);
      if (existsSync(resolve(ART, `${name}.png`))) continue;
      try {
        const res = await fetch(p.img, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // The cut-out photo on plain grey, so there's no transparency for the app to guess at.
        await sharp(Buffer.from(await res.arrayBuffer())).flatten({ background: '#9a9a9a' }).png().toFile(resolve(PHOTOS, `${name}.png`));
        saved++;
        console.log(`  ✔ ${p.name}`);
      } catch (err) {
        console.log(`  ✘ ${p.name}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    // The club site turns away quick repeat visits.
    await new Promise((r) => setTimeout(r, 3_000));
  }
  console.log(`\n${saved} photos → ${PHOTOS}\nDraw each with the prompt in PROMPT.txt and art/faces/wouter-vrancken.png, and save it as`);
  console.log(`${DRAWN}/<the same name>.png, then run npm run faces:draw -- --import`);
}

/** Every drawing saved so far, as art. */
async function importDrawings(): Promise<void> {
  await mkdir(DRAWN, { recursive: true });
  const files = (await readdir(DRAWN)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  for (const f of files) {
    const name = f.slice(0, -extname(f).length);
    try {
      await writeFile(resolve(ART, `${name}.png`), await toArt(await readFile(resolve(DRAWN, f))));
      console.log(`  ✔ ${name}`);
    } catch (err) {
      console.log(`  ✘ ${name}: ${(err as Error).message}`);
    }
  }
  // On air straight away for anyone already in the squad list (no need to read the club site again); someone new
  // waits for `npm run faces`.
  const listed = existsSync(resolve(OUT, 'faces.json')) ? (JSON.parse(await readFile(resolve(OUT, 'faces.json'), 'utf8')) as Face[]) : [];
  let onAir = 0;
  for (const f of listed) {
    const art = resolve(ART, f.file);
    if (!existsSync(art)) continue;
    await writeFile(resolve(OUT, f.file), await artPortrait(await readFile(art)));
    onAir++;
  }
  console.log(`\n${files.length} drawings → art/faces/; ${onAir} hand-drawn faces on air (anyone new: npm run faces)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const run = args.includes('--import') ? importDrawings : args.includes('--photos') ? photos : undefined;
  if (!run) {
    console.error('usage: npm run faces:draw -- --photos | --import');
    process.exit(1);
  }
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
