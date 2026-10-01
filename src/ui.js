import { setMuted, isMuted } from './audio.js';
import { unlockSpeech, stopSpeech } from './speech.js';

/** Весь HTML-интерфейс: подсказки, кружки прогресса, карточки. */
export function createUI({ onStart, onAgain, onRepeat }) {
  const hint = document.getElementById('hint');
  const progress = document.getElementById('progress');
  const reveal = document.getElementById('reveal');
  const figureName = document.getElementById('figure-name');
  const startOverlay = document.getElementById('start');
  const loading = document.getElementById('loading');
  const muteButton = document.getElementById('mute');
  const repeatButton = document.getElementById('repeat');

  document.getElementById('play').addEventListener('click', () => {
    startOverlay.classList.add('hidden');
    unlockSpeech(); // голос можно включать только из жеста игрока
    onStart();
  });

  document.getElementById('again').addEventListener('click', () => {
    hideReveal();
    onAgain();
  });

  repeatButton.addEventListener('click', onRepeat);

  muteButton.addEventListener('click', () => {
    const next = !isMuted();
    setMuted(next);
    if (next) stopSpeech();
    muteButton.textContent = next ? '🔇' : '🔊';
    muteButton.setAttribute('aria-label', next ? 'Увімкнути звук' : 'Вимкнути звук');
  });

  let currentHint = '';

  function setHint(text) {
    if (text === currentHint) return;
    currentHint = text;
    // Короткое затухание, чтобы текст не «прыгал».
    hint.classList.add('swap');
    setTimeout(() => {
      hint.textContent = text;
      hint.classList.remove('swap');
    }, 180);
  }

  function setProgress(total, done) {
    if (progress.children.length !== total) {
      progress.replaceChildren();
      for (let i = 0; i < total; i++) {
        const pip = document.createElement('span');
        pip.className = 'pip';
        progress.append(pip);
      }
    }
    [...progress.children].forEach((pip, i) => {
      pip.classList.toggle('done', i < done);
    });
  }

  function clearProgress() {
    progress.replaceChildren();
  }

  function showReveal(name) {
    figureName.textContent = name;
    reveal.classList.remove('hidden');
  }

  function hideReveal() {
    reveal.classList.add('hidden');
  }

  return {
    setHint,
    setProgress,
    clearProgress,
    showReveal,
    hideReveal,
    showLoading: () => loading.classList.remove('hidden'),
    hideLoading: () => loading.classList.add('hidden'),
  };
}
