import * as THREE from 'three';
import { Delaunay } from 'd3-delaunay';
import { EGG } from './eggShape.js';
import { animate, tween, easeOutCubic, rand } from '../utils.js';

/**
 * Общая механика для слоёв, которые «отламываются» кусками — фольга и
 * шоколад устроены одинаково: поверхность яйца триангулируется случайными
 * точками (Делоне), треугольники группируются в кусочки — края получаются
 * рваными случайными многоугольниками из треугольников, а не ровными
 * квадратами сетки.
 *
 * Поверхность параметризована двумя числами (theta, t): theta — угол
 * вокруг оси Y (0..2π), t — параметр профиля яйца (0 — макушка, π — низ,
 * та же переменная, что и в eggProfile). Позиция и нормаль в любой точке
 * (theta, t) считаются напрямую по формуле профиля, поэтому нормали
 * гарантированно гладкие и совпадают у соседних кусочков на общей границе.
 */

/** Радиус и высота профиля яйца в произвольной точке t. */
function profileAt(t, scale) {
  const y = Math.cos(t) * EGG.halfHeight * scale;
  const r = Math.sin(t) * EGG.radius * scale * (1 - 0.25 * Math.cos(t));
  return { r, y };
}

/** 3D-точка на поверхности яйца для (theta, t). */
function surfacePoint(theta, t, scale) {
  const { r, y } = profileAt(t, scale);
  return new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);
}

/** Гладкая аналитическая нормаль поверхности в (theta, t) — не зависит ни от какой сетки. */
function surfaceNormal(theta, t, scale) {
  const eps = 1e-3;
  const a = profileAt(Math.max(1e-4, t - eps), scale);
  const b = profileAt(Math.min(Math.PI - 1e-4, t + eps), scale);
  const dr = b.r - a.r;
  const dy = b.y - a.y;
  let nr = dy;
  let ny = -dr;
  const len = Math.hypot(nr, ny) || 1;
  nr /= len;
  ny /= len;
  return new THREE.Vector3(Math.sin(theta) * nr, ny, Math.cos(theta) * nr);
}

/** Ключ точки (theta, t), одинаковый для «одной и той же» точки из разных периодических копий. */
function pointKey(theta, t) {
  const norm = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return `${norm.toFixed(4)}|${t.toFixed(4)}`;
}

/**
 * Триангулирует поверхность яйца случайными точками (Делоне). Сама
 * триангуляция считается трижды по кругу (копии со сдвигом ±2π), чтобы
 * шов на theta=0/2π не резал треугольники неправильно — так на стыке
 * у каждой точки есть настоящие соседи по обе стороны.
 *
 * Каждый треугольник из общего (тройного) набора целиком сдвигается на
 * то же число (кратное 2π), чтобы его центр попал в канонический
 * диапазон [0, 2π), а затем дублирующиеся треугольники (одна и та же
 * реальная тройка точек, полученная из разных копий) отбрасываются.
 * Это даёт ровно одну копию КАЖДОГО треугольника — без пропусков
 * (в отличие от простого отбора «оставить только то, что и так попало
 * в диапазон», которое часть треугольников у шва теряло совсем).
 */
function triangulateShell(pointCount) {
  const points = [];
  for (let i = 0; i < pointCount; i++) {
    points.push([rand(0, Math.PI * 2), rand(0.05, Math.PI - 0.05)]);
  }
  // Несколько точек у самых полюсов — иначе Делоне оставит верхушку и
  // донышко почти без треугольников.
  for (let k = 0; k < 6; k++) points.push([(k / 6) * Math.PI * 2, 0.015]);
  for (let k = 0; k < 6; k++) points.push([(k / 6) * Math.PI * 2, Math.PI - 0.015]);

  const extended = [];
  for (let copy = -1; copy <= 1; copy++) {
    for (const [theta, t] of points) extended.push([theta + copy * Math.PI * 2, t]);
  }

  const delaunay = Delaunay.from(extended);
  const { triangles } = delaunay;

  const twoPi = Math.PI * 2;
  const seen = new Set();
  const kept = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const raw = [extended[triangles[i]], extended[triangles[i + 1]], extended[triangles[i + 2]]];

    const identity = raw.map(([theta, t]) => pointKey(theta, t)).sort().join('/');
    if (seen.has(identity)) continue;
    seen.add(identity);

    const centroidTheta = (raw[0][0] + raw[1][0] + raw[2][0]) / 3;
    const shift = Math.floor(centroidTheta / twoPi) * twoPi;
    kept.push(raw.map(([theta, t]) => [theta - shift, t]));
  }

  return kept; // массив треугольников, каждый — [[theta,t], [theta,t], [theta,t]]
}

/** Расстояние между двумя точками (theta, t) в реальных единицах, с учётом обёртки по кругу. */
function paramDistance(a, b) {
  let dTheta = Math.abs(a[0] - b[0]) % (Math.PI * 2);
  if (dTheta > Math.PI) dTheta = Math.PI * 2 - dTheta;
  const dt = a[1] - b[1];
  return Math.hypot(dTheta * EGG.radius, dt * EGG.halfHeight);
}

/**
 * Группирует треугольники в pieceCount кусочков по принципу «ближайший
 * случайный очаг» (обычная диаграмма Вороного по центрам треугольников).
 * В отличие от случайного роста по соседям (BFS), где порядок обработки
 * решает форму и легко получаются тонкие вытянутые «щупальца», здесь
 * каждый треугольник просто достаётся тому очагу, что реально ближе —
 * кусочки выходят компактными и округлыми, как отломанные руками.
 */
