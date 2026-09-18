import * as THREE from 'three';
import { createFoil } from './egg/foil.js';
import { createChocolate } from './egg/chocolate.js';
import { createShellTopology } from './egg/shellPieces.js';
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
 *
 * Фольга видна и разделена на чётко раскрашенные кусочки — яйцо медленно
 * крутится само, чтобы все стороны стали доступны, а клик по конкретному
 * кусочку отрывает именно его (обычный прицельный клик/тап). Шоколад
 * непрозрачный — под ним не видно, куда именно бить, поэтому там клик
 * в любом месте экрана просто откалывает следующий целый кусочек, а яйцо
 * само доворачивается, чтобы он оказался на виду.
 */
export function createGame({ scene, camera, canvas, ui }) {
  const root = new THREE.Group();
  scene.add(root);

  const confetti = createConfetti(scene);
  const fireworks = createFireworks(scene);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Сюда переезжает уже отломанный кусочек фольги/шоколада — он летит
  // и падает в мировых координатах, независимо от того, что яйцо в это
  // время уже поворачивается к следующей цели.
  const debris = new THREE.Group();
  scene.add(debris);

  let state = 'idle';
  let busy = false;       // идёт анимация перехода между слоями
  let pendingTap = false; // клик, сделанный во время анимации, не пропадает
  let elapsed = 0;

  // Вращение яйца: baseRotationY — «целевой» угол (куда мы довернули яйцо
  // вручную для шоколада), поверх него всегда идёт лёгкое покачивание для
  // живости сцены. Пока снимают фольгу, яйцо ещё и крутится само (spinning).
  let baseRotationY = 0;
  let swayTime = 0;
  let swayAmplitude = 0.12;
  let spinning = false;

  let foil = null;
  let chocolate = null;
  let capsule = null;
  let figure = null;
  let figureHolder = null;
  let lastFigureId = null;
  let chocolateTotal = 0;
  let activeTarget = null; // кусочек шоколада, который отколется по клику (для фольги не нужен)

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

    // Общая топология для фольги и шоколада — оба слоя используют одни и
    // те же точки поверхности, поэтому фольга гарантированно не «тонет»
    // в шоколаде и не отстаёт от него зазором неправильной формы.
    const topology = createShellTopology();
    foil = createFoil(FOIL_SEGMENTS, debris, topology);
    chocolate = createChocolate(debris, topology);
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
    spinning = true;
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

  /** Доворачивает яйцо так, чтобы кусочек с углом midAngle оказался лицом к камере. */
  function faceAngle(midAngle) {
    const targetWorld = -midAngle;
    const delta = shortestDelta(baseRotationY, targetWorld);
    const from = baseRotationY;
    const to = from + delta;
    tween(0.4, (t) => {
      baseRotationY = from + (to - from) * easeOutCubic(t);
    });
  }

  /**
   * Выбирает следующий целый кусочек шоколада: в первую очередь самый
   * верхний ещё целый ряд (шоколад «открывается» сверху вниз, как
   * настоящий), а среди кусочков на этой же высоте — ближайший по углу
   * к текущему повороту, чтобы яйцо доворачивалось на минимальный угол,
   * а не прыгало по кругу. Для фольги не нужна — там целятся кликом.
   */
  function pickNewTarget(meshes) {
    if (!meshes.length) {
      activeTarget = null;
      return;
    }
    const topY = meshes.reduce((max, mesh) => Math.max(max, mesh.userData.centroid.y), -Infinity);
    const band = 0.35; // кусочки в пределах этой высоты от самого верхнего считаются «на одном уровне»

    let best = meshes[0];
    let bestDelta = Infinity;
    for (const mesh of meshes) {
      if (topY - mesh.userData.centroid.y > band) continue;
      const delta = Math.abs(shortestDelta(baseRotationY, -mesh.userData.midAngle));
      if (delta < bestDelta) {
        bestDelta = delta;
        best = mesh;
      }
    }
    activeTarget = best;
    faceAngle(activeTarget.userData.midAngle);
  }

  /** Кусочек фольги, ближайший на экране к точке клика — на случай промаха. */
  function nearestFoilMesh(meshes) {
    let best = null;
    let bestDist = Infinity;
    const ndc = new THREE.Vector3();
    for (const mesh of meshes) {
      ndc.copy(mesh.userData.centroid).applyMatrix4(mesh.matrixWorld).project(camera);
      const dist = Math.hypot(ndc.x - pointer.x, ndc.y - pointer.y);
      if (dist < bestDist) {
        bestDist = dist;
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

    if (state === 'chocolate' && !activeTarget) return;

    if (state === 'foil') {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(foil.meshes, false)[0];
      const target = hit ? hit.object : nearestFoilMesh(foil.meshes);
      if (!target) return;

      pulse();
      audio.sfxFoil();
      foil.peel(target);
      updateProgress();

      if (foil.remaining === 0) {
        spinning = false;
        setState('chocolate');
        pickNewTarget(chocolate.meshes);
      }
      return;
    }

    pulse();

    if (state === 'chocolate') {
      chocolate.peel(activeTarget);
      updateProgress();

      if (chocolate.remaining > 0) {
        audio.sfxCrack();
        pickNewTarget(chocolate.meshes);
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
    debris.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material?.dispose();
      }
    });
    debris.clear();
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
    spinning = false;
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

  /** Точка клика в нормализованных координатах экрана — нужна для прицела по фольге. */
  function setPointerFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onPointerDown(event) {
    audio.unlockAudio();
    setPointerFromEvent(event);
    advance();
  }

  canvas.addEventListener('pointerdown', onPointerDown);

  // Пробел и Enter тоже открывают яйцо — целятся в центр экрана.
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
    swayTime += dt;
    // Пока снимают фольгу, яйцо медленно крутится само, чтобы все стороны
    // по очереди оказались доступны для клика.
    if (spinning) baseRotationY += dt * 0.3;
    // Целевой угол плюс лёгкое покачивание — так сцена никогда не выглядит статичной.
    root.rotation.y = baseRotationY + Math.sin(swayTime * 0.7) * swayAmplitude;
    root.position.y = Math.sin(elapsed * 1.3) * 0.03;
    figure?.update(dt, elapsed);
  }

  return { build, restart, update };
}
