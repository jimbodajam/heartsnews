// Chiptune idents made with oscillators, so there are no audio files to host.

let ctx: AudioContext | undefined;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

function note(a: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.05): void {
  const o = a.createOscillator();
  const gain = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(vol, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(gain).connect(a.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

const N = { C4: 261.63, G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, C3: 130.81, G3: 196 };

/** A pitch sweep that builds in volume, then dies. */
function sweep(a: AudioContext, from: number, to: number, start: number, dur: number, type: OscillatorType, vol: number): void {
  const o = a.createOscillator();
  const gain = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, start);
  o.frequency.exponentialRampToValueAtTime(to, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(vol, start + dur * 0.9);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur + 0.1);
  o.connect(gain).connect(a.destination);
  o.start(start);
  o.stop(start + dur + 0.15);
}

/** Filtered noise that swells over `swell` seconds then dies by `dur`: a crowd drawing breath, then a roar. */
function crowd(a: AudioContext, start: number, swell: number, dur: number, vol: number): void {
  const src = a.createBufferSource();
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(500, start);
  filter.frequency.exponentialRampToValueAtTime(1800, start + swell);
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(vol, start + swell);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(start);
}

export function playSting(kind: 'ident' | 'segment' | 'breaking', look: 'goal' | 'red' | 'calm' = 'calm'): void {
  const a = audioContext();
  const t = a.currentTime + 0.05;
  if (kind === 'breaking' && look === 'goal') {
    // Suspense: a riser and a crowd drawing breath, then a hit as the word lands. The same for either team's goal.
    sweep(a, 220, 880, t, 0.9, 'sawtooth', 0.03);
    crowd(a, t, 1.0, 2.2, 0.12);
    note(a, N.C3, t + 1.0, 0.8, 'square', 0.07);
    [N.C5, N.G5].forEach((f) => note(a, f, t + 1.0, 0.8, 'triangle', 0.05));
  } else if (kind === 'breaking' && look === 'red') {
    // Harsh: a low buzz and a falling zap.
    note(a, N.C3, t, 0.5, 'sawtooth', 0.07);
    note(a, N.C3 * 1.06, t + 0.55, 0.5, 'sawtooth', 0.07);
    sweep(a, 1200, 200, t, 0.35, 'square', 0.05);
  } else if (kind === 'breaking') {
    // Calm: not an emergency, two soft notes.
    note(a, N.G4, t, 0.35, 'triangle', 0.06);
    note(a, N.C5, t + 0.25, 0.7, 'triangle', 0.06);
  } else if (kind === 'ident') {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => note(a, f, t + i * 0.11, 0.12));
    [N.C5, N.E5, N.G5].forEach((f) => note(a, f, t + 0.5, 1.1, 'triangle', 0.06));
    note(a, N.C3, t + 0.5, 1.1, 'square', 0.04);
    note(a, N.G3, t + 1.7, 0.15, 'square', 0.03);
    note(a, N.C4, t + 1.85, 0.5, 'square', 0.03);
  } else {
    note(a, N.G4, t, 0.09);
    note(a, N.C5, t + 0.09, 0.09);
    note(a, N.A5, t + 0.18, 0.35, 'triangle', 0.06);
  }
}
