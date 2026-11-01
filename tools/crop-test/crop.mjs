// Cuts the enlarged head crops of Fraser for the #71 test: head and collar, 3x nearest-neighbour.
// Run from the repo root: node tools/crop-test/crop.mjs
import sharp from 'sharp';
const D = 'site/public/spike/fraser/standing/', OUT = 'tools/crop-test/out/';
export const BOX = { left: 236, top: 30, width: 376, height: 300 }, SCALE = 3;
if (process.argv[1]?.endsWith("crop.mjs")) for (const n of ['b1', 'h3']) {
  await sharp(D + n + '.jpg').extract(BOX).resize(BOX.width * SCALE, BOX.height * SCALE, { kernel: 'nearest' }).png().toFile(OUT + `crop-${n}.png`);
}
console.log('done');
