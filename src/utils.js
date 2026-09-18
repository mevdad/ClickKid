// Небольшие помощники: анимации по кадрам, сглаживания, случайные числа.

const running = new Set();

/**
 * Регистрирует покадровую анимацию. Функция получает dt (секунды)
 * и возвращает false, когда анимация закончена.
 */
export function animate(step) {
  running.add(step);
  return () => running.delete(step);
}

export function updateAnimations(dt) {
  for (const step of running) {
    if (step(dt) === false) running.delete(step);
  }
}

export function clearAnimations() {
  running.clear();
}

/** Анимация от 0 до 1 за duration секунд. */
export function tween(duration, onUpdate, onDone) {
  let t = 0;
  return animate((dt) => {
    t = Math.min(1, t + dt / duration);
    onUpdate(t);
    if (t >= 1) {
      onDone?.();
      return false;
    }
    return true;
  });
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
