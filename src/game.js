import * as THREE from 'three';
import { createFoil } from './egg/foil.js';
import { createChocolate } from './egg/chocolate.js';
import { createCapsule, CAPSULE_TOP_Y } from './egg/capsule.js';
import { FIGURES, createFigure } from './figures/index.js';
import { createConfetti } from './confetti.js';
import { createFireworks } from './fireworks.js';
import * as audio from './audio.js';
import { tween, clearAnimations, easeOutBack, easeOutCubic, easeOutElastic } from './utils.js';

const FOIL_SEGMENTS = 8;
const CAPSULE_HITS = 3;

const HINTS = {
  foil: 'Снимай фольгу!',
  chocolate: 'Отламывай шоколад!',
  capsule: 'Крути крышечку!',
};

/**
 * Логика игры: слой фольги → шоколад → контейнер → игрушка.
 * Любой клик по экрану двигает текущий этап вперёд — так проще самым маленьким.
 *
 * Кусочки фольги и шоколада откалываются в случайном порядке (не привязаны
 * к месту клика), а яйцо само поворачивается так, чтобы следующий целый
 * кусочек оказался лицом к игроку — получается, будто оно «подставляется»
 * под удар.
 */
export function createGame({ scene, camera, canvas, ui }) {
  const root = new THREE.Group();
  scene.add(root);

  const confetti = createConfetti(scene);
  const fireworks = createFireworks(scene);

  let state = 'idle';
  let busy = false;       // идёт анимация перехода между слоями
  let pendingTap = false; // клик, сделанный во время анимации, не пропадает
  let elapsed = 0;

  // Вращение яйца: baseRotationY — «целевой» угол (куда мы довернули яйцо),
  // поверх него всегда идёт лёгкое покачивание для живости сцены.
  let baseRotationY = 0;
  let swayTime = 0;
  let swayAmplitude = 0.12;

  let foil = null;
  let chocolate = null;
  let capsule = null;
  let figure = null;
  let figureHolder = null;
  let lastFigureId = null;
  let chocolateTotal = 0;
  let activeTarget = null; // кусочек фольги/шоколада, который отколется по клику

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
    chocolateTotal = chocolate.remaining;
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
    setState('foil');
    pickNewTarget(foil.meshes, 1);
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
      ui.setProgress(chocolateTotal, chocolateTotal - chocolate.remaining);
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

  /** Кратчайший угол поворота от from к to (в диапазоне -π..π). */
  function shortestDelta(from, to) {
    const twoPi = Math.PI * 2;
    let d = (to - from) % twoPi;
    if (d > Math.PI) d -= twoPi;
    if (d < -Math.PI) d += twoPi;
    return d;
  }

  /**
   * Доворачивает яйцо так, чтобы кусочек с углом midAngle оказался
   * лицом к камере. spins добавляет целые обороты для более весёлой,
   * «крутящейся» подачи — используется для фольги.
   */
  function faceAngle(midAngle, spins = 0) {
    const targetWorld = -midAngle;
    const delta = shortestDelta(baseRotationY, targetWorld);
    const spinBonus = spins * Math.PI * 2 * (delta < 0 ? -1 : 1);
    const from = baseRotationY;
    const to = from + delta + spinBonus;
    tween(0.5 + spins * 0.25, (t) => {
      baseRotationY = from + (to - from) * easeOutCubic(t);
    });
  }

  /** Выбирает случайный ещё целый кусочек и поворачивает к нему яйцо. */
  function pickNewTarget(meshes, spins = 0) {
    if (!meshes.length) {
      activeTarget = null;
      return;
    }
    activeTarget = meshes[Math.floor(Math.random() * meshes.length)];
    faceAngle(activeTarget.userData.midAngle, spins);
  }

  function advance() {
    if (state === 'idle' || state === 'reveal') return;
    if (busy) {
      pendingTap = true;
      return;
    }

    if ((state === 'foil' || state === 'chocolate') && !activeTarget) return;

    pulse();

    if (state === 'foil') {
      audio.sfxFoil();
      foil.peel(activeTarget);
      updateProgress();

      if (foil.remaining > 0) {
        pickNewTarget(foil.meshes, 1);
      } else {
        setState('chocolate');
        pickNewTarget(chocolate.meshes, 0);
      }
      return;
    }

    if (state === 'chocolate') {
      chocolate.peel(activeTarget);
      updateProgress();

      if (chocolate.remaining > 0) {
        audio.sfxCrack();
        pickNewTarget(chocolate.meshes, 0);
      } else {
        audio.sfxShatter();
        activeTarget = null;
        setBusy(true);
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
    // смотрела на игрока, а не стояла спиной, и усиливаем покачивание —
    // так фигурка «красуется» перед камерой.
    const fromRotation = baseRotationY;
    const toRotation = Math.round(fromRotation / (Math.PI * 2)) * Math.PI * 2;
    tween(0.6, (t) => {
      baseRotationY = fromRotation + (toRotation - fromRotation) * easeOutCubic(t);
    }, () => {
      baseRotationY = 0;
    });
    tween(0.6, (t) => {
      swayAmplitude = 0.12 + 0.18 * t;
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

    const skyOrigin = new THREE.Vector3(0, CAPSULE_TOP_Y + 1.7, -0.5);
    audio.sfxFanfare();
    confetti.burst(new THREE.Vector3(0, CAPSULE_TOP_Y + 0.5, 0));
    fireworks.launch(skyOrigin, { count: 5, onBurst: () => audio.sfxBoom() });
    ui.setHint('Ура! Ты открыл сюрприз!');
    ui.clearProgress();
    ui.showReveal(figure.name);
  }

  function teardown() {
    clearAnimations();
    confetti.clear();
    fireworks.clear();
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
    baseRotationY = 0;
    swayAmplitude = 0.12;
    activeTarget = null;
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

  function onPointerDown() {
    audio.unlockAudio();
    advance();
  }

  canvas.addEventListener('pointerdown', onPointerDown);

  // Пробел и Enter тоже открывают яйцо — удобно на ноутбуке.
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    if (document.activeElement?.tagName === 'BUTTON') return;
    event.preventDefault();
    audio.unlockAudio();
    advance();
  });

  function update(dt) {
    elapsed += dt;
    swayTime += dt;
    // Целевой угол плюс лёгкое покачивание — так сцена никогда не выглядит статичной.
    root.rotation.y = baseRotationY + Math.sin(swayTime * 0.7) * swayAmplitude;
    root.position.y = Math.sin(elapsed * 1.3) * 0.03;
    figure?.update(dt, elapsed);
  }

  return { build, restart, update };
}
