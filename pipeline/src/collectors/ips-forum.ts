import { fetchText } from '../http.ts';
import { decodeEntities, htmlToText, shortHash, truncate } from '../text.ts';
import type { Item, SourceConfig } from '../types.ts';

// Invision Community boards (e.g. the Jambos Kickback). The topic list gives the busiest recent threads;
// the last page of each thread gives what people are saying right now.

const DAY_MS = 86_400_000;
const POSTS_PER_THREAD = 8;

interface Topic {
  title: string;
  url: string;
  lastPageUrl: string;
  replies: number;
  lastPost: Date;
}

/** "1k" → 1000, "555.3k" → 555300, "1,234" → 1234. */
function parseCount(s: string): number {
  const m = /([\d.,]+)\s*([km]?)/i.exec(s.trim());
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Math.round(n * (m[2].toLowerCase() === 'k' ? 1e3 : m[2].toLowerCase() === 'm' ? 1e6 : 1));
}

function parseTopics(html: string): Topic[] {
  const topics: Topic[] = [];
  for (const row of html.split(/data-rowID=/i).slice(1)) {
    if (/title='Pinned'/.test(row)) continue;
    const link = /<a href='([^']*\/topic\/[^']*)'[^>]*title='([^']*)'/.exec(row);
    const times = [...row.matchAll(/<time datetime='([^']+)'/g)].map((m) => new Date(m[1]));
    if (!link || !times.length) continue;
    const replies = /data-statType='forums_comments'>[\s\S]*?ipsDataItem_stats_number'>([^<]+)</.exec(row);
    const lastPage = /ipsPagination_last'><a href='([^']+)'/.exec(row);
    topics.push({
      title: decodeEntities(link[2]).trim(),
      url: decodeEntities(link[1]),
      lastPageUrl: decodeEntities(lastPage?.[1] ?? link[1]).replace(/#.*$/, ''),
      replies: replies ? parseCount(replies[1]) : 0,
      lastPost: times[times.length - 1],
    });
  }
  return topics;
}

/** The most recent posts on a thread page, with quoted replies removed so each snippet is the poster's own words. */
function parsePosts(html: string): string[] {
  return html
    .split('<article ')
    .slice(1)
    .map((post) => {
      const start = post.indexOf("data-role='commentContent'");
      if (start < 0) return '';
      const body = post.slice(post.indexOf('>', start) + 1, post.lastIndexOf('</article>'));
      return htmlToText(body.replace(/<blockquote[\s\S]*?<\/blockquote>/g, ' '));
    })
    .filter((t) => t.length > 3)
    .slice(-POSTS_PER_THREAD)
    .map((t) => truncate(t, 220));
}

export async function collectIpsForum(src: SourceConfig, now = new Date()): Promise<Item[]> {
  const oldest = now.getTime() - (src.maxAgeDays ?? 2) * DAY_MS;
  const hot = parseTopics(await fetchText(src.url))
    .filter((t) => t.lastPost.getTime() >= oldest)
    .sort((a, b) => b.replies - a.replies)
    .slice(0, src.limit ?? 5);

  const items: Item[] = [];
  for (const t of hot) {
    let posts: string[] = [];
    try {
      posts = parsePosts(await fetchText(t.lastPageUrl));
    } catch {
      // Keep the thread title even if its page fails.
    }
    items.push({
      id: shortHash(t.url),
      sourceId: src.id,
      sourceName: src.name,
      kind: src.kind,
      title: t.title,
      summary: posts.join(' | '),
      url: t.url,
      publishedAt: t.lastPost.toISOString(),
      engagement: t.replies,
    });
    // Be polite: one thread page at a time.
    await new Promise((r) => setTimeout(r, 800));
  }
  return items;
}