function groupTriangles(triangles, pieceCount) {
  const total = triangles.length;
  const centroids = triangles.map(([a, b, c]) => [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
  ]);

  const order = [...Array(total).keys()];
  for (let k = order.length - 1; k > 0; k--) {
    const r = Math.floor(Math.random() * (k + 1));
    [order[k], order[r]] = [order[r], order[k]];
  }
  const seeds = order.slice(0, Math.min(pieceCount, total)).map((i) => centroids[i]);

  const groupOf = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    let best = 0;
    let bestDist = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const dist = paramDistance(centroids[i], seeds[s]);
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    groupOf[i] = best;
  }
  return groupOf;
}

/** Собирает геометрию одного кусочка из его треугольников. */
function buildPieceGeometry(triangles, groupOf, pieceIndex, scale) {
  const positions = [];
  const normals = [];
  const uvs = [];
  let sumX = 0, sumY = 0, sumZ = 0, count = 0;
  let sumSin = 0, sumCos = 0;

  triangles.forEach((tri, i) => {
    if (groupOf[i] !== pieceIndex) return;
    for (const [theta, t] of tri) {
      const p = surfacePoint(theta, t, scale);
      const n = surfaceNormal(theta, t, scale);
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(theta / (Math.PI * 2), 1 - t / Math.PI);
      sumX += p.x; sumY += p.y; sumZ += p.z; count++;
      sumSin += Math.sin(theta); sumCos += Math.cos(theta);
    }
  });

  if (!count) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  return {
    geometry,
    centroid: new THREE.Vector3(sumX / count, sumY / count, sumZ / count),
    midAngle: Math.atan2(sumSin, sumCos),
  };
}

/**
 * Считает случайную триангуляцию поверхности яйца один раз — общую для
 * фольги и шоколада. Это важно: если бы каждый слой триангулировал
 * поверхность заново своими случайными точками, две грубые многогранные
 * аппроксимации одной и той же гладкой формы почти никогда не совпадали
 * бы идеально, и там, где хорда одного слоя случайно прогибалась чуть
 * наружу, а другого — чуть внутрь, слои могли пересекаться (шоколад
 * «вылезал» бы сквозь фольгу). Общая сетка вершин решает это: каждый слой
 * лишь умножает радиус в тех же самых точках на свой scale, поэтому
 * фольга гарантированно везде строго снаружи шоколада.
 */
export function createShellTopology(pointCount = 900) {
  return triangulateShell(pointCount);
}

/**
 * Строит pieceCount кусочков-многоугольников (из треугольников общей
 * топологии) для одного слоя со своим масштабом.
 */
export function buildShellPieces(triangles, { pieceCount, scale = 1 }) {
  const groupOf = groupTriangles(triangles, pieceCount);

  const pieces = [];
  for (let p = 0; p < pieceCount; p++) {
    const built = buildPieceGeometry(triangles, groupOf, p, scale);
    if (built) pieces.push(built);
  }
  return pieces;
}

/**
 * Отправляет кусочек в самостоятельный полёт: сначала переносит его в debris
 * (статичная группа в мировых координатах, вне вращающейся группы яйца) —
 * так поворот яйца к следующей цели не «утаскивает» уже отломанный кусочек
 * за собой, и сам момент откола хорошо виден, пока он летит и падает.
 * Направление «наружу» считается по текущему мировому положению кусочка,
 * пока он ещё в исходной группе (учитывает уже накопленный поворот яйца).
 */
export function flyAway(mesh, { group, debris, onDone } = {}) {
  const worldCentroid = group.localToWorld(mesh.userData.centroid.clone());
  const worldOrigin = group.localToWorld(new THREE.Vector3(0, 0, 0));
  const dir = worldCentroid.sub(worldOrigin);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) {
    const angle = rand(0, Math.PI * 2);
    dir.set(Math.sin(angle), 0, Math.cos(angle));
  } else {
    dir.normalize();
  }

  debris.attach(mesh); // мировая позиция сохраняется, но вращение яйца больше не влияет

  // Прозрачность включаем только на время полёта (для угасания) — пока
  // кусочек цел и стоит на яйце, непрозрачный материал рисуется надёжнее.
  mesh.material.transparent = true;
  mesh.material.needsUpdate = true;

  const start = mesh.position.clone();
  const spin = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
  const velocity = dir.clone().multiplyScalar(rand(1.7, 2.8));
  velocity.y = rand(1.8, 3.2);

  // Сначала кусочек чуть отваливается наружу, потом падает с вращением.
  tween(0.12, (t) => {
    mesh.position.copy(start).addScaledVector(dir, t * 0.16);
  }, () => {
    let life = 0;
    const total = 1.05;
    animate((dt) => {
      life += dt;
      velocity.y -= 11 * dt;
      mesh.position.addScaledVector(velocity, dt);
      mesh.rotation.x += spin.x * dt;
      mesh.rotation.y += spin.y * dt;
      mesh.rotation.z += spin.z * dt;
      mesh.material.opacity = Math.max(0, 1 - easeOutCubic(life / total));
      if (life >= total) {
        debris.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        onDone?.();
        return false;
      }
      return true;
    });
  });
}
