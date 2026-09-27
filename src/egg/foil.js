import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { buildFullShellGeometry, surfacePoint } from './shellPieces.js';
import { animate, rand } from '../utils.js';

// Насыщенные, «кислотные» цвета — каждый участок сразу бросается в глаза,
// никакого пастельного фона под ними не остаётся.
const FOIL_COLORS = [0xff1744, 0xffd600, 0x00e5ff, 0x00e676, 0xff2d95, 0xff9100, 0xaa00ff, 0x2979ff];
const TEXTURE_W = 1024;
const TEXTURE_H = 512; // theta: 0..2π (по ширине), t: 0..π (по высоте)

/**
 * Органическое смещение координат перед поиском ближайшего очага —
 * превращает прямые границы диаграммы Вороного в хаотичные, рваные линии,
 * будто фольгу разрывали руками, а не резали по линейке.
 */
function warp(x, y) {
  const n =
    Math.sin(x * 0.012 + y * 0.021) * 34 +
    Math.sin(x * 0.007 - y * 0.016 + 3.1) * 26 +
    Math.sin(x * 0.023 + y * 0.005 - 1.7) * 14;
  const m =
    Math.cos(y * 0.014 - x * 0.018) * 34 +
    Math.cos(y * 0.009 + x * 0.012 + 2.4) * 22;
  return [x + n, y + m];
}

/**
 * Каждый участок должен быть ОДНОЙ связной областью. Из-за «рваного»
 * смещения координат граница диаграммы Вороного иногда оставляет участку
 * не только основное тело, но и отдельные островки в стороне — тогда при
 * отрывании такой клочок исчезал бы сам по себе, без связи с остальной
 * фольгой, чего с настоящей фольгой не бывает. Для каждого участка
 * оставляем самую крупную связную область (с учётом кругового шва по
 * горизонтали), а все остальные клочки отдаём тем соседям, что их
 * окружают, — многоисточниковым обходом в ширину.
 */
function removeIslands(regionMap, count) {
  const total = TEXTURE_W * TEXTURE_H;
  const compId = new Int32Array(total).fill(-1);
  const compLabel = [];
  const compSize = [];
  const stack = [];

  const neighbours = (idx, out) => {
    const x = idx % TEXTURE_W;
    const y = (idx / TEXTURE_W) | 0;
    out[0] = y * TEXTURE_W + ((x - 1 + TEXTURE_W) % TEXTURE_W);
    out[1] = y * TEXTURE_W + ((x + 1) % TEXTURE_W);
    out[2] = y > 0 ? idx - TEXTURE_W : -1;
    out[3] = y < TEXTURE_H - 1 ? idx + TEXTURE_W : -1;
  };
  const near = [0, 0, 0, 0];

  for (let start = 0; start < total; start++) {
    if (compId[start] !== -1) continue;
    const label = regionMap[start];
    const cid = compLabel.length;
    compLabel.push(label);
    let size = 0;
    stack.length = 0;
    stack.push(start);
    compId[start] = cid;
    while (stack.length) {
      const idx = stack.pop();
      size++;
      neighbours(idx, near);
      for (let k = 0; k < 4; k++) {
        const n = near[k];
        if (n >= 0 && compId[n] === -1 && regionMap[n] === label) {
          compId[n] = cid;
          stack.push(n);
        }
      }
    }
    compSize.push(size);
  }

  const bestComp = new Array(count).fill(-1);
  const bestSize = new Array(count).fill(-1);
  for (let c = 0; c < compLabel.length; c++) {
    const label = compLabel[c];
    if (compSize[c] > bestSize[label]) {
      bestSize[label] = compSize[c];
      bestComp[label] = c;
    }
  }

  const queue = [];
  const orphan = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (compId[i] !== bestComp[regionMap[i]]) orphan[i] = 1;
    else queue.push(i);
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const label = regionMap[idx];
    neighbours(idx, near);
    for (let k = 0; k < 4; k++) {
      const n = near[k];
      if (n >= 0 && orphan[n]) {
        regionMap[n] = label;
        orphan[n] = 0;
        queue.push(n);
      }
    }
  }
}

/**
 * Заранее делит ВСЮ поверхность текстуры на ровно clicksNeeded ярких
 * участков — настоящая диаграмма Вороного, без единого не закрашенного
 * зазора, только с «рваными» органическими границами вместо прямых линий.
 * Каждый пиксель текстуры принадлежит ровно одному участку — это же
 * распределение используется и при отрывании, поэтому фольга снимается
 * ровно по границе своего участка, ни пикселем меньше и не больше.
 */
