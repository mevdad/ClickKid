import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { animate, rand } from '../utils.js';
import { buildFullShellGeometry, surfacePoint } from './shellPieces.js';

export const CHOCOLATE_PIECES = 14; // на столько округлых кусков делится скорлупа
const TEXTURE_W = 2048;
const TEXTURE_H = 1024; // theta: 0..2π (по ширине), t: 0..π (по высоте)

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
 * там соответствует ничтожному кусочку поверхности.
 */
function paramDistance(theta1, t1, theta2, t2) {
  let dTheta = Math.abs(theta1 - theta2) % (Math.PI * 2);
  if (dTheta > Math.PI) dTheta = Math.PI * 2 - dTheta;
  const dt = t1 - t2;
  return Math.hypot(dTheta * EGG.radius, dt * EGG.halfHeight);
}

/**
 * Трассирует границу куска лучами из его собственной точки-очага: под
 * angularSamples разными углами (в реальных единицах поверхности, чтобы
 * «циферблат» направлений не был искажён у полюсов) находит расстояние, на
 * котором эта точка перестаёт быть ближайшим очагом среди всех кусков —
 * то есть саму границу. Настоящая (без искажающего шума) диаграмма
 * Вороного звёздчата относительно своего очага — вдоль любого направления
 * есть РОВНО одна такая точка, гарантированно, а не только «почти всегда»:
 * добавленный шум когда-то давал ту же паразитную многозначность, что и
 * оторванные островки на растровой маске — вдоль части лучей граница
 * ненадолго «уходила и возвращалась», и трассировка обрезала контур по
 * первому пересечению, оставляя дальше нестёртую щель. Плавность контура
 * даёт не шум, а сглаживание по Чайкину ниже — оно превращает гранёный
 * многоугольник настоящей диаграммы Вороного в мягкую кривую само по себе.
 */
function traceBoundary(seedIndex, seeds, angularSamples) {
  const seed = seeds[seedIndex];
  const maxR = (EGG.radius + EGG.halfHeight) * 1.2; // с большим запасом
  const points = [];

  for (let k = 0; k < angularSamples; k++) {
    const dir = (k / angularSamples) * Math.PI * 2;
    const du = Math.cos(dir);
    const dv = Math.sin(dir);

    const insideAt = (r) => {
      const theta = seed.theta + (du * r) / EGG.radius;
      const t = Math.min(Math.PI - 1e-4, Math.max(1e-4, seed.t + (dv * r) / EGG.halfHeight));
      const own = paramDistance(theta, t, seed.theta, seed.t);
      for (let j = 0; j < seeds.length; j++) {
        if (j !== seedIndex && paramDistance(theta, t, seeds[j].theta, seeds[j].t) < own) return false;
      }
      return true;
    };

    const steps = 48;
    const step = maxR / steps;
    let lo = 0;
    let hi = step;
    while (hi < maxR && insideAt(hi)) {
      lo = hi;
      hi += step;
    }
    for (let iter = 0; iter < 10; iter++) {
      const mid = (lo + hi) / 2;
      if (insideAt(mid)) lo = mid;
      else hi = mid;
    }

    const r = (lo + hi) / 2;
    const theta = seed.theta + (du * r) / EGG.radius;
    const t = Math.min(Math.PI - 1e-4, Math.max(1e-4, seed.t + (dv * r) / EGG.halfHeight));
    points.push({ theta, t });
  }

  return points;
}

/**
 * Разворачивает последовательность углов theta в непрерывную (без скачков
 * через шов 0/2π) — иначе многоугольник, пересекающий шов, ломался бы на
 * сглаживании и заливке.
 */
function unwrapTheta(points) {
  const out = [points[0].theta];
  for (let i = 1; i < points.length; i++) {
    let theta = points[i].theta;
    const prev = out[i - 1];
    while (theta - prev > Math.PI) theta -= Math.PI * 2;
    while (theta - prev < -Math.PI) theta += Math.PI * 2;
    out.push(theta);
  }
  return out;
}

/**
 * Сглаживание Чайкина: срезает углы замкнутого многоугольника несколько
 * раз подряд, превращая гранёную ломаную (от конечного числа лучей) в
 * плавную кривую — независимо от разрешения текстуры, ровно как гладкие
 * дуги у фольги (см. buildFoilPatches в foil.js).
 */
function chaikinSmooth(points, iterations) {
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      next.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
      next.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
    }
    pts = next;
  }
  return pts;
}

