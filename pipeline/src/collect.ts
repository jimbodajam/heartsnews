// Milestone 2: pull every enabled source for a club and dump the raw material to pipeline/out/.
// Usage: npm run collect [-- clubs/hearts.json]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, printReport } from './collectors/index.ts';
import type { ClubConfig } from './types.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = resolve(ROOT, 'pipeline/out');

async function main() {
  const clubPath = resolve(ROOT, process.argv[2] ?? 'clubs/hearts.json');
  const club = JSON.parse(await readFile(clubPath, 'utf8')) as ClubConfig;

  console.log(`Collecting for ${club.name}…\n`);
  const { items, match, report } = await collectAll(club);
  printReport(report);

  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, 'items.json'), JSON.stringify(items, null, 2));
  if (match) await writeFile(resolve(OUT, 'match.json'), JSON.stringify(match, null, 2));

  console.log(`\n${items.length} unique items → pipeline/out/items.json`);
  console.log('\nLatest:');
  for (const it of items.slice(0, 12)) {
    console.log(`  ${it.publishedAt.slice(0, 16).replace('T', ' ')}  [${it.sourceId}] ${it.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
