import { OutOfBudget, type MeteredModel } from './workers-ai.ts';
import { loadVideosToSummarise, saveNeurons, saveSummaries, type Store } from './store.ts';
import { isEmpty } from './summary-text.ts';
import { truncate } from './text.ts';
import type { VideoSummary } from './types.ts';

// Issue #49: a long show is read once, whole, when the ingest first sees its transcript, and reduced to what it
// covered, what it presented as news and what it only argued. Storylines, stories and bulletins use that instead of
// the opening few thousand characters of the captions. Runs on Workers AI (workers-ai.ts) before the storylines.

/** A transcript up to this long goes in whole; longer is split into chunks, summarised, and merged. */
export const WHOLE_CHARS = 20_000;
/** Chunk size for a longer show, and how much of the end of one chunk starts the next so a point isn't cut in half. */
export const CHUNK_CHARS = 18_000;
export const OVERLAP_CHARS = 600;
/** Videos summarised per run; the rest wait for the next one. */
export const SUMMARIES_PER_RUN = 6;

const S = { type: 'string' };
const POINTS = { type: 'array', items: S };

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    points: POINTS,
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: S, speaker: S, kind: { type: 'string', enum: ['injury', 'transfer', 'contract', 'discipline', 'manager', 'finance', 'stadium', 'team news', 'other'] } },
        required: ['text'],
      },
    },
    takes: { type: 'array', items: { type: 'object', properties: { text: S, speaker: S }, required: ['text'] } },
  },
  required: ['points', 'claims', 'takes'],
};

/** Splits a long transcript at word boundaries into chunks of about `size`, each starting `overlap` back into the last. */
export function splitTranscript(text: string, size = CHUNK_CHARS, overlap = OVERLAP_CHARS): string[] {
  if (text.length <= WHOLE_CHARS) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      if (space > start + size / 2) end = space;
    }
    parts.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    const back = text.indexOf(' ', end - overlap);
    start = back > 0 && back < end ? back + 1 : end;
  }
  return parts;
}

interface Show {
  title: string;
  source: string;
}

const RULES = `Rules:
- The captions are auto-generated: names are often mis-heard (a surname turned into a common word, a first name garbled). Use a name only where it is clear. Where you doubt a name or a fact, say "(unclear)" instead of guessing.
- points: the topics covered, in the order they came up, one short line each (at most 15 words).
- claims: only news, meaning something that happened or is said to be going to happen outside the analysis: an injury update, a transfer link or contract news, team news the club or the manager gave, a disciplinary decision, something a player, the manager or the club said or did, a fixture or ticket fact. One line each, with speaker where the captions make it clear who said it (a guest, a named presenter, "the host") and kind. Analysis of how a game went, who played well, what the team needs, or what might happen is a take, however confidently it is put. "I hear that" and "I'd imagine" are claims only when stated as something known or reported; otherwise they are takes.
- A prediction is always a take, never a claim: the show's own predicted line-up or team, who is "expected", "likely" or "probably going" to start, who might come in or drop out, a predicted score or scorer. The one exception is a prediction the manager, the club or a player made themselves ("Vrancken said Mendy should be fit to start"): that is a claim, with them as the speaker.
- takes: opinions, predictions and arguments (who should start, who they expect to start, how the game will go, what the club should do), one line each, with the speaker where clear. Word a prediction as one ("predicts Kingsley at centre-back", "predicts a 2-1 Hearts win").
- Only what is in the transcript. Leave a list empty rather than pad it. Aim for no more than 12 points, 10 claims and 10 takes.`;

export function summaryPrompt(show: Show, text: string, part?: { n: number; of: number }): string {
  return `You are reading the captions of a Heart of Midlothian YouTube show, "${show.title}" (${show.source}), so the newsroom can work from a short summary instead of the whole transcript.${
    part ? ` This is part ${part.n} of ${part.of}; the start of each part repeats the end of the last.` : ''
  }

${RULES}

Transcript:
${text}`;
}

export function mergePrompt(show: Show, parts: VideoSummary[]): string {
  return `Below are summaries of consecutive parts of one Heart of Midlothian YouTube show, "${show.title}" (${show.source}). Merge them into one summary of the whole show: keep the order, drop repeats (the parts overlap), and join points about the same topic.

${RULES}

Summaries of the parts:
${parts.map((p, i) => `--- part ${i + 1}\n${JSON.stringify(p)}`).join('\n')}`;
}

