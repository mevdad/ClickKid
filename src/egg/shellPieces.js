import * as THREE from 'three';
import { Delaunay } from 'd3-delaunay';
import { EGG } from './eggShape.js';
import { animate, tween, easeOutCubic, rand } from '../utils.js';

/**
 * Общая геометрия поверхности яйца для фольги и шоколада: оба слоя строят
 * один и тот же цельный меш (см. buildFullShellGeometry) по общей
 * триангуляции Делоне, каждый лишь со своим масштабом радиуса — а деление
 * на «куски», по которым идёт клик, каждый слой рисует сам поверх своей
 * текстуры (см. foil.js и chocolate.js), стирая в ней альфу.
 *
 * Поверхность параметризована двумя числами (theta, t): theta — угол
 * вокруг оси Y (0..2π), t — параметр профиля яйца (0 — макушка, π — низ,
 * та же переменная, что и в eggProfile). Позиция и нормаль в любой точке
 * (theta, t) считаются напрямую по формуле профиля, поэтому нормали
 * гарантированно гладкие по всей поверхности.
 */

/** Радиус и высота профиля яйца в произвольной точке t. */
function profileAt(t, scale) {
  const y = Math.cos(t) * EGG.halfHeight * scale;
  const r = Math.sin(t) * EGG.radius * scale * (1 - 0.25 * Math.cos(t));
  return { r, y };
}

/** 3D-точка на поверхности яйца для (theta, t). */
export function surfacePoint(theta, t, scale) {
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
 * Собирает ВСЮ топологию как один цельный меш (без деления на кусочки) —
 * для слоя-«обёртки», который не ломается на части, а стирается как
 * текстура (см. foil.js).
 */
export function buildFullShellGeometry(triangles, scale = 1) {
  const positions = [];
  const normals = [];
  const uvs = [];

  for (const tri of triangles) {
    for (const [theta, t] of tri) {
      const p = surfacePoint(theta, t, scale);
      const n = surfaceNormal(theta, t, scale);
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(theta / (Math.PI * 2), 1 - t / Math.PI);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
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
