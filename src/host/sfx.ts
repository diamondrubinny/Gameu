/** Small synthesized UI sounds (no audio files, no network). */
let ctx: AudioContext | null = null;
let volume = 0.7;

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
}

function tone(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.08): void {
  if (volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain * volume;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    /* audio unavailable */
  }
}

export const sfx = {
  move: () => tone(520, 60, 'triangle'),
  select: () => tone(780, 120, 'triangle'),
  back: () => tone(330, 100, 'triangle'),
  join: () => {
    tone(660, 90);
    setTimeout(() => tone(990, 120), 90);
  },
  error: () => tone(180, 200, 'square', 0.05),
};
