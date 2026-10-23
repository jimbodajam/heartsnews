// One-off: copies the old memory.json (aired stories, opinions, predictions) into the store. Run it once the store is
// set up and before the first build that uses it, while the live site still has memory.json.
// Usage: npm run store:import [-- <url or file>] [--force]
//   With no argument it reads memory.json from the live site (channel.siteUrl). A copy is kept in
//   pipeline/out/memory-import.json. --force imports again even if an import has already been done.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Memory } from './memory.ts';
import type { Channel } from './script/facts.ts';
import { imported, importWrites, storeFromEnv } from './store.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const store = storeFromEnv();
  if (!store) throw new Error('Set STORE_TOKEN in .env first');

  const channel = JSON.parse(await readFile(resolve(ROOT, 'channel.json'), 'utf8')) as Channel;
  const from = args.find((a) => !a.startsWith('--')) ?? (channel.siteUrl && new URL('memory.json', channel.siteUrl).href);
  if (!from) throw new Error('No memory.json to read: pass a URL or file');
  const raw = /^https?:/.test(from) ? await (await fetch(`${from}?t=${Date.now()}`)).text() : await readFile(from, 'utf8');
  const memory = JSON.parse(raw) as Memory;
  if (memory.version !== 1) throw new Error(`${from} isn't a version 1 memory.json`);
  await mkdir(resolve(ROOT, 'pipeline/out'), { recursive: true });
  await writeFile(resolve(ROOT, 'pipeline/out/memory-import.json'), raw);

  if (!force && (await imported(store))) throw new Error('The store already has imported memory; pass --force to import again');
  const statements = importWrites(memory);
  if (!statements.length) return console.log(`Nothing to import from ${from}`);
  await store.batch(statements);
  const presenters = Object.values(memory.presenters);
  console.log(
    `Imported from ${from}: ${memory.aired.length} aired stories, ` +
      `${presenters.reduce((n, p) => n + p.opinions.length, 0)} opinions, ${presenters.reduce((n, p) => n + p.predictions.length, 0)} predictions`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
