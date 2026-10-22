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

export function playSting(kind: 'ident' | 'segment' | 'breaking'): void {
  const a = audioContext();
  const t = a.currentTime + 0.05;
  if (kind === 'breaking') {
    // Urgent: a newsroom alarm of high pips, then a low hit under a held chord.
    for (let i = 0; i < 3; i++) {
      note(a, N.A5, t + i * 0.24, 0.1);
      note(a, N.E5, t + i * 0.24 + 0.12, 0.1);
    }
    note(a, N.C3, t + 0.78, 1.2, 'square', 0.05);
    [N.C5, N.G5, N.C6].forEach((f) => note(a, f, t + 0.78, 1.2, 'triangle', 0.05));
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
