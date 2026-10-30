import { describe, expect, it } from 'vitest';
import { MAJOR, MINOR, MOODS, degreeToMidi, midiToFreq, nextMelodyStep, pentatonic, seededRandom, seventhChord } from '../../src/host/music-theory';
import { GameToHostSchema, SettingsSchema } from '../../src/shared/protocol';

describe('music theory', () => {
  it('converts MIDI to frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1);
  });

  it('maps scale degrees across octaves', () => {
    expect(degreeToMidi(60, MAJOR, 0)).toBe(60);
    expect(degreeToMidi(60, MAJOR, 4)).toBe(67);
    expect(degreeToMidi(60, MAJOR, 7)).toBe(72);
    expect(degreeToMidi(60, MAJOR, -1)).toBe(59);
  });

  it('builds diatonic seventh chords', () => {
    expect(seventhChord(60, MAJOR, 0)).toEqual([60, 64, 67, 71]); // Cmaj7
    expect(seventhChord(60, MAJOR, 1)).toEqual([62, 65, 69, 72]); // Dm7
    expect(seventhChord(57, MINOR, 0)).toEqual([57, 60, 64, 67]); // Am7
  });

  it('pentatonic notes all belong to the scale', () => {
    for (const scale of [MAJOR, MINOR]) for (const n of pentatonic(scale)) expect(scale).toContain(n);
  });

  it('seeded random is deterministic and in [0,1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('melody stays within range over a long walk', () => {
    const r = seededRandom(7);
    let i = 5;
    for (let n = 0; n < 5000; n++) {
      i = nextMelodyStep(i, r);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(9);
    }
  });

  it('every mood has a sane tempo and progression', () => {
    for (const m of Object.values(MOODS)) {
      expect(m.bpm).toBeGreaterThan(50);
      expect(m.bpm).toBeLessThan(160);
      expect(m.progression.length).toBeGreaterThan(0);
    }
  });
});

describe('audio protocol', () => {
  it('accepts known sounds and moods, rejects others', () => {
    expect(GameToHostSchema.safeParse({ gameu: 1, type: 'sound', name: 'fanfare' }).success).toBe(true);
    expect(GameToHostSchema.safeParse({ gameu: 1, type: 'music', mood: 'tense' }).success).toBe(true);
    expect(GameToHostSchema.safeParse({ gameu: 1, type: 'sound', name: 'http://evil/x.mp3' }).success).toBe(false);
    expect(GameToHostSchema.safeParse({ gameu: 1, type: 'music', mood: 'loud' }).success).toBe(false);
  });

  it('music setting defaults to on', () => {
    expect(SettingsSchema.parse({}).music).toBe(true);
    expect(SettingsSchema.parse({ music: false }).music).toBe(false);
  });
});
