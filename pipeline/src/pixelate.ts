// Turns any image into a background at the channel's native 320×180 with a limited palette, so painted or
// AI-generated art sits naturally behind the pixel sprites.
// Usage: npm run pixelate -- art/studio.jpg [site/public/backgrounds/studio.png] [--colours 48]

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--colours');
  const colours = flag >= 0 ? Number(args[flag + 1]) : 48;
  const [input, output = 'site/public/backgrounds/studio.png'] = args.filter((a, i) => !a.startsWith('--') && (flag < 0 || i !== flag + 1));
  if (!input) throw new Error('Usage: npm run pixelate -- <image> [output.png] [--colours N]');

  const out = resolve(ROOT, output);
  await mkdir(dirname(out), { recursive: true });
  await sharp(resolve(ROOT, input))
    // Area-averaging down to the screen size keeps detail; "cover" crops a sliver if the aspect ratio differs.
    .resize(320, 180, { fit: 'cover', kernel: 'mitchell' })
    .modulate({ saturation: 1.1 })
    // A small palette with light dithering gives the hand-placed pixel-art look.
    .png({ palette: true, colours, dither: 0.6 })
    .toFile(out);
  console.log(`${input} → ${output} (320×180, ${colours} colours)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
