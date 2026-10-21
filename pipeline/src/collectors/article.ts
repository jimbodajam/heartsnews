import { fetchText } from '../http.ts';
import { decodeEntities, htmlToText } from '../text.ts';

// Pulls the readable body text out of a news article page, so stories can be covered in depth.

const BOILERPLATE =
  /cookie|subscribe|newsletter|sign up|read more|follow us|download the app|all rights reserved|advertisement|click here|privacy|terms and conditions|copyright|^share|whatsapp|our journalism/i;

/** Most news sites embed the full text as schema.org JSON-LD; use that when present. */
function fromJsonLd(html: string): string | undefined {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data: unknown = JSON.parse(m[1]);
      const nodes = (Array.isArray(data) ? data : [data]).flatMap((d) =>
        d && typeof d === 'object' && '@graph' in d ? (d as { '@graph': unknown[] })['@graph'] : [d],
      );
      for (const n of nodes) {
        const body = n && typeof n === 'object' ? (n as { articleBody?: unknown }).articleBody : undefined;
        if (typeof body === 'string' && body.length > 300) return htmlToText(body);
      }
    } catch {
      // Malformed JSON-LD is common; fall through to paragraphs.
    }
  }
  return undefined;
}

/** Otherwise, the paragraphs inside <article> (or the whole page), minus obvious boilerplate. */
function fromParagraphs(html: string): string {
  const scope = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  return [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(htmlToText(m[1])))
    .filter((p) => p.length > 40 && !BOILERPLATE.test(p))
    .join('\n');
}

export async function fetchArticleText(url: string, maxChars = 4000): Promise<string> {
  const html = await fetchText(url, 12_000);
  const text = fromJsonLd(html) ?? fromParagraphs(html);
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
