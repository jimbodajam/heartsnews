import { XMLParser } from 'fast-xml-parser';
import { htmlToText } from '../text.ts';

/** A feed entry before it is tagged with source details. Handles RSS 2.0 and Atom (incl. YouTube and Reddit). */
export interface FeedEntry {
  title: string;
  url: string;
  summary: string;
  publishedAt?: Date;
  engagement?: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
});

type Node = unknown;

function list(v: Node): Node[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: Node): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object' && '#text' in v) return text((v as Record<string, Node>)['#text']);
  return '';
}

function field(obj: Node, ...path: string[]): Node {
  let cur = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, Node>)[key];
  }
  return cur;
}

function date(v: string): Date | undefined {
  const d = v ? new Date(v) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
}

export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml) as Node;

  const rssItems = list(field(doc, 'rss', 'channel', 'item'));
  if (rssItems.length) {
    return rssItems.map((it) => ({
      title: htmlToText(text(field(it, 'title'))),
      url: text(field(it, 'link')) || text(field(it, 'guid')),
      summary: htmlToText(
        text(field(it, 'description')) || text(field(it, 'itunes:summary')) || text(field(it, 'content:encoded')),
      ),
      publishedAt: date(text(field(it, 'pubDate'))),
    }));
  }

  return list(field(doc, 'feed', 'entry')).map((e) => {
    const links = list(field(e, 'link'));
    const alt = links.find((l) => text(field(l, '@_rel')) === 'alternate' || !field(l, '@_rel')) ?? links[0];
    const views = Number(text(field(e, 'media:group', 'media:community', 'media:statistics', '@_views')));
    return {
      title: htmlToText(text(field(e, 'title'))),
      url: text(field(alt, '@_href')),
      summary: htmlToText(
        text(field(e, 'media:group', 'media:description')) || text(field(e, 'summary')) || text(field(e, 'content')),
      ),
      publishedAt: date(text(field(e, 'published')) || text(field(e, 'updated'))),
      engagement: Number.isFinite(views) && views > 0 ? views : undefined,
    };
  });
}
