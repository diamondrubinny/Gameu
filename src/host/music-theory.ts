/** Pure helpers for the generative music (no Web Audio here, so they are unit-testable). */

export type MusicMood = 'menu' | 'game' | 'tense' | 'calm';

export interface MoodSpec {
  bpm: number;
  /** MIDI note of the key's tonic (around octave 3). */
  root: number;
  scale: readonly number[];
  /** Chord roots as scale degrees (0-based), one chord per bar. */
  progression: readonly number[];
  /** 0..1 chance of an arpeggio note per eighth. */
  arp: number;
  /** 0..1 chance of a melody note per quarter. */
  melody: number;
  drums: 'none' | 'soft' | 'groove';
  bass: 'half' | 'eighths';
}

export const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
export const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;

export const MOODS: Record<MusicMood, MoodSpec> = {
  // Warm, relaxed lounge feel for the menu: Imaj7 – vi7 – IVmaj7 – V.
  menu: { bpm: 88, root: 53 /* F3 */, scale: MAJOR, progression: [0, 5, 3, 4], arp: 0.55, melody: 0.35, drums: 'soft', bass: 'half' },
  // Bright and bouncy for action games: I – V – vi – IV.
  game: { bpm: 116, root: 48 /* C3 */, scale: MAJOR, progression: [0, 4, 5, 3], arp: 0.75, melody: 0.45, drums: 'groove', bass: 'eighths' },
  // Suspense for decisions (poker, last trivia question): i – VI – III – VII.
  tense: { bpm: 96, root: 45 /* A2 */, scale: MINOR, progression: [0, 5, 2, 6], arp: 0.4, melody: 0, drums: 'soft', bass: 'eighths' },
  // Gentle background while players think or draw.
  calm: { bpm: 76, root: 50 /* D3 */, scale: MAJOR, progression: [0, 3, 5, 4], arp: 0.3, melody: 0.25, drums: 'none', bass: 'half' },
};

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI note of a scale degree (degrees past the scale length wrap into higher octaves). */
export function degreeToMidi(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + octave * 12 + (scale[idx] ?? 0);
}

/** Seventh chord (root, 3rd, 5th, 7th) built on a scale degree, as MIDI notes. */
export function seventhChord(root: number, scale: readonly number[], degree: number): number[] {
  return [0, 2, 4, 6].map((step) => degreeToMidi(root, scale, degree + step));
}

/** Pentatonic subset of the scale (drops the 4th and 7th of major, 2nd and 6th of minor): always consonant. */
export function pentatonic(scale: readonly number[]): number[] {
  return scale === MINOR ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
}

/** Small deterministic PRNG (mulberry32) so a mood's melody is varied but reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Next melody note as an index into a pentatonic ladder: mostly steps, sometimes small leaps,
 * pulled back toward the middle so the line never drifts out of range.
 */
export function nextMelodyStep(current: number, rand: () => number, low = 0, high = 9): number {
  const r = rand();
  let step = r < 0.35 ? -1 : r < 0.7 ? 1 : r < 0.82 ? -2 : r < 0.94 ? 2 : 0;
  const mid = (low + high) / 2;
  if (current > mid + 2 && step > 0) step = -step;
  if (current < mid - 2 && step < 0) step = -step;
  return Math.max(low, Math.min(high, current + step));
}
