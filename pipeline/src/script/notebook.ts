import type { Opinion } from '../memory.ts';
import { sameStory, tokens } from '../stories.ts';
import { normaliseTitle } from '../text.ts';
import type { Channel, Facts, Story } from './facts.ts';

// Story engine 3 (issue #26): each presenter's notebook. Everyone writes from the same storylines and claims, but each
// presenter keeps their own takes on the people and storylines in them (dated, and how strongly held) on top of a few
// lasting leanings from channel.json. Beats say who picks up which storyline, so the same person covers a story each
// time; a storyline with no beat goes to whoever has the strongest past take on it.

/** Who picks up a storyline: the first beat whose category, storyline kind or words match it wins. */
export interface Beat {
  presenter: string;
  categories?: string[];
  kinds?: string[];
  /** Matched as whole words against the title and brief. All capitals ("VAR") must match exactly. */
  words?: string[];
}

const wordRe = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, /^[A-Z]+$/.test(w) ? '' : 'i');

export function beatFor(channel: Channel, s: Story): string | undefined {
  const text = [s.title, s.storyline?.brief?.known].filter(Boolean).join(' ');
  return channel.beats?.find(
    (b) => b.categories?.includes(s.category) || (s.storyline && b.kinds?.includes(s.storyline.kind)) || b.words?.some((w) => wordRe(w).test(text)),
  )?.presenter;
}

/** The presenters with a beat: the ones who give opinions on storylines (never the lead anchor). */
export function beatPresenters(channel: Channel): string[] {
  return [...new Set((channel.beats ?? []).map((b) => b.presenter))].filter((id) => id !== channel.cast.anchors[0]);
}

/** A take is about a story when it was saved against its storyline or one of the people in it. */
export const isAbout = (t: Opinion, s: Story) =>
  (t.storyline !== undefined && t.storyline === s.storyline?.id) || (t.entity !== undefined && s.people.includes(t.entity));

/** A presenter's takes on any of these stories, newest first. */
export function takesOn(f: Facts, presenter: string, stories: Story[]): Opinion[] {
  const all = f.memory.presenters[presenter]?.opinions ?? [];
  return all.filter((t) => stories.some((s) => isAbout(t, s))).sort((a, b) => b.at.localeCompare(a.at));
}

/** Of these presenters, who has held the strongest view on the story (the most recent, when it's a tie). */
export function strongestTake(f: Facts, s: Story, presenters: string[]): string | undefined {
  let best: { id: string; strength: number; at: string } | undefined;
  for (const id of presenters) {
    for (const t of takesOn(f, id, [s])) {
      const strength = t.strength ?? 1;
      if (!best || strength > best.strength || (strength === best.strength && t.at > best.at)) best = { id, strength, at: t.at };
    }
  }
  return best?.id;
}

/**
 * Who a take is about, from the people in its story: the one named in it (by surname), or the only one. Without a
 * story, only someone named in it from all the stories on.
 */
export function personIn(text: string, story: Story | undefined, all: Story[]): string | undefined {
  const words = new Set(normaliseTitle(text).split(' '));
  const people = [...new Set((story ? [story] : all).flatMap((s) => s.people))];
  const named = people.filter((id) => words.has(id.split('-').at(-1)!));
  if (named.length === 1) return named[0];
  return story && !named.length && people.length === 1 ? people[0] : undefined;
}

/** A change of mind is worth keeping even when it's in the same words as before ("now thinks he won't be back"). */
const CHANGED = /\b(now|no longer|changed|admits|was wrong|u-turn)\b/i;

/**
 * Whether a view only says again what the presenter has already said: much the same words as one of their earlier
 * takes. A bulletin every half hour would otherwise fill a notebook with the same view.
 */
export function repeats(view: string, earlier: { view: string }[]): boolean {
  if (CHANGED.test(view)) return false;
  const words = tokens(view);
  return earlier.some((t) => sameStory(words, tokens(t.view)));
}

const STRENGTH =['', 'in passing', 'firmly', 'staked their name on it'];

/** A subject's key, so a presenter's takes on one storyline or person are listed together. */
const subject = (t: Opinion) => (t.storyline !== undefined ? `s${t.storyline}` : t.entity !== undefined ? `e${t.entity}` : `t${t.topic.toLowerCase()}`);

/**
 * One presenter's notebook for a piece of the script: their leanings, then what they've said on the people and
 * storylines in these stories (the latest view on each first, then up to two earlier ones), then a few other recent
 * views. `when` says how long ago, e.g. "yesterday".
 */
export function notebookLines(f: Facts, presenter: string, stories: Story[], when: (at: string) => string): string[] {
  const p = f.channel.presenters.find((x) => x.id === presenter);
  const lines: string[] = [];
  if (p?.leanings?.length) lines.push(`leanings: ${p.leanings.join('; ')}`);

  const said = (t: Opinion) => `"${t.view}" (${when(t.at)}${t.strength ? `, ${STRENGTH[t.strength]}` : ''})`;
  const bySubject = new Map<string, Opinion[]>();
  for (const t of takesOn(f, presenter, stories)) bySubject.set(subject(t), [...(bySubject.get(subject(t)) ?? []), t]);
  for (const [, takes] of [...bySubject].slice(0, 8)) {
    const [latest, ...earlier] = takes;
    lines.push(`on ${latest.topic}: ${said(latest)}${earlier.length ? `; before that ${earlier.slice(0, 2).map(said).join('; ')}` : ''}`);
  }

  const about = new Set(takesOn(f, presenter, stories));
  const other = (f.memory.presenters[presenter]?.opinions ?? []).filter((t) => !about.has(t)).slice(-3).reverse();
  if (other.length) lines.push(`other recent views: ${other.map((t) => `${t.topic}: ${said(t)}`).join('; ')}`);
  return lines;
}
