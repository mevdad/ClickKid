import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { buildFullShellGeometry, surfacePoint } from './shellPieces.js';
import { animate, rand } from '../utils.js';

const FOIL_COLORS = [0xff4d6d, 0xffd166, 0x4cc9f0, 0x80ed99, 0xf72585, 0xffa552, 0x9b5de5, 0x00bbf9];
const TEXTURE_W = 1024;
const TEXTURE_H = 512; // theta: 0..2π (по ширине), t: 0..π (по высоте)

/**
 * Заранее считает контуры цветных участков узора — ровно clicksNeeded штук,
 * распределённых по кругу (с небольшим случайным разбросом, чтобы не
 * выглядело механически), по одному на каждый клик. У каждого участка
 * известен его угол (midAngle) — по нему яйцо потом доворачивается так,
 * чтобы очередной ещё целый участок оказался лицом к игроку.
 */
function buildFoilPatches(canvas, count) {
  const patches = [];
  for (let i = 0; i < count; i++) {
    const color = FOIL_COLORS[i % FOIL_COLORS.length];
    const baseTheta = (i / count) * Math.PI * 2;
    const theta = ((baseTheta + rand(-0.3, 0.3)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const cx = (theta / (Math.PI * 2)) * canvas.width;
    // Среднее двух случайных чисел сгущает участки к экватору — у самых
    // полюсов текстура сильно сжимается по ширине, и круглое пятно там
    // растягивается в вертикальную полосу.
    const cy = ((Math.random() + Math.random()) / 2) * canvas.height;
    const r = rand(115, 175); // участков немного (по числу кликов) — каждый крупный
    const path = new Path2D();
    // Участок из нескольких смещённых кругов — неровный, но округлый контур.
    for (let k = 0; k < 4; k++) {
      path.moveTo(cx, cy);
      path.arc(cx + rand(-r * 0.4, r * 0.4), cy + rand(-r * 0.4, r * 0.4), r * rand(0.6, 1), 0, Math.PI * 2);
    }
    patches.push({
      cx,
      cy,
      r,
      path,
      color,
      torn: false,
      midAngle: theta,
      t: (cy / canvas.height) * Math.PI,
    });
  }
  return patches;
}

/** Красочный узор фольги: светлый металлический фон и цветные участки по контурам. */
function paintFoilPattern(ctx, canvas, patches) {
  const base = ctx.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, '#fff4f9');
  base.addColorStop(1, '#ffe3f1');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const patch of patches) {
    ctx.fillStyle = `#${patch.color.toString(16).padStart(6, '0')}`;
    ctx.fill(patch.path);
  }
}

/** Смещения по X для отрисовки у самого шва (theta = 0 / 2π), чтобы участок не обрывался. */
function seamOffsets(x, width, r) {
  const offsets = [0];
  if (x - r < 0) offsets.push(width);
  if (x + r > width) offsets.push(-width);
  return offsets;
}

/** Стирает альфу текстуры ровно по контуру участка — целиком, одним движением. */
function tearPatch(ctx, canvas, patch) {
  patch.torn = true;
  ctx.globalCompositeOperation = 'destination-out';
  for (const dx of seamOffsets(patch.cx, canvas.width, patch.r)) {
    ctx.save();
    ctx.translate(dx, 0);
    ctx.fill(patch.path);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Маленький блестящий обрывок фольги, улетающий с места отрыва — для отдачи. */
function spawnScrap(worldPoint, debris, color) {
  const size = rand(0.07, 0.13);
  const geometry = new THREE.SphereGeometry(size, 8, 6);
  geometry.scale(1, 0.3, 0.7);
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.6,
    roughness: 0.3,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const scrap = new THREE.Mesh(geometry, material);
  scrap.position.copy(worldPoint);
  scrap.rotation.set(rand(0, Math.PI * 2), rand(0, Math.PI * 2), rand(0, Math.PI * 2));
  debris.add(scrap);

  const eggCenter = new THREE.Vector3(0, EGG.centerY, 0);
  const dir = worldPoint.clone().sub(eggCenter);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(rand(-1, 1), 0, rand(-1, 1));
  dir.normalize();

  const velocity = dir.multiplyScalar(rand(1.4, 2.4));
  velocity.y = rand(1.6, 2.8);
  const spin = new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8));

  let life = 0;
  const total = 0.75;
  animate((dt) => {
    life += dt;
    velocity.y -= 10 * dt;
    scrap.position.addScaledVector(velocity, dt);
    scrap.rotation.x += spin.x * dt;
    scrap.rotation.y += spin.y * dt;
    scrap.rotation.z += spin.z * dt;
    scrap.material.opacity = Math.max(0, 1 - life / total);
    if (life >= total) {
      debris.remove(scrap);
      scrap.geometry.dispose();
      scrap.material.dispose();
      return false;
    }
    return true;
  });
}

/**
 * Слой фольги: одна цельная гладкая оболочка (без единого треугольного
 * шва в силуэте — форма ровно повторяет поверхность яйца), обёрнутая
 * в цветной узор из clicksNeeded участков. Каждый клик срывает ровно один
 * ещё целый участок целиком по его контуру — хаотичным, но округлым
 * пятном, как будто фольгу реально сдирают, а не отламывают кусками.
 * Сквозь сорванный участок сразу виден шоколад под ним.
 *
 * У каждого участка известен угол на поверхности (midAngle) — по нему
 * игра (game.js) доворачивает яйцо так, чтобы очередной целый участок
 * оказался лицом к игроку, прежде чем его сорвут.
 */
export function createFoil(clicksNeeded, debris, topology) {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const scale = 1.05;
  const geometry = buildFullShellGeometry(topology, scale);

  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const ctx = canvas.getContext('2d');
  const patches = buildFoilPatches(canvas, clicksNeeded);
  paintFoilPattern(ctx, canvas, patches);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    metalness: 0.55,
    roughness: 0.32,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.layer = 'foil';
  group.add(mesh);

  let remainingCount = clicksNeeded;

  /** Срывает конкретный участок целиком и отправляет обрывок в полёт. */
  function peelPatch(patch) {
    if (!patch || patch.torn) return false;
    tearPatch(ctx, canvas, patch);
    texture.needsUpdate = true;
    remainingCount--;

    const localPoint = surfacePoint(patch.midAngle, patch.t, scale);
    spawnScrap(group.localToWorld(localPoint), debris, patch.color);
    return true;
  }

  /** Последний рывок: остатки фольги полностью тают за один плавный переход. */
  function finish(onDone) {
    let life = 0;
    const total = 0.4;
    animate((dt) => {
      life += dt;
      material.opacity = Math.max(0, 1 - life / total);
      if (life >= total) {
        mesh.visible = false;
        onDone?.();
        return false;
      }
      return true;
    });
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    group.clear();
  }

  return {
    group,
    mesh,
    get remaining() {
      return remainingCount;
    },
    /** Ещё целые участки — цели для доворота яйца (у каждого есть .midAngle). */
    get targets() {
      return patches.filter((p) => !p.torn);
    },
    peelPatch,
    finish,
    dispose,
  };
}
