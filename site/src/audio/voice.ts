import type { Presenter } from '../../../shared/bulletin';
import { audioContext } from './sting';

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
 * Presenter speech. Lines with a pre-rendered clip are played through Web Audio, and the mouth follows
 * the clip's loudness. Otherwise (or if the clip fails to load) the browser's built-in text-to-speech is
 * used, preferring British voices, with each presenter keeping the same voice.
 * With sound muted (or no voices) lines are timed silently.
 */
export class Voices {
  private synth = 'speechSynthesis' in window ? window.speechSynthesis : undefined;
  private voices: SpeechSynthesisVoice[] = [];
  private assigned = new Map<string, SpeechSynthesisVoice | undefined>();
  private clips = new Map<string, Promise<AudioBuffer>>();
  private master?: GainNode;
  private isMuted = false;

  get muted(): boolean {
    return this.isMuted;
  }

  set muted(m: boolean) {
    this.isMuted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
    if (m) this.synth?.cancel();
  }

  /** Start fetching and decoding a clip so it is ready when its line comes up. */
  preload(url: string): Promise<AudioBuffer> {
    let clip = this.clips.get(url);
    if (!clip) {
      clip = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
          return r.arrayBuffer();
        })
        .then((b) => audioContext().decodeAudioData(b));
      clip.catch(() => this.clips.delete(url));
      this.clips.set(url, clip);
    }
    return clip;
  }

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

  speak(text: string, p: Presenter, clipUrl?: string): Speaking {
    if (this.muted) return this.silent(text);
    if (clipUrl) return this.clip(text, p, clipUrl);
    return this.synthesise(text, p);
  }

  private clip(text: string, p: Presenter, url: string): Speaking {
    const ctx = audioContext();
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    const master = this.master;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const samples = new Float32Array(analyser.fftSize);
    let source: AudioBufferSourceNode | undefined;
    let fallback: Speaking | undefined;
    let startedAt = 0;
    let durationMs = 1;
    let ended = false;
    let cancelled = false;

    const done = (async () => {
      let buffer: AudioBuffer;
      try {
        buffer = await this.preload(url);
      } catch (err) {
        console.warn('Voice clip unavailable, using browser speech instead:', err);
        if (cancelled) return;
        fallback = this.synthesise(text, p);
        return fallback.done;
      }
      if (cancelled) return;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser).connect(master);
      durationMs = buffer.duration * 1000;
      startedAt = performance.now();
      const src = source;
      await new Promise<void>((res) => {
        src.onended = () => res();
        src.start();
      });
    })().finally(() => {
      ended = true;
    });

    return {
      done,
      level: (now) => {
        if (fallback) return fallback.level(now);
        if (!source || ended) return 0;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += s * s;
        const rms = Math.sqrt(sum / samples.length);
        return Math.min(1, Math.max(0, (rms - 0.012) * 7));
      },
      progress: (now) => {
        if (fallback) return fallback.progress(now);
        if (ended) return 1;
        return startedAt ? Math.min(1, (now - startedAt) / durationMs) : 0;
      },
      cancel: () => {
        cancelled = true;
        fallback?.cancel();
        try {
          source?.stop();
        } catch {
          // not started yet
        }
      },
    };
  }

  private synthesise(text: string, p: Presenter): Speaking {
    if (!this.synth || !this.voices.length) return this.silent(text);

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
