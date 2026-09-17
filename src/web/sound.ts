export type ChimeKind = 'done' | 'blocked';

// Synthesized with Web Audio, so no audio files ship with the app.
const NOTES: Readonly<Record<ChimeKind, readonly number[]>> = {
  // Rising C-major arpeggio: something finished.
  done: [523.25, 659.25, 783.99, 1046.5],
  // Two falling notes: something needs you.
  blocked: [880, 659.25],
};

let context: AudioContext | undefined;

/** Browsers keep audio suspended until the user interacts with the page; resume it on interaction. */
export function unlockAudioOnInteraction(): void {
  for (const type of ['pointerdown', 'keydown']) {
    document.addEventListener(
      type,
      () => {
        if (context?.state === 'suspended') void context.resume();
      },
      true,
    );
  }
}

export function playChime(kind: ChimeKind, volume: number): void {
  if (volume <= 0) return;
  context ??= new AudioContext();
  const ctx = context;
  // A chime that can't play now would otherwise queue up and play late.
  if (ctx.state !== 'running') {
    void ctx.resume();
    return;
  }

  const master = ctx.createGain();
  master.gain.value = 0.25 * volume;
  master.connect(ctx.destination);

  const notes = NOTES[kind];
  const start = ctx.currentTime + 0.02;
  notes.forEach((frequency, i) => {
    const at = start + i * 0.1;
    const decay = i === notes.length - 1 ? 0.8 : 0.3;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(1, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + decay + 0.05);
  });
}
