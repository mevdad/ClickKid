import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { animate, rand } from '../utils.js';
import { buildFullShellGeometry, surfacePoint } from './shellPieces.js';

export const CHOCOLATE_PIECES = 14; // на столько округлых кусков делится скорлупа
const TEXTURE_SIZE = 512;

/** Тёплый коричневый фон с лёгкими крапинками — база текстуры шоколада. */
function paintChocolateBase(ctx, canvas) {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#5a2f18');
  gradient.addColorStop(0.5, '#7a4020');
  gradient.addColorStop(1, '#40200f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,225,190' : '30,15,8'},${Math.random() * 0.07})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 3, 3);
  }
}

/**
 * Расстояние между двумя точками (theta, t) в РЕАЛЬНЫХ единицах
 * поверхности яйца (с учётом кругового шва по theta) — то же самое, что
 * связывает соседние кусочки в общей 3D-топологии (см. shellPieces.js).
 * Считать так, а не по «сырым» пикселям текстуры, критично: у полюсов
 * окружность яйца физически стремится к нулю, и то же расстояние по theta
 * там соответствует ничтожному кусочку поверхности — если делить текстуру
 * по сырым пиксельным координатам, кусок возле полюса возле полюса выходит
 * растянутым в громадную и при этом почти невидимую полоску.
 */
function paramDistance(theta1, t1, theta2, t2) {
  let dTheta = Math.abs(theta1 - theta2) % (Math.PI * 2);
  if (dTheta > Math.PI) dTheta = Math.PI * 2 - dTheta;
  const dt = t1 - t2;
  return Math.hypot(dTheta * EGG.radius, dt * EGG.halfHeight);
}

/**
 * Небольшая гладкая добавка к расстоянию (не к координатам!) — превращает
 * прямые границы диаграммы Вороного в мягкие рваные линии естественного
 * скола. Добавка в тех же реальных единицах, что и paramDistance, поэтому
 * у полюсов, где кусок физически мал, она не «распухает» непропорционально.
 */
function bumpyDistance(theta, t, seed) {
  const base = paramDistance(theta, t, seed.theta, seed.t);
  const noise =
    Math.sin(theta * 9 + t * 7 + seed.theta * 3.3) * 0.05 +
    Math.sin(theta * 4.3 - t * 11 + seed.theta * 5.1 + 1.3) * 0.03;
  return base + noise;
}

/**
 * Заранее делит всю поверхность шоколада на ровно pieceCount округлых
 * кусков — настоящая диаграмма Вороного по РЕАЛЬНОМУ расстоянию на
 * поверхности яйца (без единого зазора), с мягкими рваными границами
 * вместо прямых линий и без искажений у полюсов. У каждого куска известны
 * угол и высота на поверхности (для доворота яйца и порядка «сверху
 * вниз»), а также список пикселей текстуры, которые ему принадлежат — по
 * нему кусок потом стирается разом, целиком по своей границе.
 */
function buildBitePieces(canvas, count) {
  const { width, height } = canvas;
  const seeds = [];
  for (let i = 0; i < count; i++) {
    const baseTheta = (i / count) * Math.PI * 2;
    const theta = baseTheta + rand(-0.35, 0.35);
    const t = rand(Math.PI * 0.1, Math.PI * 0.9);
    seeds.push({ theta, t });
  }

  const regionMap = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const t = (y / height) * Math.PI;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const theta = (x / width) * Math.PI * 2;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const dist = bumpyDistance(theta, t, seeds[i]);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      regionMap[row + x] = best;
    }
  }

  const pixelsByRegion = seeds.map(() => []);
  for (let i = 0; i < regionMap.length; i++) pixelsByRegion[regionMap[i]].push(i);

  const sums = seeds.map(() => ({ sin: 0, cos: 0, t: 0, n: 0 }));
  for (let y = 0; y < height; y++) {
    const t = (y / height) * Math.PI;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const theta = (x / width) * Math.PI * 2;
      const s = sums[regionMap[row + x]];
      s.sin += Math.sin(theta);
      s.cos += Math.cos(theta);
      s.t += t;
      s.n += 1;
    }
  }

  const pieces = seeds.map((seed, i) => {
    const s = sums[i];
    const midAngle = s.n ? (Math.atan2(s.sin, s.cos) + Math.PI * 2) % (Math.PI * 2) : seed.theta;
    const t = s.n ? s.t / s.n : seed.t;
    return {
      index: i,
      torn: false,
      midAngle,
      t,
      pixels: pixelsByRegion[i],
      centroid: surfacePoint(midAngle, t, 1.0),
    };
  });

  return { pieces };
}

