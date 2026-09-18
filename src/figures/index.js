import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createBee } from './bee.js';
import { createBear } from './bear.js';
import { createPiglet } from './piglet.js';

/**
 * Игрушки внутри яйца.
 *
 * По умолчанию фигурки собираются прямо в коде из примитивов: так игра
 * не тянет внешние файлы и не зависит от чужих лицензий. Если положить
 * свою модель в public/models/ и прописать её в public/models/manifest.json,
 * она будет использована вместо процедурной.
 */
export const FIGURES = [
  { id: 'bee', name: 'Пчёлка', create: createBee },
  { id: 'bear', name: 'Медвежонок', create: createBear },
  { id: 'piglet', name: 'Поросёнок', create: createPiglet },
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

async function loadGltfFigure(url, name) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const group = new THREE.Group();
  const holder = new THREE.Group();
  fitModel(gltf.scene);
  holder.add(gltf.scene);
  group.add(holder);

  const mixer = gltf.animations?.length ? new THREE.AnimationMixer(gltf.scene) : null;
  if (mixer) mixer.clipAction(gltf.animations[0]).play();

  function update(dt, elapsed) {
    mixer?.update(dt);
    if (!mixer) {
      // У статичной модели хотя бы лёгкое покачивание.
      holder.position.y = Math.sin(elapsed * 1.8) * 0.04;
      holder.rotation.z = Math.sin(elapsed * 1.2) * 0.04;
    }
  }

  return { group, name, update };
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
      return await loadGltfFigure(`models/${entry.file}`, entry.name || def.name);
    } catch (error) {
      console.warn(`Не удалось загрузить модель для "${def.id}", беру встроенную фигурку.`, error);
    }
  }
  return def.create();
}
