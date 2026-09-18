import './style.css';
import { createScene } from './scene.js';
import { createGame } from './game.js';
import { createUI } from './ui.js';
import { updateAnimations } from './utils.js';
import { unlockAudio } from './audio.js';

const canvas = document.getElementById('scene');
const { renderer, scene, camera, resize, updateBackground } = createScene(canvas);

const ui = createUI({
  onStart: () => {
    unlockAudio();
    game.build();
  },
  onAgain: () => game.restart(),
});

const game = createGame({ scene, camera, canvas, ui });

resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

let last = performance.now();
let elapsed = 0;

function loop(now) {
  // dt ограничен сверху: после сворачивания вкладки анимации не «прыгают».
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;

  updateAnimations(dt);
  updateBackground(dt, elapsed);
  game.update(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
