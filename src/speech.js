import { isMuted } from './audio.js';

// Голос диктора — встроенный синтезатор речи браузера (Web Speech API),
// никаких аудиофайлов. Если синтеза нет, игра остаётся играбельной:
// каждая фраза ещё и написана в подсказке сверху.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voice = null;

function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  const russian = voices.filter((v) => /^ru\b/i.test(v.lang.replace('_', '-')));
  // Предпочитаем «родной» голос устройства: он не требует сети и не запаздывает.
  voice = russian.find((v) => v.localService) || russian[0] || null;
}

if (synth) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
}

/**
 * Браузеры (особенно iOS) разрешают говорить только после жеста игрока —
 * «прогреваем» синтезатор беззвучной фразой на кнопке «Играть!».
 */
export function unlockSpeech() {
  if (!synth) return;
  const utterance = new SpeechSynthesisUtterance(' ');
  utterance.volume = 0;
  synth.speak(utterance);
}

/** Говорит фразу, перебивая то, что звучит сейчас, — старая подсказка ни к чему. */
export function speak(text) {
  if (!synth || isMuted()) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9;  // малышу проще понять неспешную речь
  utterance.pitch = 1.15;
  synth.speak(utterance);
}

export function stopSpeech() {
  synth?.cancel();
}
