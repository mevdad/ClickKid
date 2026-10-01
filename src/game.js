import * as THREE from 'three';
import { createFoil } from './egg/foil.js';
import { createChocolate } from './egg/chocolate.js';
import { createShellTopology } from './egg/shellPieces.js';
import { createCapsule, CAPSULE_TOP_Y } from './egg/capsule.js';
import { FIGURES, createFigure } from './figures/index.js';
import { createConfetti } from './confetti.js';
import { createFireworks } from './fireworks.js';
import * as audio from './audio.js';
import * as speech from './speech.js';
import { tween, clearAnimations, easeOutBack, easeOutCubic, easeOutElastic } from './utils.js';

const FOIL_SEGMENTS = 8;
const CAPSULE_HITS = 3;

const PRAISE = ['Молодець!', 'Розумничка!', 'Чудово!', 'Правильно!'];
const REMIND_AFTER = 10;  // секунд тишины, после которых диктор повторяет задание
const VISIBLE_ANGLE = 1.0; // цвет просим только среди участков, что видны игроку (рад. от центра)

const HINTS = {
  chocolate: 'Відламуй шоколад!',
  capsule: 'Крути кришечку!',
};

/**
 * Логика игры: слой фольги → шоколад → контейнер → игрушка.
 *
 * И фольга, и шоколад устроены одинаково: клик в любом месте экрана
 * срывает/откусывает намеченный целый участок, а яйцо само доворачивается
 * так, чтобы следующий ещё целый участок оказался лицом к игроку — никогда
 * не приходится смотреть на пустую сторону, гадая, куда двинуться дальше.
 * Фольга — игра на цвета: диктор просит «Выбери зелёный!», и сорвать
 * получится только тот участок, что назвали; на другой цвет яйцо лишь
 * покачивается и подсказывает, какой цвет нажат и какой нужен.
 * Фольга рвётся целым цветным участком по контуру (хаотичным, но округлым
 * пятном, без единой прямой грани) — как будто её реально сдирают.
 * Шоколадный кусочек «откусывают»: он сжимается на месте и тает, никуда
 * не летя и не падая.
 */
