import { fetchText } from '../http.ts';
import { mentionsAny, shortHash, truncate } from '../text.ts';
import type { ClubConfig, Item, SourceConfig } from '../types.ts';
import { parseFeed } from './feed.ts';

const DAY_MS = 86_400_000;

function feedUrl(src: SourceConfig): string {
  switch (src.type) {
    case 'youtube':
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${src.url}`;
    case 'reddit':
      return `https://www.reddit.com/r/${src.url}/.rss`;
    default:
      return src.url;
  }
}

/** Google News titles look like "Headline - Publisher"; split the publisher off. */
function splitPublisher(title: string): { title: string; publisher?: string } {
  const i = title.lastIndexOf(' - ');
  return i > 0 ? { title: title.slice(0, i), publisher: title.slice(i + 3) } : { title };
}

export async function collectSource(src: SourceConfig, club: ClubConfig, now = new Date()): Promise<Item[]> {
  const xml = await fetchText(feedUrl(src));
  if (!xml.trim()) throw new Error('empty response');
  const entries = parseFeed(xml);
  const oldest = now.getTime() - (src.maxAgeDays ?? 7) * DAY_MS;

  return entries
    .filter((e) => e.title && e.url && (!e.publishedAt || e.publishedAt.getTime() >= oldest))
    .filter((e) => !src.filter || mentionsAny(`${e.title} ${e.summary}`, club.keywords))
    .map((e) => {
      const { title, publisher } = src.kind === 'aggregator' ? splitPublisher(e.title) : { title: e.title };
      return {
        id: shortHash(e.url),
        sourceId: src.id,
        sourceName: src.name,
        kind: src.kind,
        publisher,
        title,
        // Google News descriptions only repeat the title as a link, so drop them.
        summary: src.kind === 'aggregator' ? '' : truncate(e.summary, 600),
        url: e.url,
        publishedAt: (e.publishedAt ?? now).toISOString(),
        engagement: e.engagement,
      };
    });
}
