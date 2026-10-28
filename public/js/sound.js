let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function unlock() {
  audio();
}

function tone(freq, delay, dur, type, gain, slide) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.04);
}

function noise(delay, dur, gain) {
  const c = audio();
  if (!c) return;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  const env = c.createGain();
  src.buffer = buffer;
  env.gain.value = gain;
  src.connect(env);
  env.connect(master);
  src.start(c.currentTime + delay);
}

export const sfx = {
  dice() {
    noise(0, 0.05, 0.5);
    tone(260, 0.02, 0.04, 'square', 0.25);
    tone(180, 0.08, 0.05, 'square', 0.3);
    tone(320, 0.14, 0.04, 'square', 0.22);
  },
  move() {
    tone(540, 0, 0.08, 'triangle', 0.35, 320);
  },
  enter() {
    tone(440, 0, 0.09, 'triangle', 0.4);
    tone(660, 0.08, 0.12, 'triangle', 0.4);
  },
  extra() {
    tone(660, 0, 0.08, 'square', 0.28);
    tone(880, 0.08, 0.1, 'square', 0.28);
  },
  capture() {
    noise(0.02, 0.16, 0.28);
    tone(190, 0, 0.07, 'sawtooth', 0.6, 70);
    tone(160, 0.1, 0.07, 'sawtooth', 0.6, 55);
    tone(95, 0.2, 0.22, 'square', 0.4, 45);
    tone(70, 0.36, 0.16, 'sawtooth', 0.3, 38);
  },
  forfeit() {
    tone(392, 0, 0.16, 'sawtooth', 0.32, 370);
    tone(330, 0.16, 0.16, 'sawtooth', 0.32, 310);
    tone(262, 0.32, 0.16, 'sawtooth', 0.32, 245);
    tone(196, 0.48, 0.34, 'sawtooth', 0.34, 165);
  },
  win() {
    [523, 659, 784, 1047].forEach((freq, i) => tone(freq, i * 0.14, 0.22, 'triangle', 0.42));
    tone(523, 0.56, 0.5, 'triangle', 0.3);
    tone(659, 0.56, 0.5, 'triangle', 0.26);
    tone(784, 0.56, 0.5, 'triangle', 0.26);
  },
  reaction(text) {
    const base = { 'LOL!': 720, 'WOW!': 480, 'NO!': 260, 'GG!': 900 }[text] || 600;
    tone(base, 0, 0.07, 'square', 0.3);
    tone(base * 1.5, 0.07, 0.09, 'square', 0.26);
  }
};