export function createGame({ scene, camera, canvas, ui }) {
  const root = new THREE.Group();
  scene.add(root);

  const confetti = createConfetti(scene);
  const fireworks = createFireworks(scene);

  // Сюда летят декоративные обрывки фольги — в мировых координатах,
  // независимо от того, что яйцо в это время уже поворачивается.
  const debris = new THREE.Group();
  scene.add(debris);

  let state = 'idle';
  let busy = false;       // идёт анимация перехода между слоями
  let pendingTap = false; // клик, сделанный во время анимации, не пропадает
  let elapsed = 0;

  // Вращение яйца: baseRotationY — «целевой» угол, куда яйцо довёрнуто,
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
  let activeTarget = null; // намеченный кусочек шоколада, который сработает по клику
  let askedPatch = null;   // участок фольги, цвет которого сейчас просит назвать диктор
  let idleTime = 0;        // сколько секунд игрок не отвечает на задание
  let shake = 0;           // «мотание головой» яйца при неверном цвете
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

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
    chocolate = createChocolate(topology);
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
    askNextColor('Давай знімемо фольгу! ');
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
   * а не прыгало по кругу.
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

  /**
   * Доворачивает яйцо к ближайшему ещё целому участку фольги (на минимальный
   * угол), а затем просит игрока выбрать цвет одного из участков, видимых
   * с этой стороны, — не обязательно того, что ровно по центру, иначе
   * достаточно было бы всегда нажимать в середину яйца.
   */
  function askNextColor(prefix = '') {
    const targets = foil?.targets ?? [];
    if (!targets.length) {
      askedPatch = null;
      return;
    }
    let view = targets[0];
    let viewDelta = Infinity;
    for (const patch of targets) {
      const delta = Math.abs(shortestDelta(baseRotationY, -patch.midAngle));
      if (delta < viewDelta) {
        viewDelta = delta;
        view = patch;
      }
    }
    const front = baseRotationY + shortestDelta(baseRotationY, -view.midAngle);
    faceAngle(view.midAngle);

    const visible = targets.filter(
      (patch) => Math.abs(shortestDelta(front, -patch.midAngle)) < VISIBLE_ANGLE
    );
    askedPatch = visible[Math.floor(Math.random() * visible.length)] || view;
    idleTime = 0;

    ui.setHint(`Обери ${askedPatch.colorShown}!`);
    speech.speak(`${prefix}Обери ${askedPatch.colorName}!`);
  }

  /** Повторяет задание голосом — по кнопке, по пробелу или когда игрок долго молчит. */
  function repeatPrompt() {
    idleTime = 0;
    if (state === 'foil' && askedPatch) speech.speak(`Обери ${askedPatch.colorName}!`);
  }

  /** Участок фольги под пальцем/курсором (null — мимо яйца или в сорванном месте). */
  function patchUnderPointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    // Берём только самое близкое попадание: сквозь дырку в фольге
    // задняя стенка оболочки не считается.
    const hit = raycaster.intersectObject(foil.mesh)[0];
    return hit?.uv ? foil.patchAtUV(hit.uv.x, hit.uv.y) : null;
  }

  function tapFoil(event) {
    if (busy || !askedPatch) return;
    idleTime = 0;
    const patch = patchUnderPointer(event);
    if (!patch) {
      audio.sfxTap();
      return;
    }
    if (patch === askedPatch) chooseRightColor(patch);
    else chooseWrongColor(patch);
  }

  function chooseRightColor(patch) {
    askedPatch = null;
    pulse();
    audio.sfxFoil();
    audio.sfxCorrect();
    foil.peelPatch(patch);
    updateProgress();

    if (foil.remaining === 0) {
      setBusy(true);
      foil.finish(() => {
        setState('chocolate');
        speech.speak(`Молодець! ${HINTS.chocolate}`);
        pickNewTarget(chocolate.meshes);
        setBusy(false);
      });
    } else {
      askNextColor(`${PRAISE[Math.floor(Math.random() * PRAISE.length)]} `);
    }
  }

  function chooseWrongColor(patch) {
    audio.sfxWrong();
    tween(0.45, (t) => {
      shake = Math.sin(t * 38) * 0.09 * (1 - t);
    }, () => {
      shake = 0;
    });
    speech.speak(`Це ${patch.colorName}. Знайди ${askedPatch.colorName}!`);
  }

  function advance() {
    if (state === 'idle' || state === 'reveal') return;
    if (busy) {
      pendingTap = true;
      return;
    }

    // Фольгу рвут только выбором цвета (tapFoil) — «клик куда угодно» ей не подходит.
    if (state === 'foil') return;
    if (state === 'chocolate' && !activeTarget) return;

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
          speech.speak(HINTS.capsule);
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
    ui.setHint('Ура! Сюрприз відкрито!');
    speech.speak(`Ура! Це ${figure.name}!`);
    ui.clearProgress();
    ui.showReveal(figure.name);
  }

  function teardown() {
    clearAnimations();
    speech.stopSpeech();
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
    activeTarget = null;
    askedPatch = null;
    idleTime = 0;
    shake = 0;
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
    if (state === 'foil') tapFoil(event);
    else advance();
  }

  canvas.addEventListener('pointerdown', onPointerDown);

  // Пробел и Enter тоже открывают яйцо — удобно на ноутбуке.
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    if (document.activeElement?.tagName === 'BUTTON') return;
    event.preventDefault();
    audio.unlockAudio();
    if (state === 'foil') repeatPrompt();
    else advance();
  });

  function update(dt) {
    elapsed += dt;
    swayTime += dt;
    // Целевой угол плюс лёгкое покачивание — так сцена никогда не выглядит статичной.
    root.rotation.y = baseRotationY + Math.sin(swayTime * 0.7) * swayAmplitude + shake;
    root.position.y = Math.sin(elapsed * 1.3) * 0.03;
    figure?.update(dt, elapsed);

    // Игрок замешкался — диктор мягко повторяет задание.
    if (state === 'foil' && askedPatch && !busy) {
      idleTime += dt;
      if (idleTime >= REMIND_AFTER) repeatPrompt();
    }
  }

  return { build, restart, update, repeatPrompt };
}