function buildFoilRegions(count) {
  const seeds = [];
  for (let i = 0; i < count; i++) {
    const baseTheta = (i / count) * Math.PI * 2;
    const theta = baseTheta + rand(-0.35, 0.35);
    const cx = (((theta / (Math.PI * 2)) * TEXTURE_W) % TEXTURE_W + TEXTURE_W) % TEXTURE_W;
    const cy = rand(TEXTURE_H * 0.12, TEXTURE_H * 0.88);
    seeds.push({ cx, cy, color: FOIL_COLORS[i % FOIL_COLORS.length] });
  }

  const regionMap = new Uint8Array(TEXTURE_W * TEXTURE_H);
  for (let y = 0; y < TEXTURE_H; y++) {
    const row = y * TEXTURE_W;
    for (let x = 0; x < TEXTURE_W; x++) {
      const [wx, wy] = warp(x, y);
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const seed = seeds[i];
        let dx = Math.abs(wx - seed.cx);
        if (dx > TEXTURE_W / 2) dx = TEXTURE_W - dx; // круговой шов по горизонтали
        const dy = wy - seed.cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      regionMap[row + x] = best;
    }
  }

  removeIslands(regionMap, seeds.length);

  // Средний угол и высота каждого участка (по накопленным координатам его
  // пикселей, угол усредняется через синус/косинус, чтобы шов 0/2π не портил
  // среднее), полный список его пикселей, их bbox и кромка, граничащая с
  // соседними участками, — нужны дальше для плавной анимации срывания.
  const sums = seeds.map(() => ({ sin: 0, cos: 0, t: 0, n: 0 }));
  const pixelLists = seeds.map(() => []);
  const edgeLists = seeds.map(() => []);
  const boxes = seeds.map(() => ({ minX: TEXTURE_W, maxX: 0, minY: TEXTURE_H, maxY: 0 }));
  for (let y = 0; y < TEXTURE_H; y++) {
    const t = (y / TEXTURE_H) * Math.PI;
    const row = y * TEXTURE_W;
    for (let x = 0; x < TEXTURE_W; x++) {
      const idx = row + x;
      const patchIndex = regionMap[idx];
      const theta = (x / TEXTURE_W) * Math.PI * 2;
      const s = sums[patchIndex];
      s.sin += Math.sin(theta);
      s.cos += Math.cos(theta);
      s.t += t;
      s.n += 1;

      pixelLists[patchIndex].push(idx);
      const box = boxes[patchIndex];
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;

      const right = regionMap[row + ((x + 1) % TEXTURE_W)];
      const down = y + 1 < TEXTURE_H ? regionMap[idx + TEXTURE_W] : patchIndex;
      if (right !== patchIndex || down !== patchIndex) edgeLists[patchIndex].push(idx);
    }
  }

  const patches = seeds.map((seed, i) => {
    const s = sums[i];
    const midAngle = (Math.atan2(s.sin, s.cos) + Math.PI * 2) % (Math.PI * 2);
    const box = boxes[i];
    // Участок у шва 0/2π «разрезается» пополам в координатах текстуры —
    // тогда берём срез на всю ширину, иначе настоящий bbox участка.
    const wraps = box.maxX - box.minX > TEXTURE_W * 0.6;
    return {
      index: i,
      color: seed.color,
      torn: false,
      midAngle,
      t: s.n > 0 ? s.t / s.n : Math.PI / 2,
      pixels: Int32Array.from(pixelLists[i]),
      edge: Int32Array.from(edgeLists[i].length ? edgeLists[i] : pixelLists[i]),
      bbox: wraps
        ? { x: 0, y: box.minY, w: TEXTURE_W, h: box.maxY - box.minY + 1 }
        : { x: box.minX, y: box.minY, w: box.maxX - box.minX + 1, h: box.maxY - box.minY + 1 },
    };
  });

  return { regionMap, patches };
}

