// Speech-led gestures for the HD presenters (#97): the pose for a talking presenter follows what the line is saying (shared/gesture.ts
// plans where), instead of a timer. Arms are at rest unless a beat is on, so nobody lifts a hand at nothing.

import { type Beat, type BeatKind, beatAt, planBeats } from '../../../shared/gesture';
import type { Speaking } from '../audio/voice';
import type { FrameState } from '../render/state';

/** Which poses can play each kind of beat on this sheet. A kind with none falls back to `open`; with no `open` either it is skipped. */
export type Pools = Partial<Record<BeatKind, readonly string[]>>;

type Planned = Beat & { pose: string };

/** The plan for the line being spoken, made once the clip is playing (its cues are in then). */
const plans = new WeakMap<Speaking, Planned[]>();
/** The last gesture each presenter made, so the next one is a different pose where there is a choice. */
const lastPose = new Map<string, string>();

const seedOf = (text: string) => [...text].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7);

function plan(s: FrameState, id: string, pools: Pools): Planned[] | undefined {
  const speaking = s.speaking;
  const text = s.line?.text;
  const timing = speaking?.timing();
  if (!speaking || !text || !timing) return undefined;
  const cached = plans.get(speaking);
  if (cached) return cached;
  const screenUp = Boolean(pools.point?.length) && Boolean(s.graphic) && s.graphic?.type !== 'caller';
  const out: Planned[] = [];
  planBeats(text, timing, screenUp, seedOf(text)).forEach((b, i) => {
    const pool = pools[b.kind]?.length ? pools[b.kind]! : pools.open;
    if (!pool?.length) return;
    const last = lastPose.get(id);
    const fresh = pool.filter((p) => p !== last);
    const pick = fresh.length ? fresh : pool;
    const pose = pick[(seedOf(text) + i) % pick.length];
    lastPose.set(id, pose);
    out.push({ ...b, pose });
  });
  plans.set(speaking, out);
  return out;
}

/**
 * The gesture pose for presenter `id` right now, or undefined for arms at rest: they're not the one talking, no beat is on, or
 * the line's timing isn't known yet.
 */
export function gesturePose(s: FrameState, now: number, id: string, pools: Pools): string | undefined {
  if (s.talking !== id || !s.speaking) return undefined;
  const beats = plan(s, id, pools);
  const timing = s.speaking.timing();
  if (!beats || !timing) return undefined;
  return (beatAt(beats, s.speaking.progress(now) * timing.duration) as Planned | undefined)?.pose;
}
