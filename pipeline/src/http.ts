const USER_AGENT = 'Mozilla/5.0 (compatible; HeartsNews24/0.1; hobby fan project)';

export async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fetchJson<T>(url: string, timeoutMs?: number): Promise<T> {
  return JSON.parse(await fetchText(url, timeoutMs)) as T;
}
