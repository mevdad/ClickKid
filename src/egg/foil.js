import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { buildFullShellGeometry } from './shellPieces.js';
import { animate, rand } from '../utils.js';

const FOIL_COLORS = [0xff4d6d, 0xffd166, 0x4cc9f0, 0x80ed99, 0xf72585, 0xffa552, 0x9b5de5, 0x00bbf9];
const TEXTURE_W = 1024;
const TEXTURE_H = 512; // theta: 0..2π (по ширине), t: 0..π (по высоте)

/**
 * Заранее считает контуры цветных пятен узора (форма и положение — как в
 * исходном рисунке), чтобы при стирании можно было оторвать задетое пятно
 * ровно по его контуру, а не разрезать его пополам случайным кругом.
 */
function buildFoilPatches(canvas) {
  const patches = [];
  for (let i = 0; i < 30; i++) {
    const color = FOIL_COLORS[Math.floor(Math.random() * FOIL_COLORS.length)];
    const cx = rand(0, canvas.width);
    // Среднее двух случайных чисел сгущает пятна к экватору — у самых
    // полюсов текстура сильно сжимается по ширине, и круглое пятно там
    // растягивается в вертикальную полосу.
    const cy = ((Math.random() + Math.random()) / 2) * canvas.height;
    const r = rand(60, 140);
    const path = new Path2D();
    // Пятно из нескольких смещённых кругов — неровный, но округлый контур.
    for (let k = 0; k < 4; k++) {
      path.moveTo(cx, cy);
      path.arc(cx + rand(-r * 0.4, r * 0.4), cy + rand(-r * 0.4, r * 0.4), r * rand(0.6, 1), 0, Math.PI * 2);
    }
    patches.push({ cx, cy, r, path, color, torn: false });
  }
  return patches;
}

/** Красочный узор фольги: светлый металлический фон и цветные пятна по заданным контурам. */
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

/** Создаёт canvas-текстуру фольги с альфа-каналом (для последующего «стирания»). */
function createFoilTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const ctx = canvas.getContext('2d');
  const patches = buildFoilPatches(canvas);
  paintFoilPattern(ctx, canvas, patches);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx, texture, patches };
}

/** Смещения по X для стирания у самого шва (theta = 0 / 2π), чтобы пятно не обрывалось. */
function seamOffsets(x, width, r) {
  const offsets = [0];
  if (x - r < 0) offsets.push(width);
  if (x + r > width) offsets.push(-width);
  return offsets;
}

/** Кратчайшее расстояние по X с учётом шва (theta = 0 / 2π склеены). */
function wrapDX(dx, width) {
  const half = width / 2;
  if (dx > half) return dx - width;
  if (dx < -half) return dx + width;
  return dx;
}

/** Доля ещё непрозрачных (не сорванных) пикселей в окне вокруг точки. */
function opaqueFraction(imageData, cx, cy, radius) {
  const { data, width, height } = imageData;
  const step = Math.max(4, Math.floor(radius / 6));
  let total = 0;
  let opaque = 0;
  for (let dy = -radius; dy <= radius; dy += step) {
    const y = Math.round(cy + dy);
    if (y < 0 || y >= height) continue;
    for (let dx = -radius; dx <= radius; dx += step) {
      if (dx * dx + dy * dy > radius * radius) continue;
      let x = Math.round(cx + dx);
      x = ((x % width) + width) % width;
      total++;
      if (data[(y * width + x) * 4 + 3] > 20) opaque++;
    }
  }
  return total ? opaque / total : 0;
}

/** Ищет ближайшую (с учётом шва) точку, где фольга ещё осталась. */
function findNearestFoil(imageData, cx, cy) {
  const { data, width, height } = imageData;
  const step = 10;
  let best = null;
  let bestDist = Infinity;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] <= 20) continue;
      const dx = wrapDX(x - cx, width);
      const dy = y - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Цвет непрозрачного пикселя в точке (для отрыва обрывка нужного цвета), либо null. */
