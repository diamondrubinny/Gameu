/**
 * TV audio engine: synthesized sound effects and generative background music.
 * Everything is generated at runtime with Web Audio — no audio files, no network, no licences.
 */
import type { MusicMood as Mood } from './music-theory';
import { MOODS, degreeToMidi, midiToFreq, nextMelodyStep, pentatonic, seededRandom, seventhChord } from './music-theory';

export type MusicMood = Mood | 'off';

/** Effects a game may request (keep in sync with SOUND_NAMES in the protocol). */
export type SoundName =
  | 'move' | 'select' | 'back' | 'join' | 'error'
  | 'tick' | 'countdown' | 'go' | 'correct' | 'wrong' | 'reveal' | 'chip' | 'card'
  | 'eat' | 'crash' | 'coin' | 'win' | 'fanfare' | 'letter' | 'turn' | 'lose';

const MUSIC_LEVEL = 0.42;
const SFX_LEVEL = 1.4;
/** Gain after the compressor (the compressor tames peaks, this restores loudness). */
const MAKEUP = 1.5;
const LOOKAHEAD_S = 0.25;
const TICK_MS = 60;

let ctx: AudioContext | null = null;
let master: GainNode;
let output: GainNode;
let sfxBus: GainNode;
let musicBus: GainNode;
let reverbIn: GainNode;
let noiseBuf: AudioBuffer;

let volume = 0.7;
let musicEnabled = true;
let mood: MusicMood = 'off';
let wantedMood: MusicMood = 'off';

function audio(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch {
    return null;
  }
  const c = ctx;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 8;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  // Safety limiter so stacked effects never clip.
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  master = c.createGain();
  master.gain.value = volume;
  output = c.createGain();
  output.gain.value = MAKEUP;
  master.connect(comp).connect(output).connect(limiter).connect(c.destination);
  sfxBus = c.createGain();
  sfxBus.gain.value = SFX_LEVEL;
  sfxBus.connect(master);
  musicBus = c.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);
  // Cheap, soft reverb: a convolver with a generated decaying-noise impulse.
  const conv = c.createConvolver();
  conv.buffer = impulse(c, 2.2);
  reverbIn = c.createGain();
  reverbIn.gain.value = 0.3;
  reverbIn.connect(conv).connect(master);
  noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  return c;
}

function impulse(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

// ---------------------------------------------------------------- voices

interface VoiceOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  /** Lowpass cutoff in Hz (none if omitted). */
  cutoff?: number;
  detune?: number;
  /** Pitch glide target (Hz) over the note. */
  glideTo?: number;
  reverb?: number;
  bus?: GainNode;
}

/** One enveloped oscillator note at absolute time `t`. */
function voice(freq: number, t: number, dur: number, o: VoiceOpts = {}): void {
  const c = ctx;
  if (!c) return;
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t + dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = c.createGain();
  const peak = o.gain ?? 0.2;
  const a = o.attack ?? 0.005;
  const r = o.release ?? Math.min(0.3, dur * 0.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + Math.max(a, dur - r));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = osc;
  if (o.cutoff) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.cutoff;
    node = node.connect(f);
  }
  node.connect(g);
  g.connect(o.bus ?? sfxBus);
  if (o.reverb) {
    const send = c.createGain();
    send.gain.value = o.reverb;
    g.connect(send).connect(reverbIn);
  }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Bell-like tone: sine plus quiet inharmonic partial. */
function bell(freq: number, t: number, dur: number, gain = 0.18, bus?: GainNode): void {
  voice(freq, t, dur, { gain, release: dur * 0.9, reverb: 0.5, bus });
  voice(freq * 2.76, t, dur * 0.5, { gain: gain * 0.18, release: dur * 0.45, bus });
}

