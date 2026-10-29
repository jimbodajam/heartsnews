// The Instagram login for the club's team-news graphic (issue #40) lapses after about 60 days. This says how long is left
// and, with --refresh, prints a fresh token to put in .env, the Worker secret and the GitHub secret.
// Usage: npm run ig-token [-- --refresh]

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { instagramFrom, refreshToken, TOKEN_WARN_DAYS, tokenDaysLeft } from './club-post.ts';

const APP_ID = '1800982931110897';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const envFile = new URL('../../.env', import.meta.url);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const auth = instagramFrom(process.env);
  const secret = process.env.IG_APP_SECRET;
  if (!auth || !secret) throw new Error('IG_USER_ID, IG_ACCESS_TOKEN and IG_APP_SECRET are needed');
  const days = await tokenDaysLeft(auth, secret, APP_ID);
  console.log(days === undefined ? "Couldn't tell how long the token has left" : `${days} days left${days <= TOKEN_WARN_DAYS ? ': REFRESH NOW' : ''}`);
  if (process.argv.includes('--refresh')) console.log(`IG_ACCESS_TOKEN=${await refreshToken(auth, APP_ID, secret)}`);
}