function sampleColor(imageData, x, y) {
  const { data, width, height } = imageData;
  let px = Math.round(x) % width;
  if (px < 0) px += width;
  const py = Math.min(height - 1, Math.max(0, Math.round(y)));
  const idx = (py * width + px) * 4;
  if (data[idx + 3] < 10) return null;
  return (data[idx] << 16) | (data[idx + 1] << 8) | data[idx + 2];
}

/**
 * Стирает альфу текстуры хаотичным, но округлым пятном в точке (u, v).
 * Если рядом с точкой клика фольги почти не осталось (на этой стороне яйца
 * её уже сорвали), стирание доворачивается к ближайшему месту, где она ещё
 * есть — вместо того чтобы впустую скрести пустоту. Любое цветное пятно
 * узора, которого коснулось стирание, отрывается целиком по своему
 * контуру, а не режется пополам случайным кругом.
 */
function eraseAt(ctx, canvas, patches, u, v, radius) {
  let cx = u * canvas.width;
  let cy = (1 - v) * canvas.height;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  if (opaqueFraction(imageData, cx, cy, radius) < 0.12) {
    const target = findNearestFoil(imageData, cx, cy);
    if (target) {
      cx = target.x;
      cy = target.y;
    }
  }

  const fallbackColor = sampleColor(imageData, cx, cy);

  ctx.globalCompositeOperation = 'destination-out';

  const blobCount = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < blobCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(0, radius * 0.55);
    const r = radius * rand(0.55, 1.0);
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;
    for (const dx of seamOffsets(bx, canvas.width, r)) {
      ctx.beginPath();
      ctx.arc(bx + dx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let patchColor = null;
  for (const patch of patches) {
    if (patch.torn) continue;
    const dx = wrapDX(patch.cx - cx, canvas.width);
    const dy = patch.cy - cy;
    if (Math.hypot(dx, dy) > radius + patch.r * 0.6) continue;
    for (const sdx of seamOffsets(patch.cx, canvas.width, patch.r)) {
      ctx.save();
      ctx.translate(sdx, 0);
      ctx.fill(patch.path);
      ctx.restore();
    }
    patch.torn = true;
    if (patchColor === null) patchColor = patch.color;
  }

  ctx.globalCompositeOperation = 'source-over';
  return patchColor ?? fallbackColor;
}

/** Маленький блестящий обрывок фольги, улетающий с места клика — для отдачи. */
function spawnScrap(worldPoint, debris, tornColor) {
  const size = rand(0.07, 0.13);
  const geometry = new THREE.SphereGeometry(size, 8, 6);
  geometry.scale(1, 0.3, 0.7);
  const color = tornColor ?? FOIL_COLORS[Math.floor(Math.random() * FOIL_COLORS.length)];
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
 * в цветной узор. Клик не отламывает кусок геометрии, а по-настоящему
 * «стирает» фольгу в месте попадания — хаотичным, но округлым пятном,
 * как будто её на самом деле сдирают/царапают. Сквозь стёртое пятно сразу
 * виден шоколад под ней.
 */
export function createFoil(clicksNeeded, debris, topology) {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const geometry = buildFullShellGeometry(topology, 1.05);
  const { canvas, ctx, texture, patches } = createFoilTexture();
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

  let clicksLeft = clicksNeeded;

  /** Стирает фольгу в точке (u, v) текстуры и отправляет обрывок в полёт. */
  function peelAt(uv, worldPoint) {
    if (clicksLeft <= 0) return false;
    const progress = 1 - clicksLeft / clicksNeeded;
    const radius = canvas.width * (0.14 + progress * 0.09); // ближе к концу пятна крупнее
    const tornColor = eraseAt(ctx, canvas, patches, uv.x, uv.y, radius);
    texture.needsUpdate = true;
    clicksLeft--;

    if (worldPoint) spawnScrap(worldPoint.clone(), debris, tornColor);
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
      return clicksLeft;
    },
    peelAt,
    finish,
    dispose,
  };
}
