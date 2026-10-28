// London Hearts' list of every Hearts player (scores/newplayers/aaplayersbirth.html), read for the appearances and goals
// tally (pipeline/src/tally.ts, issue #35). Kept free of Node so the admin view in the Worker can run the audit with it.

/** One row of their list: who he is, his last Hearts game, and his career apps and goals. */
export interface PlayerRecord {
  id: string;
  name: string;
  /** YYYY-MM-DD; friendlies count, and so does a game on the bench. */
  last: string;
  apps: number;
  goals: number;
}

export const PLAYERS_URL = 'https://www.londonhearts.com/scores/newplayers/aaplayersbirth.html';

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Name, day, month, year, birthplace, nationality, years, first, last, career length, apps, goals. */
export function parsePlayerRecords(html: string): PlayerRecord[] {
  const out: PlayerRecord[] = [];
  for (const [, row] of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const id = c[0]?.match(/newplayers\/(h\d+)\.html/)?.[1];
    if (!id || c.length < 12) continue;
    out.push({ id, name: text(c[0]), last: text(c[8]).slice(0, 10), apps: Number(text(c[10])) || 0, goals: Number(text(c[11])) || 0 });
  }
  return out;
}
