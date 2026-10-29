// The club's own team-news post (issue #40): Hearts put the XI out as an image on Instagram before BBC has the sheet
// (13 minutes before on 25 Oct, 30 on 28 Oct), and BBC's early sheet can be wrong. We read it through Meta's official
// Instagram Graph API (Business Discovery), which returns another professional account's recent posts. Nothing here
// scrapes. Fetch only, so the Worker's clock can use it as well as the runners.

import type { LiveMatch } from '../../shared/live.ts';

const API = 'https://graph.facebook.com/v21.0';

/** The accounts whose posts are the club's team news. Posted by the Foundation as a collab on 28 Oct, which is rare. */
export const CLUB_ACCOUNTS = ['heartofmidlothianfc'];

/** The club's post is looked for from this long before kick-off. */
export const POLL_LEAD_MS = 90 * 60_000;
/** A post this long before kick-off (or earlier) is last game's. */
const POST_WINDOW_MS = 6 * 3_600_000;
/** A token with less than this left is warned about. */
export const TOKEN_WARN_DAYS = 7;

export interface ClubPost {
  id: string;
  account: string;
  caption: string;
  /** ISO, when the club posted it. */
  timestamp: string;
  permalink: string;
  /** A signed URL that expires: save the image at once. */
  mediaUrl?: string;
}

export interface InstagramAuth {
  userId: string;
  token: string;
}

interface DiscoveryMedia {
  id?: string;
  caption?: string;
  timestamp?: string;
  permalink?: string;
  media_type?: string;
  media_url?: string;
}

/** The latest posts of one professional account, newest first. */
export async function fetchPosts(account: string, auth: InstagramAuth, limit = 8, fetchFn: typeof fetch = fetch): Promise<ClubPost[]> {
  const fields = `business_discovery.username(${account}){media.limit(${limit}){id,caption,timestamp,permalink,media_type,media_url}}`;
  const url = `${API}/${auth.userId}?${new URLSearchParams({ fields, access_token: auth.token })}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Instagram ${account}: HTTP ${res.status} ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ').replace(auth.token, '***')}`);
  const data = (await res.json()) as { business_discovery?: { media?: { data?: DiscoveryMedia[] } } };
  return (data.business_discovery?.media?.data ?? []).flatMap((m) =>
    m.id && m.timestamp && m.permalink ? [{ id: m.id, account, caption: m.caption ?? '', timestamp: m.timestamp, permalink: m.permalink, ...(m.media_url ? { mediaUrl: m.media_url } : {}) }] : [],
  );
}

/** Every listed account's recent posts together. An account that can't be read is skipped unless none can. */
export async function fetchClubPosts(auth: InstagramAuth, accounts = CLUB_ACCOUNTS, fetchFn: typeof fetch = fetch): Promise<ClubPost[]> {
  const results = await Promise.allSettled(accounts.map((a) => fetchPosts(a, auth, 8, fetchFn)));
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  return ok.flat();
}

export const instagramFrom = (env: { IG_USER_ID?: string; IG_ACCESS_TOKEN?: string }): InstagramAuth | undefined =>
  env.IG_USER_ID && env.IG_ACCESS_TOKEN ? { userId: env.IG_USER_ID, token: env.IG_ACCESS_TOKEN } : undefined;

export const isTeamNews = (p: ClubPost) => /team\s*news/i.test(p.caption);

/** The club's team news for this match: the newest "TEAM NEWS" post from the six hours before kick-off up to kick-off. */
export function findTeamNews(posts: ClubPost[], kickOff: string): ClubPost | undefined {
  const ko = Date.parse(kickOff);
  return posts
    .filter((p) => isTeamNews(p) && Date.parse(p.timestamp) >= ko - POST_WINDOW_MS && Date.parse(p.timestamp) <= ko)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
}

/** Whether to look for the club's post now: before kick-off, from POLL_LEAD_MS ahead of it. */
export const inPollWindow = (m: LiveMatch, now: number) => m.status === 'pre' && now >= Date.parse(m.kickOff) - POLL_LEAD_MS && now < Date.parse(m.kickOff);

/** Days left on a token, from Meta's debug endpoint; undefined if it can't be told. For the admin warning. */
export async function tokenDaysLeft(auth: InstagramAuth, appSecret: string, appId: string, fetchFn: typeof fetch = fetch): Promise<number | undefined> {
  const url = `${API}/debug_token?${new URLSearchParams({ input_token: auth.token, access_token: `${appId}|${appSecret}` })}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  if (!res?.ok) return undefined;
  const data = ((await res.json()) as { data?: { expires_at?: number; is_valid?: boolean } }).data;
  if (data?.is_valid === false) return 0;
  return data?.expires_at ? Math.floor((data.expires_at * 1000 - Date.now()) / 86_400_000) : undefined;
}

/** Swaps a long-lived token for a fresh one (Meta allows it once it is a day old); the new one lasts about 60 days. */
export async function refreshToken(auth: InstagramAuth, appId: string, appSecret: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const url = `${API}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: auth.token })}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`token refresh: HTTP ${res.status}`);
  const token = ((await res.json()) as { access_token?: string }).access_token;
  if (!token) throw new Error('token refresh: no token in the answer');
  return token;
}
