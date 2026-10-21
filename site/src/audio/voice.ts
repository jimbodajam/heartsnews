import type { Presenter } from '../../../shared/bulletin';

/** A line being spoken. The player reads level() for lip sync and progress() for captions. */
export interface Speaking {
  done: Promise<void>;
  /** Mouth openness 0..1 at time `now` (performance.now ms). */
  level(now: number): number;
  /** Fraction of the text spoken so far. */
  progress(now: number): number;
  cancel(): void;
}

const FEMALE = /female|hazel|susan|libby|sonia|maisie|kate|serena|martha|fiona|zira|aria|jenny|emma|amy|catherine|karen|moira/i;
const MALE = /\bmale\b|george|ryan|thomas|daniel|oliver|arthur|alfie|david|mark|guy|brian|rishi|james/i;
const NICE = /natural|online|neural|premium|enhanced|google/i;

/** Rough talking speed, used when there is no real speech to time against. */
const estimateMs = (text: string) => (text.split(/\s+/).length / 2.7) * 1000 + 400;

/** Mouth flapping in a syllable-ish rhythm. */
const flap = (now: number) => (Math.sin(now / 55) * 0.5 + 0.5) * (Math.sin(now / 170) > -0.6 ? 1 : 0.15);

/**
 * Speech via the browser's built-in text-to-speech. Each presenter keeps the same voice;
 * British voices are preferred. With sound muted (or no voices) lines are timed silently.
 */
export class Voices {
  muted = false;
  private synth = 'speechSynthesis' in window ? window.speechSynthesis : undefined;
  private voices: SpeechSynthesisVoice[] = [];
  private assigned = new Map<string, SpeechSynthesisVoice | undefined>();

  async init(): Promise<void> {
    if (!this.synth) return;
    this.voices = this.synth.getVoices();
    if (!this.voices.length) {
      await new Promise<void>((res) => {
        this.synth!.addEventListener('voiceschanged', () => res(), { once: true });
        setTimeout(res, 1500);
      });
      this.voices = this.synth.getVoices();
    }
  }

  private voiceFor(p: Presenter): SpeechSynthesisVoice | undefined {
    if (this.assigned.has(p.id)) return this.assigned.get(p.id);
    const taken = new Set(this.assigned.values());
    const english = this.voices.filter((v) => /^en[-_]/i.test(v.lang));
    const score = (v: SpeechSynthesisVoice) =>
      (/en[-_]GB/i.test(v.lang) ? 4 : 0) +
      (/scot|fiona/i.test(v.name) ? 3 : 0) +
      (NICE.test(v.name) ? 2 : 0) +
      ((p.voice === 'female' ? FEMALE : MALE).test(v.name) ? 3 : 0) +
      ((p.voice === 'female' ? MALE : FEMALE).test(v.name) ? -3 : 0) +
      (taken.has(v) ? -2 : 0);
    const best = english.sort((a, b) => score(b) - score(a))[0];
    this.assigned.set(p.id, best);
    return best;
  }

  speak(text: string, p: Presenter): Speaking {
    if (this.muted || !this.synth || !this.voices.length) return this.silent(text);

    const synth = this.synth;
    const start = performance.now();
    const est = estimateMs(text);
    const voice = this.voiceFor(p);
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-GB';
    u.rate = 1.03;
    // If two presenters end up sharing a voice, a pitch shift keeps them apart.
    u.pitch = p.voice === 'female' ? 1.08 : 0.92;

    let charIndex = 0;
    let lastBoundary = 0;
    let ended = false;
    let finish = () => {};
    const done = new Promise<void>((res) => {
      finish = () => {
        if (ended) return;
        ended = true;
        clearInterval(keepAlive);
        clearTimeout(safety);
        res();
      };
    });
    u.onboundary = (e) => {
      charIndex = e.charIndex;
      lastBoundary = performance.now();
    };
    u.onend = finish;
    u.onerror = finish;

    synth.cancel();
    synth.speak(u);
    // Chrome silently stops utterances after ~15s unless nudged.
    const keepAlive = setInterval(() => {
      if (synth.speaking) {
        synth.pause();
        synth.resume();
      }
    }, 10_000);
    const safety = setTimeout(finish, est * 2.5 + 4000);

    return {
      done,
      level: (now) => {
        if (ended) return 0;
        // Voices that report word boundaries get a pulse per word; others just flap.
        const recent = lastBoundary === 0 || now - lastBoundary < 300;
        return flap(now) * (recent ? 1 : 0.35);
      },
      progress: (now) => (ended ? 1 : Math.max(charIndex / text.length, Math.min(0.98, (now - start) / est))),
      cancel: () => {
        synth.cancel();
        finish();
      },
    };
  }

  private silent(text: string): Speaking {
    const start = performance.now();
    const est = estimateMs(text);
    let finish = () => {};
    const done = new Promise<void>((res) => {
      const id = setTimeout(res, est);
      finish = () => {
        clearTimeout(id);
        res();
      };
    });
    let ended = false;
    void done.then(() => (ended = true));
    return {
      done,
      level: (now) => (ended ? 0 : flap(now)),
      progress: (now) => Math.min(1, (now - start) / est),
      cancel: () => finish(),
    };
  }
}
