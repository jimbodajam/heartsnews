import { truncate } from './text.ts';
import type { ArticleSummary, VideoSummary } from './types.ts';

// A video summary as text for a prompt (issue #49), kept apart from summarise.ts so the store can use it.

export function isEmpty(s: VideoSummary): boolean {
  return !s.points.length && !s.claims.length && !s.takes.length;
}

/**
 * A summary as text for a prompt. `claims`: what the show presented as news, for the storylines (a show's takes never
 * go there); `full`: all of it, for stories and in-depth packages; `fan`: the points and takes, for the Fan Zone.
 */
export function renderSummary(s: VideoSummary, use: 'claims' | 'full' | 'fan'): string {
  const by = (x: { speaker?: string }) => (x.speaker ? `${x.speaker}: ` : '');
  const out: string[] = ['(Summary of the whole show, read from auto-generated captions.)'];
  if (s.points.length) out.push('Covered, in order:', ...s.points.map((p) => `- ${p}`));
  if (use !== 'fan' && s.claims.length) out.push('Presented as news on the show (not confirmed by anyone else):', ...s.claims.map((c) => `- ${by(c)}${c.text}`));
  if (use !== 'claims' && s.takes.length) {
    out.push('Opinions and predictions (opinion, not fact: credit them to the show, e.g. "the show are predicting…"):', ...s.takes.map((t) => `- ${by(t)}${t.text}`));
  }
  if (use === 'fan' && s.claims.length) out.push('Things they said they had heard (talk, not reported fact):', ...s.claims.map((c) => `- ${by(c)}${c.text}`));
  return out.join('\n');
}

/** An article summary (issue #52) as text for an in-depth package or the headlines' "more on" block: news first. */
export function renderArticleSummary(s: ArticleSummary): string {
  const out: string[] = ['(Summary of the whole article.)'];
  if (s.news.length) out.push('What it reports:', ...s.news.map((n) => `- ${n}`));
  if (s.quotes.length) out.push('Quotes, word for word:', ...s.quotes.map((q) => `- ${q.speaker}: "${q.text}"`));
  if (s.background.length) out.push('Background (context, not news):', ...s.background.map((b) => `- ${b}`));
  return out.join('\n');
}

/** A video's text for a prompt: its summary rendered, or failing that the start of its transcript, as before. */
export function videoText(summary: VideoSummary | undefined, transcript: string | undefined, use: 'claims' | 'full' | 'fan', max: number): string {
  if (summary && !isEmpty(summary)) return renderSummary(summary, use);
  return truncate(transcript ?? '', max);
}
