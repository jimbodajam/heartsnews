// Reads an Invision Community thread page (the Jambos Kickback's software) into posts.

import type { Post } from './types.ts';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', pound: '£' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

/** HTML fragment → plain text on one line (entities are decoded twice: some posts are double-escaped). */
function toText(html: string): string {
  return decode(decode(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Takes out every quote, nesting included, and returns the id of the post the first one quoted. */
function stripQuotes(html: string): { html: string; replyTo?: number } {
  let replyTo: number | undefined;
  let out = '';
  let depth = 0;
  for (const part of html.split(/(<blockquote\b[^>]*>|<\/blockquote>)/i)) {
    if (/^<blockquote/i.test(part)) {
      if (depth === 0 && replyTo === undefined) replyTo = Number(/data-ipsquote-contentcommentid="(\d+)"/.exec(part)?.[1]) || undefined;
      depth++;
    } else if (/^<\/blockquote/i.test(part)) depth = Math.max(0, depth - 1);
    else if (depth === 0) out += part;
  }
  return { html: out, replyTo };
}

/** The thread's own title from the page's <title> ("Title - Page 2 - The Terrace - Jambos Kickback"). */
export function threadTitle(html: string): string | undefined {
  const t = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
  return t ? decode(t).replace(/\s+-\s+(Page \d+\s+-\s+)?[^-]+-\s+Jambos Kickback\s*$/, '').trim() || undefined : undefined;
}

export interface ParsedPage {
  /** Pages in the thread, as this page says. */
  pages: number;
  posts: Post[];
}

export function parseThreadPage(html: string): ParsedPage {
  const pages = Number(/data-pages='(\d+)'/.exec(html)?.[1]) || 1;
  const posts: Post[] = [];
  for (const article of html.split('<article ').slice(1)) {
    const id = Number(/id="elComment_(\d+)"/.exec(article)?.[1]);
    const start = article.indexOf("data-role='commentContent'");
    if (!id || start < 0) continue;
    let meta: { username?: string; timestamp?: number } = {};
    try {
      meta = JSON.parse(decode(/data-quoteData='([^']*)'/.exec(article)?.[1] ?? '{}'));
    } catch {
      // Falls back to the <time> tag below.
    }
    const datetime = /<time datetime='([^']+)'/.exec(article)?.[1];
    const ts = meta.timestamp ? new Date(meta.timestamp * 1000).toISOString() : datetime ? new Date(datetime).toISOString() : undefined;
    if (!ts) continue;
    const body = article.slice(article.indexOf('>', start) + 1, article.lastIndexOf('</article>'));
    const { html: own, replyTo } = stripQuotes(body);
    posts.push({ id, ts, ...(meta.username ? { author: meta.username } : {}), text: toText(own), ...(replyTo ? { replyTo } : {}) });
  }
  return { pages, posts };
}