/** Filtered noise burst (percussion, whooshes, chips, cards). */
function noise(t: number, dur: number, o: { type?: BiquadFilterType; freq?: number; freqTo?: number; q?: number; gain?: number; bus?: GainNode; reverb?: number } = {}): void {
  const c = ctx;
  if (!c) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq ?? 2000, t);
  if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(o.gain ?? 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(o.bus ?? sfxBus);
  if (o.reverb) {
    const send = c.createGain();
    send.gain.value = o.reverb;
    g.connect(send).connect(reverbIn);
  }
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function kick(t: number, gain = 0.5, bus?: GainNode): void {
  voice(140, t, 0.28, { gain, glideTo: 45, release: 0.25, bus });
}

const note = (midi: number) => midiToFreq(midi);

// ---------------------------------------------------------------- effects

const SOUNDS: Record<SoundName, (t: number) => void> = {
  move: (t) => voice(note(84), t, 0.05, { type: 'triangle', gain: 0.07 }),
  select: (t) => {
    voice(note(79), t, 0.09, { type: 'triangle', gain: 0.12 });
    voice(note(86), t + 0.06, 0.14, { type: 'triangle', gain: 0.12, reverb: 0.2 });
  },
  back: (t) => {
    voice(note(76), t, 0.08, { type: 'triangle', gain: 0.1 });
    voice(note(69), t + 0.06, 0.12, { type: 'triangle', gain: 0.1 });
  },
  join: (t) => [84, 88, 91, 96].forEach((m, i) => bell(note(m), t + i * 0.07, 0.5, 0.12)),
  error: (t) => {
    voice(150, t, 0.12, { type: 'square', gain: 0.06, cutoff: 900 });
    voice(140, t + 0.15, 0.18, { type: 'square', gain: 0.06, cutoff: 900 });
  },
  tick: (t) => voice(1800, t, 0.025, { type: 'square', gain: 0.03, cutoff: 4000 }),
  countdown: (t) => voice(note(81), t, 0.14, { type: 'triangle', gain: 0.16, reverb: 0.15 }),
  go: (t) => [81, 85, 88, 93].forEach((m) => voice(note(m), t, 0.45, { type: 'triangle', gain: 0.1, reverb: 0.35 })),
  correct: (t) => [79, 83, 86, 91].forEach((m, i) => bell(note(m), t + i * 0.06, 0.6, 0.14)),
  wrong: (t) => {
    voice(note(55), t, 0.22, { type: 'sawtooth', gain: 0.07, cutoff: 1200 });
    voice(note(54), t + 0.18, 0.35, { type: 'sawtooth', gain: 0.07, cutoff: 900, glideTo: note(50) });
  },
  reveal: (t) => {
    noise(t, 0.6, { type: 'bandpass', freq: 400, freqTo: 6000, q: 2, gain: 0.08, reverb: 0.3 });
    [88, 92, 95, 100].forEach((m, i) => bell(note(m), t + 0.35 + i * 0.05, 0.7, 0.08));
  },
  chip: (t) => {
    noise(t, 0.04, { type: 'bandpass', freq: 3500, q: 6, gain: 0.35 });
    noise(t + 0.06, 0.05, { type: 'bandpass', freq: 3100, q: 6, gain: 0.25 });
    voice(2600, t, 0.05, { type: 'sine', gain: 0.04 });
  },
  card: (t) => noise(t, 0.09, { type: 'highpass', freq: 2500, freqTo: 6000, gain: 0.18 }),
  eat: (t) => voice(note(72), t, 0.09, { type: 'square', gain: 0.06, glideTo: note(84), cutoff: 3000 }),
  crash: (t) => {
    noise(t, 0.5, { type: 'lowpass', freq: 2500, freqTo: 200, gain: 0.35 });
    kick(t, 0.5);
  },
  coin: (t) => {
    voice(note(81), t, 0.07, { type: 'square', gain: 0.05, cutoff: 5000 });
    voice(note(85), t + 0.06, 0.07, { type: 'square', gain: 0.05, cutoff: 5000 });
    voice(note(88), t + 0.12, 0.25, { type: 'square', gain: 0.05, cutoff: 5000, reverb: 0.2 });
  },
  win: (t) => {
    [72, 76, 79, 84].forEach((m, i) => voice(note(m), t + i * 0.1, 0.25, { type: 'triangle', gain: 0.14, reverb: 0.3 }));
    [84, 88, 91].forEach((m) => voice(note(m), t + 0.4, 0.7, { type: 'triangle', gain: 0.1, reverb: 0.4 }));
  },
  fanfare: (t) => playFanfare(t),
  letter: (t) => voice(note(77), t, 0.06, { type: 'triangle', gain: 0.1, cutoff: 3000 }),
  turn: (t) => {
    bell(note(84), t, 0.5, 0.12);
    bell(note(91), t + 0.12, 0.7, 0.12);
  },
  lose: (t) => [67, 66, 64, 62].forEach((m, i) => voice(note(m), t + i * 0.18, 0.3 + (i === 3 ? 0.4 : 0), { type: 'triangle', gain: 0.1, cutoff: 1800, reverb: 0.3 })),
};

/** Original victory fanfare: brass-like pickup, held major chord, timpani roll and cymbal. */
function playFanfare(t: number): void {
  const brass = (m: number, at: number, dur: number, gain = 0.09) => {
    voice(note(m), at, dur, { type: 'sawtooth', gain, cutoff: 2400, attack: 0.03, release: Math.min(0.4, dur * 0.6), reverb: 0.35 });
    voice(note(m), at, dur, { type: 'sawtooth', gain: gain * 0.6, cutoff: 2400, attack: 0.03, detune: 9, release: Math.min(0.4, dur * 0.6) });
  };
  // Pickup triplet → leap → triumphant chord (in C).
  brass(67, t, 0.14);
  brass(67, t + 0.15, 0.14);
  brass(67, t + 0.3, 0.14);
  brass(72, t + 0.45, 0.45);
  brass(70, t + 0.92, 0.2);
  brass(74, t + 1.12, 0.2);
  for (const m of [60, 64, 67, 72, 76]) brass(m, t + 1.35, 1.5, 0.06);
  bell(note(96), t + 1.35, 1.6, 0.08);
  // Timpani roll + cymbal swell on the final chord.
  for (let i = 0; i < 8; i++) voice(note(43), t + 1.0 + i * 0.045, 0.2, { gain: 0.12 + i * 0.02, glideTo: note(41) });
  kick(t + 1.35, 0.6);
  noise(t + 1.35, 1.6, { type: 'highpass', freq: 5000, gain: 0.12, reverb: 0.4 });
}

export function play(name: SoundName): void {
  if (volume <= 0) return;
  const c = audio();
  if (!c) return;
  try {
    SOUNDS[name](c.currentTime + 0.01);
    if (name === 'fanfare' || name === 'win') duckMusic(name === 'fanfare' ? 3.2 : 1.4);
  } catch {
    /* audio unavailable */
  }
}

/** Compatibility helpers for the menu UI. */
export const sfx = {
  move: () => play('move'),
  select: () => play('select'),
  back: () => play('back'),
  join: () => play('join'),
  error: () => play('error'),
};

function duckMusic(seconds: number): void {
  const c = ctx;
  if (!c || mood === 'off') return;
  const g = musicBus.gain;
  const now = c.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(MUSIC_LEVEL * 0.15, now + 0.15);
  g.setValueAtTime(MUSIC_LEVEL * 0.15, now + seconds);
  g.linearRampToValueAtTime(MUSIC_LEVEL, now + seconds + 1.2);
}

// ---------------------------------------------------------------- music

let timer = 0;
let pendingStart = 0;
/** Mood that is playing or about to start after a crossfade. */
let targetMood: MusicMood = 'off';
let nextBeatTime = 0;
let beat = 0; // eighth notes since the mood started
let rand = seededRandom(1);
let melodyIdx = 5;

function scheduleEighth(t: number): void {
  if (mood === 'off') return;
  const spec = MOODS[mood];
  const eighth = 30 / spec.bpm;
  const bar = Math.floor(beat / 8);
  const pos = beat % 8;
  const degree = spec.progression[bar % spec.progression.length] ?? 0;
  const chord = seventhChord(spec.root + 12, spec.scale, degree);
  const bus = musicBus;

  // Pad: soft chord on each bar, long attack.
  if (pos === 0) {
    for (const m of chord) {
      voice(note(m), t, eighth * 8.2, { type: 'triangle', gain: 0.035, attack: 0.4, release: 0.8, cutoff: 1400, bus, reverb: 0.4 });
      voice(note(m), t, eighth * 8.2, { type: 'sine', gain: 0.03, attack: 0.5, release: 0.8, detune: 7, bus });
    }
  }
  // Bass.
  const bassMidi = degreeToMidi(spec.root - 12, spec.scale, degree);
  if (spec.bass === 'half' ? pos === 0 || pos === 4 : pos % 2 === 0 || rand() < 0.25) {
    voice(note(bassMidi + (spec.bass === 'eighths' && pos === 6 ? 7 : 0)), t, eighth * (spec.bass === 'half' ? 3.6 : 0.9), { type: 'triangle', gain: 0.12, cutoff: 600, bus });
  }
  // Arpeggio: chord tones an octave up, plucky with reverb.
  if (rand() < spec.arp) {
    const m = (chord[Math.floor(rand() * chord.length)] ?? chord[0] ?? 60) + 12;
    voice(note(m), t, eighth * 1.6, { type: 'triangle', gain: 0.035, release: eighth * 1.4, cutoff: 3200, bus, reverb: 0.45 });
  }
  // Melody: a gentle pentatonic line on quarters, with rests and phrase endings.
  if (spec.melody > 0 && pos % 2 === 0 && pos !== 6 && rand() < spec.melody) {
    const penta = pentatonic(spec.scale);
    melodyIdx = nextMelodyStep(melodyIdx, rand);
    const m = spec.root + 24 + Math.floor(melodyIdx / 5) * 12 + (penta[melodyIdx % 5] ?? 0);
    bell(note(m), t, eighth * (rand() < 0.3 ? 4 : 2), 0.05, bus);
  }
  // Drums.
  if (spec.drums !== 'none') {
    if (pos === 0 || (spec.drums === 'groove' && pos === 5)) kick(t, spec.drums === 'groove' ? 0.28 : 0.18, bus);
    if (pos % 2 === 1) noise(t, 0.04, { type: 'highpass', freq: 7000, gain: spec.drums === 'groove' ? 0.06 : 0.03, bus });
    if (spec.drums === 'groove' && (pos === 2 || pos === 6)) noise(t, 0.12, { type: 'bandpass', freq: 1800, q: 0.8, gain: 0.1, bus, reverb: 0.2 });
  }
  beat++;
}

function scheduler(): void {
  const c = ctx;
  if (!c || mood === 'off') return;
  const eighth = 30 / MOODS[mood].bpm;
  // After a stall (tab hidden), skip ahead instead of firing a burst of late notes.
  if (nextBeatTime < c.currentTime - 0.1) nextBeatTime = c.currentTime + 0.05;
  while (nextBeatTime < c.currentTime + LOOKAHEAD_S) {
    scheduleEighth(nextBeatTime);
    nextBeatTime += eighth;
  }
}

function applyMood(): void {
  const target: MusicMood = musicEnabled && volume > 0 ? wantedMood : 'off';
  document.documentElement.dataset.music = target;
  if (target === targetMood) return;
  targetMood = target;
  window.clearTimeout(pendingStart);
  const c = target === 'off' ? ctx : audio();
  if (!c) {
    mood = 'off';
    targetMood = 'off'; // retried once audio becomes available
    return;
  }
  const now = c.currentTime;
  const g = musicBus.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + 0.5);
  window.clearInterval(timer);
  timer = 0;
  const start = () => {
    mood = target;
    if (target === 'off') return;
    beat = 0;
    rand = seededRandom(Math.floor(Math.random() * 1e9));
    melodyIdx = 5;
    nextBeatTime = c.currentTime + 0.1;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(0, c.currentTime);
    g.linearRampToValueAtTime(MUSIC_LEVEL, c.currentTime + 1.5);
    timer = window.setInterval(scheduler, TICK_MS);
    scheduler();
  };
  if (mood === 'off') start();
  else {
    mood = 'off';
    pendingStart = window.setTimeout(start, 550);
  }
}

/** Requests a background music mood; it only plays while music is enabled and volume > 0. */
export function setMusic(next: MusicMood): void {
  wantedMood = next;
  applyMood();
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  applyMood();
}

export function setMusicEnabled(on: boolean): void {
  musicEnabled = on;
  applyMood();
}

/** Browsers may start audio suspended until a user gesture: retry on any local input. */
export function unlockOnGesture(): void {
  const resume = () => {
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
    else if (!ctx && wantedMood !== 'off') applyMood();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, resume, { passive: true, capture: true });
}

/** Test hook: the final output node, so e2e/tooling can record or measure what the TV plays. */
export function outputNodeForTesting(): AudioNode | null {
  return audio() ? output : null;
}
