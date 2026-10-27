import { OutOfBudget, type MeteredModel } from './workers-ai.ts';
import { loadArticlesToSummarise, saveNeurons, saveSummaries, type ArticleToSummarise, type Store } from './store.ts';
import { truncate } from './text.ts';
import type { ArticleSummary } from './types.ts';

// Issue #52: a long article is read once, whole, and reduced to its news, its quotes and its background, so the in-depth
// packages get all of it in a few lines instead of the opening 1,800 characters. Like a show's summary (summarise.ts),
// but run after the storylines, which read the article itself, and only while the day's Workers AI use leaves room
// for the reading. The first backfill runs at home on Ollama instead (backfill-articles.ts).

/** Articles summarised per run; the rest wait for the next one. */
export const ARTICLE_SUMMARIES_PER_RUN = 6;
/** Only articles first seen this recently, or behind an open storyline: older ones won't go on air. */
export const RECENT_DAYS = 2;
/** Past this many neurons in the last 24 hours the summaries wait, so the reading keeps the main model. */
export const SUMMARISE_UNTIL = 5_000;

const S = { type: 'string' };

export const ARTICLE_SCHEMA = {
  type: 'object',
  properties: {
    news: { type: 'array', items: S },
    quotes: { type: 'array', items: { type: 'object', properties: { text: S, speaker: S }, required: ['text', 'speaker'] } },
    background: { type: 'array', items: S },
  },
  required: ['news', 'quotes', 'background'],
};

interface Source {
  title: string;
  outlet: string;
}

export function articlePrompt(a: Source, body: string): string {
  return `You are reading a ${a.outlet} article about Heart of Midlothian, "${a.title}", so the newsroom can work from a short summary instead of the whole text.

Rules:
- news: what the article reports, the key details first: what happened or is said to be happening, who, when, numbers, what comes next. One line each (at most 30 words), in your own words. Where the article only reports something (a transfer link, a source's claim), say so ("is reported to", "according to").
- quotes: the direct quotes worth using, copied exactly as printed between quotation marks in the article, with who said them (name and role as the article gives them). Never shorten, join or reword a quote; leave out any you can't copy exactly. At most 6.
- background: history, statistics and context the article gives that are not the news itself (past results, a player's record, earlier events). One line each.
- Only what is in the article. Leave a list empty rather than pad it. Aim for no more than 10 news lines and 6 background lines.

Article:
${body}`;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Lower case, straight quotes, single spaces, no quote marks at the ends: how a quote is matched against the text. */
export function normaliseQuote(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .toLowerCase();
}

/** The model's reply as a summary: malformed lines dropped, and any quote not found word for word in the article. */
export function parseArticleSummary(reply: unknown, body: string): ArticleSummary {
  const r = (reply && typeof reply === 'object' ? reply : {}) as Record<string, unknown>;
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map(str).filter((x): x is string => !!x).map((x) => truncate(x, 240)).slice(0, max);
  const text = normaliseQuote(body);
  const quotes = (Array.isArray(r.quotes) ? r.quotes : [])
    .map((q) => (q && typeof q === 'object' ? (q as Record<string, unknown>) : {}))
    .map((q) => ({ text: str(q.text), speaker: str(q.speaker) }))
    .filter((q): q is { text: string; speaker: string } => !!q.text && !!q.speaker && q.text.length >= 12 && text.includes(normaliseQuote(q.text)))
    .map((q) => ({ text: q.text.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, ''), speaker: truncate(q.speaker, 80) }))
    .slice(0, 8);
  return { news: list(r.news, 12), quotes, background: list(r.background, 8) };
}

export async function summariseArticle(model: { generateJson(prompt: string, schema: object): Promise<unknown> }, a: ArticleToSummarise): Promise<ArticleSummary> {
  const summary = parseArticleSummary(await model.generateJson(articlePrompt({ title: a.title, outlet: a.publisher ?? a.source }, a.body), ARTICLE_SCHEMA), a.body);
  if (!summary.news.length) throw new Error('no news in the summary');
  return summary;
}

/**
 * Summarises each article in turn and saves it as it goes; one that fails is left for later, and running out of budget
 * ends the step. Returns how many were done.
 */
export async function summariseEach(
  store: Store,
  model: { generateJson(prompt: string, schema: object): Promise<unknown> },
  articles: ArticleToSummarise[],
  log: (line: string) => void,
): Promise<number> {
  let done = 0;
  for (const a of articles) {
    try {
      const summary = await summariseArticle(model, a);
      await saveSummaries(store, [{ id: a.id, summary }], new Date());
      done++;
      log(`  Summarised "${a.title}" (${a.body.length} chars): ${summary.news.length} news, ${summary.quotes.length} quotes, ${summary.background.length} background.`);
    } catch (err) {
      if (err instanceof OutOfBudget) {
        log(err.message);
        break;
      }
      log(`  Couldn't summarise "${a.title}" (left for later): ${(err as Error).message}`);
    }
  }
  return done;
}

/**
 * The ingest's step: the newest long articles that can still go on air, up to `ARTICLE_SUMMARIES_PER_RUN`, while the
 * last 24 hours' use (`used`, before this run) plus this run's stays under `SUMMARISE_UNTIL`.
 */
export async function summariseArticles(r: { store: Store; model: MeteredModel | undefined; used: number; now: Date; log?: (line: string) => void }): Promise<number> {
  const log = r.log ?? console.log;
  const { store, model, now } = r;
  if (!model) return 0;
  const waiting = await loadArticlesToSummarise(store, now, ARTICLE_SUMMARIES_PER_RUN, RECENT_DAYS);
  if (!waiting.length) return 0;
  if (r.used + model.neurons >= SUMMARISE_UNTIL) {
    log(`Articles: ${waiting.length} waiting to be summarised, left for later (${Math.round(r.used + model.neurons)} neurons used in the last 24 hours).`);
    return 0;
  }
  const before = model.neurons;
  let done = 0;
  try {
    done = await summariseEach(store, model, waiting, log);
  } finally {
    await saveNeurons(store, model.neurons - before, now);
    log(`Articles: ${done} of ${waiting.length} summarised, ${Math.round(model.neurons - before)} neurons.`);
  }
  return done;
}
