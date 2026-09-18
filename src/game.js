import * as THREE from 'three';
import { EGG } from './egg/eggShape.js';
import { createFoil } from './egg/foil.js';
import { createChocolate } from './egg/chocolate.js';
import { createCapsule, CAPSULE_TOP_Y } from './egg/capsule.js';
import { FIGURES, createFigure } from './figures/index.js';
import { createConfetti } from './confetti.js';
import * as audio from './audio.js';
import { tween, clearAnimations, easeOutBack, easeOutCubic, easeOutElastic } from './utils.js';

const FOIL_SEGMENTS = 8;
const CHOCOLATE_HITS = 4; // три трещины + удар, который разбивает скорлупу
const CAPSULE_HITS = 3;

const HINTS = {
  foil: 'Снимай фольгу!',
  chocolate: 'Стучи по шоколаду!',
  capsule: 'Крути крышечку!',
};

/**
 * Логика игры: слой фольги → шоколад → контейнер → игрушка.
 * Любой клик по экрану двигает текущий этап вперёд — так проще самым маленьким.
 */
export function createGame({ scene, camera, canvas, ui }) {
  const root = new THREE.Group();
  scene.add(root);

  const confetti = createConfetti(scene);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ndc = new THREE.Vector3();

  let state = 'idle';
  let busy = false;      // идёт анимация перехода между слоями
  let pendingTap = false; // клик, сделанный во время анимации, не пропадает
  let elapsed = 0;
  let spinning = false; // яйцо крутится, пока его открывают
  let swayTime = -1;    // после финала игрушка мягко качается лицом к игроку

  let foil = null;
  let chocolate = null;
  let capsule = null;
  let figure = null;
  let figureHolder = null;
  let lastFigureId = null;

  /**
   * Следующая игрушка — случайная, но не та же, что была только что.
   * Через ?figure=bee можно зафиксировать конкретную фигурку (удобно для отладки).
   */
  function nextFigureDef() {
    const forced = new URLSearchParams(location.search).get('figure');
    const pinned = FIGURES.find((f) => f.id === forced);
    if (pinned) {
      lastFigureId = pinned.id;
      return pinned;
    }
    const options = FIGURES.filter((f) => f.id !== lastFigureId);
    const def = options[Math.floor(Math.random() * options.length)] || FIGURES[0];
    lastFigureId = def.id;
    return def;
  }

  async function build() {
    ui.showLoading();

    foil = createFoil(FOIL_SEGMENTS);
    chocolate = createChocolate();
    capsule = createCapsule();
    root.add(chocolate.group, foil.group, capsule.group);

    const def = nextFigureDef();
    figure = await createFigure(def);

    figureHolder = new THREE.Group();
    figureHolder.position.y = 0.5;
    figureHolder.scale.setScalar(0.001);
    figureHolder.visible = false;
    figureHolder.add(figure.group);
    root.add(figureHolder);

    ui.hideLoading();
    spinning = true;
    setState('foil');
  }

  /** Снимая блокировку, доигрываем клик, сделанный во время анимации. */
  function setBusy(value) {
    busy = value;
    if (!busy && pendingTap) {
      pendingTap = false;
      advance();
    }
  }

  function setState(next) {
    state = next;
    if (HINTS[next]) ui.setHint(HINTS[next]);
    updateProgress();
  }

  function updateProgress() {
    if (state === 'foil') {
      ui.setProgress(FOIL_SEGMENTS, FOIL_SEGMENTS - foil.remaining);
    } else if (state === 'chocolate') {
      ui.setProgress(CHOCOLATE_HITS, CHOCOLATE_HITS - chocolate.remaining);
    } else if (state === 'capsule') {
      ui.setProgress(CAPSULE_HITS, CAPSULE_HITS - capsule.remaining);
    } else {
      ui.clearProgress();
    }
  }

  /** Короткое «пружинящее» сжатие яйца на каждый клик. */
  function pulse(strength = 0.05) {
    tween(0.45, (t) => {
      root.scale.setScalar(1 + strength * (1 - easeOutElastic(t)));
    }, () => root.scale.setScalar(1));
  }

  /** Лепесток фольги, ближайший к точке нажатия на экране. */
  function nearestMeshToPointer(meshes) {
    let best = null;
    let bestDistance = Infinity;
    for (const mesh of meshes) {
      mesh.getWorldPosition(ndc);
      // Геометрия сектора описана вокруг оси яйца, поэтому берём точку
      // на его середине, а не центр меша.
      const angle = mesh.userData.midAngle ?? 0;
      ndc.x += Math.sin(angle) * EGG.radius;
      ndc.z += Math.cos(angle) * EGG.radius;
      ndc.project(camera);
      const distance = Math.hypot(ndc.x - pointer.x, ndc.y - pointer.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = mesh;
      }
    }
    return best;
  }

  function advance() {
    if (state === 'idle' || state === 'reveal') return;
    if (busy) {
      pendingTap = true;
      return;
    }

    pulse();

    if (state === 'foil') {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(foil.meshes, false)[0];
      const petal = hit?.object ?? nearestMeshToPointer(foil.meshes);
      if (!petal) return;

      audio.sfxFoil();
      foil.peel(petal);
      updateProgress();

      if (foil.remaining === 0) setState('chocolate');
      return;
    }

    if (state === 'chocolate') {
      const result = chocolate.hit();
      if (result === 'crack') {
        audio.sfxCrack();
        updateProgress();
      } else if (result === 'shatter') {
        audio.sfxShatter();
        setBusy(true);
        updateProgress();
        capsule.reveal(() => {
          setState('capsule');
          setBusy(false);
        });
      }
      return;
    }

    if (state === 'capsule') {
      const result = capsule.hit();
      if (result === 'twist') {
        audio.sfxTwist();
        updateProgress();
      } else if (result === 'open') {
        audio.sfxPop();
        setBusy(true);
        updateProgress();
        // Игрушка выскакивает почти сразу, не дожидаясь падения крышки.
        tween(0.28, () => {}, revealFigure);
      }
    }
  }

  function revealFigure() {
    state = 'reveal';
    capsule.settle();

    // Доворачиваем яйцо до ближайшего полного оборота, чтобы игрушка
    // смотрела на игрока, а не стояла спиной.
    spinning = false;
    const fromRotation = root.rotation.y;
    const toRotation = Math.round(fromRotation / (Math.PI * 2)) * Math.PI * 2;
    tween(0.6, (t) => {
      root.rotation.y = fromRotation + (toRotation - fromRotation) * easeOutCubic(t);
    }, () => {
      root.rotation.y = 0;
      swayTime = 0;
    });

    figureHolder.visible = true;
    const fromY = 0.5;
    const toY = CAPSULE_TOP_Y;
    tween(0.75, (t) => {
      const e = easeOutBack(t);
      figureHolder.position.y = fromY + (toY - fromY) * e;
      figureHolder.scale.setScalar(Math.max(0.001, e));
    }, () => {
      setBusy(false);
    });

    audio.sfxFanfare();
    confetti.burst(new THREE.Vector3(0, CAPSULE_TOP_Y + 0.5, 0));
    ui.setHint('Ура! Ты открыл сюрприз!');
    ui.clearProgress();
    ui.showReveal(figure.name);
  }

  function teardown() {
    clearAnimations();
    confetti.clear();
    foil?.dispose();
    chocolate?.dispose();
    capsule?.dispose();
    if (figureHolder) {
      figureHolder.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material?.dispose();
        }
      });
    }
    root.clear();
    root.scale.setScalar(1);
    root.rotation.y = 0;
    spinning = false;
    swayTime = -1;
    foil = chocolate = capsule = figure = figureHolder = null;
  }

  async function restart() {
    state = 'idle';
    busy = true;
    pendingTap = false;
    teardown();
    await build();
    setBusy(false);
  }

  function onPointerDown(event) {
    audio.unlockAudio();
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    advance();
  }

  canvas.addEventListener('pointerdown', onPointerDown);

  // Пробел и Enter тоже открывают яйцо — удобно на ноутбуке.
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    if (document.activeElement?.tagName === 'BUTTON') return;
    event.preventDefault();
    audio.unlockAudio();
    pointer.set(0, 0);
    advance();
  });

  function update(dt) {
    elapsed += dt;
    // Яйцо медленно вращается и покачивается, чтобы сцена не была статичной.
    if (spinning) {
      root.rotation.y += dt * 0.18;
    } else if (swayTime >= 0) {
      swayTime += dt;
      root.rotation.y = Math.sin(swayTime * 0.7) * 0.3;
    }
    root.position.y = Math.sin(elapsed * 1.3) * 0.03;
    figure?.update(dt, elapsed);
  }

  return { build, restart, update };
}
