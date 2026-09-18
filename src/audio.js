// Все звуки синтезируются через WebAudio — внешних файлов нет.

let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Вызывается на первом касании/клике: браузеры требуют жест пользователя. */
export function unlockAudio() {
  ensure();
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = muted ? 0 : 0.5;
}

export function isMuted() {
  return muted;
}

function noiseBuffer(duration) {
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function playNoise({ duration = 0.2, type = 'bandpass', freq = 2000, q = 1, gain = 0.3 }) {
  if (!ensure() || muted) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(duration);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, ctx.currentTime);
  env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  src.connect(filter).connect(env).connect(master);
  src.start();
  src.stop(ctx.currentTime + duration);
}

function playTone({ freq = 440, duration = 0.2, type = 'sine', gain = 0.25, slideTo = null, delay = 0 }) {
  if (!ensure() || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Шуршание фольги. */
export function sfxFoil() {
  playNoise({ duration: 0.28, type: 'highpass', freq: 3200, gain: 0.22 });
  playNoise({ duration: 0.16, type: 'bandpass', freq: 5000, q: 0.7, gain: 0.14 });
}

/** Хруст шоколада. */
export function sfxCrack() {
  playNoise({ duration: 0.12, type: 'bandpass', freq: 1400, q: 1.5, gain: 0.35 });
  playTone({ freq: 180, slideTo: 70, duration: 0.18, type: 'triangle', gain: 0.2 });
}

/** Шоколад разлетелся на кусочки. */
export function sfxShatter() {
  sfxCrack();
  for (let i = 0; i < 5; i++) {
    playNoise({ duration: 0.2, type: 'bandpass', freq: 900 + Math.random() * 2500, q: 2, gain: 0.16 });
  }
}

/** Поворот крышки контейнера. */
export function sfxTwist() {
  playTone({ freq: 320, slideTo: 520, duration: 0.16, type: 'square', gain: 0.1 });
  playNoise({ duration: 0.1, type: 'bandpass', freq: 800, q: 3, gain: 0.1 });
}

/** Крышка открылась. */
export function sfxPop() {
  playTone({ freq: 220, slideTo: 900, duration: 0.18, type: 'sine', gain: 0.3 });
  playNoise({ duration: 0.08, type: 'highpass', freq: 4000, gain: 0.18 });
}

/** Фанфары при появлении игрушки. */
export function sfxFanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    playTone({ freq, duration: 0.3, type: 'triangle', gain: 0.22, delay: i * 0.11 });
    playTone({ freq: freq * 2, duration: 0.2, type: 'sine', gain: 0.08, delay: i * 0.11 });
  });
}

/** Лёгкий «блик» на промахе, чтобы клик не был беззвучным. */
export function sfxTap() {
  playTone({ freq: 880, slideTo: 1320, duration: 0.09, type: 'sine', gain: 0.08 });
}

/** Хлопок салюта — один залп фейерверка. */
export function sfxBoom() {
  playTone({ freq: 160, slideTo: 45, duration: 0.32, type: 'sine', gain: 0.26 });
  playNoise({ duration: 0.28, type: 'bandpass', freq: 1300, q: 0.6, gain: 0.2 });
  // Несколько убывающих «искр» после хлопка.
  for (let i = 0; i < 5; i++) {
    const freq = 900 + Math.random() * 1200;
    playTone({ freq, slideTo: freq * 0.3, duration: 0.15, type: 'triangle', gain: 0.06, delay: 0.08 + i * 0.05 });
  }
}