/** Заливает текстуру целиком — каждый пиксель цветом своего участка, фона не остаётся. */
function paintFoilPattern(ctx, regionMap, patches) {
  const image = ctx.createImageData(TEXTURE_W, TEXTURE_H);
  const bytes = patches.map((p) => [(p.color >> 16) & 0xff, (p.color >> 8) & 0xff, p.color & 0xff]);
  for (let i = 0; i < regionMap.length; i++) {
    const [r, g, b] = bytes[regionMap[i]];
    const o = i * 4;
    image.data[o] = r;
    image.data[o + 1] = g;
    image.data[o + 2] = b;
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Готовит поле расстояний для анимации срывания участка: старт — случайная
 * точка на его кромке (там, где реально цепляют ноготь), а расстояние до
 * каждого пикселя участка считается в тех же «рваных» warp-координатах,
 * что и сами границы Вороного, — поэтому кромка отрыва бежит не идеальным
 * кругом, а неровной, слегка хаотичной волной, как при настоящем сдирании.
 * Считается один раз на участок и кэшируется в самом объекте участка.
 */
function preparePeel(patch) {
  if (patch.peel) return patch.peel;
  const pixels = patch.pixels;
  const n = pixels.length;
  const edge = patch.edge.length ? patch.edge : pixels;
  const originIdx = edge[Math.floor(rand(0, edge.length))];
  const ox = originIdx % TEXTURE_W;
  const oy = (originIdx / TEXTURE_W) | 0;
  const [owx, owy] = warp(ox, oy);

  const dist = new Float32Array(n);
  let maxDist = 0;
  for (let i = 0; i < n; i++) {
    const idx = pixels[i];
    const x = idx % TEXTURE_W;
    const y = (idx / TEXTURE_W) | 0;
    const [wx, wy] = warp(x, y);
    let dx = Math.abs(wx - owx);
    if (dx > TEXTURE_W / 2) dx = TEXTURE_W - dx;
    const dy = wy - owy;
    const d = Math.sqrt(dx * dx + dy * dy);
    dist[i] = d;
    if (d > maxDist) maxDist = d;
  }
  patch.peel = { dist, maxDist: Math.max(maxDist, 1) };
  return patch.peel;
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
 * Слой фольги: одна цельная гладкая оболочка (без единого треугольного шва
 * в силуэте — форма ровно повторяет поверхность яйца), заранее целиком
 * поделённая на clicksNeeded ярких цветных участков — настоящей диаграммой
 * Вороного без единого не закрашенного зазора, с рваными органическими
 * границами. Каждый клик срывает ровно один ещё целый участок целиком, точно
 * по его границе — хаотичным, но округлым пятном, как будто фольгу реально
 * сдирают. Сквозь сорванный участок сразу виден шоколад под ним.
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { regionMap, patches } = buildFoilRegions(clicksNeeded);
  paintFoilPattern(ctx, regionMap, patches);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.55,
    transparent: true,
    metalness: 0.22,
    roughness: 0.45,
    envMapIntensity: 0.55,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.layer = 'foil';
  group.add(mesh);

  let remainingCount = clicksNeeded;
  const TEAR_DURATION = 0.4;

  /**
   * Плавно срывает участок целиком: неровная кромка отрыва пробегает от
   * точки на краю участка до его дальней границы, с мягкой (не бинарной)
   * растушёванной каёмкой — визуально фольга реально отдирается, а не
   * пропадает одним кадром. Обрывок улетает, когда кромка добегает до конца.
   */
  function peelPatch(patch) {
    if (!patch || patch.torn) return false;
    patch.torn = true;
    remainingCount--;

    const { dist, maxDist } = preparePeel(patch);
    const pixels = patch.pixels;
    const feather = Math.min(maxDist, Math.max(20, maxDist * 0.16));
    const { x: bx, y: by, w: bw, h: bh } = patch.bbox;

    let progress = 0;
    animate((dt) => {
      progress = Math.min(1, progress + dt / TEAR_DURATION);
      const eased = progress * progress * (3 - 2 * progress); // smoothstep
      const front = eased * (maxDist + feather);

      const image = ctx.getImageData(bx, by, bw, bh);
      for (let i = 0; i < pixels.length; i++) {
        const idx = pixels[i];
        const px = (idx % TEXTURE_W) - bx;
        const py = ((idx / TEXTURE_W) | 0) - by;
        const localIdx = (py * bw + px) * 4 + 3;
        const d = dist[i];
        let a;
        if (d <= front - feather) a = 0;
        else if (d >= front) a = 255;
        else a = ((d - (front - feather)) / feather) * 255;
        image.data[localIdx] = a;
      }
      ctx.putImageData(image, bx, by);
      texture.needsUpdate = true;

      if (progress >= 1) {
        const localPoint = surfacePoint(patch.midAngle, patch.t, scale);
        spawnScrap(group.localToWorld(localPoint), debris, patch.color);
        return false;
      }
      return true;
    });

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
