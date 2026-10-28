// Brings the stored squad into line with the club's pages now: `npm run squad`. The ingest does this by itself the first
// time and daily while a transfer window is open (squad.ts); run this for a loan or free agent signed outside one.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { squadFor } from './squad.ts';
import { storeFromEnv } from './store.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const store = storeFromEnv();
  if (!store) throw new Error('No STORE_TOKEN set: nothing to sync into.');
  const squad = await squadFor(store, new Date(), true);
  console.log(`${squad.length} people in the squad list.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