/**
 * Заранее делит всю поверхность шоколада на ровно count округлых кусков —
 * у каждого свой гладкий контур (Path2D), построенный трассировкой лучей
 * из собственной точки-очага и сглаженный по Чайкину. У каждого куска
 * известны угол и высота на поверхности (для доворота яйца и порядка
 * «сверху вниз»).
 */
function buildBitePieces(width, height, count) {
  const seeds = [];
  for (let i = 0; i < count; i++) {
    const baseTheta = (i / count) * Math.PI * 2;
    const theta = baseTheta + rand(-0.35, 0.35);
    const t = rand(Math.PI * 0.1, Math.PI * 0.9);
    seeds.push({ theta, t });
  }

  const pieces = seeds.map((seed, i) => {
    const raw = traceBoundary(i, seeds, 72);
    const unwrapped = unwrapTheta(raw);

    let sumSin = 0;
    let sumCos = 0;
    let sumT = 0;
    const pixelPoints = raw.map((p, k) => {
      sumSin += Math.sin(p.theta);
      sumCos += Math.cos(p.theta);
      sumT += p.t;
      return { x: (unwrapped[k] / (Math.PI * 2)) * width, y: (p.t / Math.PI) * height };
    });

    // Сглаживание по Чайкину срезает углы и поэтому чуть уменьшает
    // многоугольник — у соседних кусков, сглаженных независимо друг от
    // друга, общая когда-то граница расходится на пару текселей, и между
    // ними остаётся тонкая нестёртая щель. Раздвигаем точки от центра
    // куска наружу на небольшой процент, чтобы соседние куски снова
    // перекрывались, а не просто соприкасались.
    const smooth = chaikinSmooth(pixelPoints, 2);
    const cx = smooth.reduce((sum, p) => sum + p.x, 0) / smooth.length;
    const cy = smooth.reduce((sum, p) => sum + p.y, 0) / smooth.length;
    const grow = 1.04;
    const path = new Path2D();
    smooth.forEach((p, k) => {
      const x = cx + (p.x - cx) * grow;
      const y = cy + (p.y - cy) * grow;
      if (k === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();

    const midAngle = (Math.atan2(sumSin, sumCos) + Math.PI * 2) % (Math.PI * 2);
    const t = sumT / raw.length;

    return {
      index: i,
      torn: false,
      midAngle,
      t,
      path,
      centroid: surfacePoint(midAngle, t, 1.0),
    };
  });

  return { pieces };
}

/** Стирает альфу ровно по контуру куска — как и фольга (см. tearPatch в
 *  foil.js). Заливает контур при трёх горизонтальных сдвигах, потому что
 *  контур, пересекающий шов theta=0/2π, хранится развёрнутым и может
 *  выходить за границы канвы — сдвиги гарантируют, что видимая часть
 *  всегда закрасится правильно, откуда бы контур ни начинался. */
function biteCanvas(ctx, canvas, piece) {
  piece.torn = true;
  ctx.globalCompositeOperation = 'destination-out';
  // fillStyle мог остаться от крапинок базовой текстуры — там альфа
  // специально низкая (0.03–0.07), и destination-out с таким fillStyle
  // стирает только эту крошечную долю альфы, а не всю: кусок выглядит
  // «полустёртым» пятном вместо настоящей дыры.
  ctx.fillStyle = '#000';
  for (const dx of [0, -canvas.width, canvas.width]) {
    ctx.save();
    ctx.translate(dx, 0);
    ctx.fill(piece.path);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Шоколадный слой: одна цельная гладкая скорлупа без единого шва, пока её
 * не трогали — заранее поделённая на 14 округлых кусков. Клик «откусывает»
 * намеченный кусок целиком, ровно по его гладкому контуру — не рваным
 * многоугольником и не пиксельной ступенькой, а плавной кривой, как будто
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
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const ctx = canvas.getContext('2d');
  paintChocolateBase(ctx, canvas);
  const { pieces } = buildBitePieces(canvas.width, canvas.height, CHOCOLATE_PIECES);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = buildFullShellGeometry(topology, 1.0);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    // Маска откушенных кусков всегда либо полностью цела, либо полностью
    // стёрта — не полупрозрачная. alphaTest вырезает такие пиксели
    // насквозь и оставляет материал полностью непрозрачным (без сортировки
    // прозрачности), поэтому шоколад не «спорит» за глубину с соседним
    // прозрачным слоем фольги.
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

  /** «Откусывает» кусок: стирает альфу текстуры ровно по его контуру одним движением. */
  function bite(piece) {
    if (!piece || piece.torn) return false;
    shake();
    biteCanvas(ctx, canvas, piece);
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