/**
 * Шоколадный слой: одна цельная гладкая скорлупа без единого шва, пока её
 * не трогали — заранее поделённая на 14 округлых кусков. Клик «откусывает»
 * намеченный кусок целиком, ровно по его заранее размеченной округлой
 * границе — не рваным многоугольником, а мягким овальным пятном, как будто
 * его действительно откусили. Сквозь съеденный кусок сразу виден жёлтый
 * контейнер внутри.
 *
 * topology — та же общая триангуляция, что и у фольги (см. foil.js) —
 * гарантирует, что шоколад (scale 1.0) нигде не вылезает за фольгу
 * (scale 1.05): оба слоя строят цельный меш по одним и тем же точкам
 * поверхности, просто с разным масштабом радиуса.
 */
export function createChocolate(topology) {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  paintChocolateBase(ctx, canvas);
  const { pieces } = buildBitePieces(canvas, CHOCOLATE_PIECES);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = buildFullShellGeometry(topology, 1.0);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    // Маска откушенных кусков всегда либо полностью цела (альфа 255), либо
    // полностью стёрта (альфа 0) — не полупрозрачная. alphaTest вырезает
    // такие пиксели насквозь и оставляет материал полностью непрозрачным
    // (без сортировки прозрачности), поэтому шоколад больше не «спорит»
    // за глубину с соседним прозрачным слоем фольги.
    alphaTest: 0.5,
    roughness: 0.6,
    metalness: 0,
    envMapIntensity: 0.35,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.layer = 'chocolate';
  group.add(mesh);

  /** Короткий рывок всей скорлупы — тактильная отдача на удар. */
  function shake() {
    const strength = 0.05;
    let t = 0;
    animate((dt) => {
      t += dt;
      const decay = Math.max(0, 1 - t / 0.3);
      group.position.x = Math.sin(t * 55) * strength * decay;
      group.rotation.z = Math.sin(t * 46) * 0.04 * decay;
      if (t >= 0.3) {
        group.position.x = 0;
        group.rotation.z = 0;
        return false;
      }
      return true;
    });
  }

  /**
   * «Откусывает» кусок: стирает альфу текстуры ровно по его заранее
   * размеченной округлой границе, одним движением — как и фольга (см.
   * tearPatch в foil.js), а не покадровой анимацией: два укуса подряд
   * (клики чаще, чем успевает отрисоваться кадр в тяжёлом окружении)
   * иначе могут гоняться за одним и тем же снимком canvas и часть уже
   * стёртых пикселей друг у друга отменять.
   */
  function bite(piece) {
    if (!piece || piece.torn) return false;
    piece.torn = true;
    shake();

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (const idx of piece.pixels) {
      image.data[idx * 4 + 3] = 0;
    }
    ctx.putImageData(image, 0, 0);
    texture.needsUpdate = true;
    return true;
  }

  function peel(target) {
    return bite(target?.patch);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    group.clear();
  }

  return {
    group,
    get remaining() {
      return pieces.filter((p) => !p.torn).length;
    },
    /** Ещё целые куски как псевдо-меши — та же форма (.userData.centroid/.midAngle),
     *  что и раньше ожидал game.js, чтобы не трогать его логику доворота. */
    get meshes() {
      return pieces
        .filter((p) => !p.torn)
        .map((p) => ({ userData: { centroid: p.centroid, midAngle: p.midAngle }, patch: p }));
    },
    peel,
    dispose,
  };
}
