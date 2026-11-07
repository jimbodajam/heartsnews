const USER_AGENT = 'Mozilla/5.0 (compatible; HeartsNews24/0.1; hobby fan project)';

export async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new HttpError(res.status, retryAfterSeconds(res.headers));
  return res.text();
}

export class HttpError extends Error {
  /** retryAfter: seconds the server asked us to wait (Retry-After or x-ratelimit-reset), when it said. */
  constructor(readonly status: number, readonly retryAfter?: number) {
    super(`HTTP ${status}`);
  }
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get('retry-after') ?? headers.get('x-ratelimit-reset');
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function fetchJson<T>(url: string, timeoutMs?: number): Promise<T> {
  return JSON.parse(await fetchText(url, timeoutMs)) as T;
}
