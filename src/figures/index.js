import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createBee } from './bee.js';
import { createBear } from './bear.js';
import { createPiglet } from './piglet.js';
import { createTiger } from './tiger.js';
import { createBaby } from './baby.js';
import { tween, easeOutCubic } from '../utils.js';

/**
 * Игрушки внутри яйца.
 *
 * По умолчанию фигурки собираются прямо в коде из примитивов: так игра
 * не тянет внешние файлы и не зависит от чужих лицензий. Если положить
 * свою модель в public/models/ и прописать её в public/models/manifest.json,
 * она будет использована вместо процедурной.
 */
export const FIGURES = [
  { id: 'bee', name: 'Бджілка', create: createBee },
  { id: 'bear', name: 'Ведмежа', create: createBear },
  { id: 'piglet', name: 'Поросятко', create: createPiglet },
  { id: 'tiger', name: 'Тигреня', create: createTiger },
  { id: 'baby', name: 'Малюк', create: createBaby },
  // Запасной вариант без побега: сама модель лежит в public/models/boy.glb.
  { id: 'boy', name: 'Хлопчик', create: () => ({ ...createBaby(), name: 'Хлопчик' }) },
];

const TARGET_HEIGHT = 1.15; // на такую высоту масштабируется любая модель

let manifestPromise = null;

function getManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('models/manifest.json')
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return manifestPromise;
}

/** Подгоняет загруженную модель под размер контейнера и ставит её «на ноги». */
function fitModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const scale = TARGET_HEIGHT / Math.max(size.y, 0.0001);
  object.scale.setScalar(scale);
  object.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

/** Побег: спрыгнуть с контейнера на пол, добежать до края экрана и скрыться. */
const ESCAPE_DISTANCE = 6;   // дальше этого по X фигурку не видно при любом соотношении сторон
const ESCAPE_DEPTH = 1.8;    // бежит чуть ближе к камере, чем стоит контейнер
const LANDING_X = 0.9;       // спрыгивает мимо контейнера, а не внутрь него,
const LANDING_Z = 1.6;       // но так, чтобы приземление было видно и на узком экране
const JUMP_START = 0.3;      // секунды клипа
const JUMP_TIME = 0.6;
const RUN_TIME = 2.2;

/**
 * Клип проигрывается на месте, а саму фигурку мы ведём по сцене:
 * спрыгиваем с контейнера на пол, разворачиваемся и убегаем за кадр.
 * Клип начинается с испуганной стойки, затем идёт бег, в конце — прыжок.
 */
function createEscape(action, clipDuration) {
  /** `holder` — объект игры, который стоит на контейнере и которого мы двигаем. */
  return function escape(holder, onDone) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const start = holder.position.clone();
    const landing = new THREE.Vector3(side * LANDING_X, 0, LANDING_Z);
    const end = new THREE.Vector3(side * ESCAPE_DISTANCE, 0, ESCAPE_DEPTH);
    const heading = Math.atan2(end.x - landing.x, end.z - landing.z);
    const clamp01 = (t) => Math.min(1, Math.max(0, t));

    action.paused = false;

    tween(clipDuration, (u) => {
      const t = u * clipDuration;

      // Разворот лицом к пути: сначала к зрителю, потом в сторону бега.
      holder.rotation.y = heading * easeOutCubic(clamp01((t - 0.1) / 0.5));

      // Прыжок с контейнера: падение с лёгкой дугой, вбок и вперёд.
      const jump = clamp01((t - JUMP_START) / JUMP_TIME);
      const fly = easeOutCubic(jump);
      holder.position.y = start.y * (1 - jump * jump) + Math.sin(jump * Math.PI) * 0.25;
      holder.position.x = start.x + (landing.x - start.x) * fly;
      holder.position.z = start.z + (landing.z - start.z) * fly;

      // Приземлился — и бежит, понемногу набирая скорость.
      const run = clamp01((t - JUMP_START - JUMP_TIME) / RUN_TIME);
      if (run > 0) {
        const eased = run * (0.3 + 0.7 * run);
        holder.position.x = landing.x + (end.x - landing.x) * eased;
        holder.position.z = landing.z + (end.z - landing.z) * eased;
      }
    }, onDone);
  };
}

async function loadGltfFigure(url, name, { escape = false } = {}) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const group = new THREE.Group();
  const holder = new THREE.Group();
  fitModel(gltf.scene);
  holder.add(gltf.scene);
  group.add(holder);

  const clip = gltf.animations?.[0];
  const mixer = clip ? new THREE.AnimationMixer(gltf.scene) : null;
  const action = mixer?.clipAction(clip);

  if (action && escape) {
    // Пока мальчик стоит в контейнере, клип замирает на первом кадре.
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
  } else {
    action?.play();
  }

  function update(dt, elapsed) {
    mixer?.update(dt);
    if (!mixer) {
      // У статичной модели хотя бы лёгкое покачивание.
      holder.position.y = Math.sin(elapsed * 1.8) * 0.04;
      holder.rotation.z = Math.sin(elapsed * 1.2) * 0.04;
    }
  }

  const figure = { group, name, update };
  if (action && escape) figure.escape = createEscape(action, clip.duration);
  return figure;
}

/**
 * Создаёт фигурку по описанию: сначала пробует пользовательскую модель,
 * при любой осечке возвращается к процедурной.
 */
export async function createFigure(def) {
  const manifest = await getManifest();
  const entry = manifest?.[def.id];
  if (entry?.file) {
    try {
      return await loadGltfFigure(`models/${entry.file}`, entry.name || def.name, {
        escape: Boolean(entry.escape),
      });
    } catch (error) {
      console.warn(`Не удалось загрузить модель для "${def.id}", беру встроенную фигурку.`, error);
    }
  }
  return def.create();
}