const lines = <T>(list: unknown, pick: (x: Record<string, unknown>) => T | undefined, max: number): T[] =>
  (Array.isArray(list) ? list : [])
    .map((x) => (x && typeof x === 'object' ? pick(x as Record<string, unknown>) : undefined))
    .filter((x): x is T => !!x)
    .slice(0, max);

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The model's reply as a summary, dropping anything malformed. */
export function parseSummary(reply: unknown): VideoSummary {
  const r = (reply && typeof reply === 'object' ? reply : {}) as Record<string, unknown>;
  const speaker = (x: Record<string, unknown>) => str(x.speaker);
  return {
    points: (Array.isArray(r.points) ? r.points : []).map(str).filter((p): p is string => !!p).map((p) => truncate(p, 160)).slice(0, 20),
    claims: lines(
      r.claims,
      (x) => {
        const text = str(x.text);
        return text ? { text: truncate(text, 240), ...(speaker(x) ? { speaker: speaker(x) } : {}), ...(str(x.kind) ? { kind: str(x.kind) } : {}) } : undefined;
      },
      15,
    ),
    takes: lines(r.takes, (x) => (str(x.text) ? { text: truncate(str(x.text)!, 240), ...(speaker(x) ? { speaker: speaker(x) } : {}) } : undefined), 15),
  };
}

/** Concatenates part summaries, dropping repeated lines: the merge when the merge call fails. */
export function joinSummaries(parts: VideoSummary[]): VideoSummary {
  const seen = new Set<string>();
  const fresh = <T extends { text: string }>(list: T[]) => list.filter((x) => !seen.has(x.text.toLowerCase()) && !!seen.add(x.text.toLowerCase()));
  return {
    points: [...new Set(parts.flatMap((p) => p.points))],
    claims: fresh(parts.flatMap((p) => p.claims)),
    takes: fresh(parts.flatMap((p) => p.takes)),
  };
}

/** One summary of a show's whole transcript: one request if it fits, otherwise a request per chunk and a merge. */
export async function summariseTranscript(model: { generateJson(prompt: string, schema: object): Promise<unknown> }, show: Show, transcript: string): Promise<VideoSummary> {
  const chunks = splitTranscript(transcript);
  if (chunks.length === 1) return parseSummary(await model.generateJson(summaryPrompt(show, chunks[0]), SUMMARY_SCHEMA));
  const parts: VideoSummary[] = [];
  for (const [i, chunk] of chunks.entries()) {
    parts.push(parseSummary(await model.generateJson(summaryPrompt(show, chunk, { n: i + 1, of: chunks.length }), SUMMARY_SCHEMA)));
  }
  try {
    const merged = parseSummary(await model.generateJson(mergePrompt(show, parts), SUMMARY_SCHEMA));
    if (merged.points.length) return merged;
  } catch (err) {
    if (err instanceof OutOfBudget) throw err;
  }
  return joinSummaries(parts);
}


/**
 * Summarises the videos whose transcripts have no summary yet, newest first, up to `SUMMARIES_PER_RUN`. One that fails
 * is left for the next run; running out of budget ends the step.
 */
export async function summariseVideos(r: { store: Store; model: MeteredModel | undefined; now: Date; log?: (line: string) => void; limit?: number }): Promise<number> {
  const log = r.log ?? console.log;
  const { store, model, now } = r;
  if (!model) return 0;
  const waiting = await loadVideosToSummarise(store, now, r.limit ?? SUMMARIES_PER_RUN);
  if (!waiting.length) return 0;
  const before = model.neurons;
  let done = 0;
  try {
    for (const v of waiting) {
      try {
        const summary = await summariseTranscript(model, { title: v.title, source: v.publisher ?? v.source }, v.transcript);
        if (isEmpty(summary)) throw new Error('an empty summary');
        await saveSummaries(store, [{ id: v.id, summary }], now);
        done++;
        log(`  Summarised "${v.title}" (${v.transcript.length} chars): ${summary.points.length} points, ${summary.claims.length} claims, ${summary.takes.length} takes.`);
      } catch (err) {
        if (err instanceof OutOfBudget) throw err;
        log(`  Couldn't summarise "${v.title}" (left for the next run): ${(err as Error).message}`);
      }
    }
  } catch (err) {
    if (!(err instanceof OutOfBudget)) throw err;
    log(err.message);
  } finally {
    // Counted here, so the storylines after it start from the neurons already recorded.
    await saveNeurons(store, model.neurons - before, now);
    log(`Videos: ${done} of ${waiting.length} summarised, ${Math.round(model.neurons - before)} neurons.`);
  }
  return done;
}

