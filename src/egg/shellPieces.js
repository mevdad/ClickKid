import * as THREE from 'three';
import { eggProfile } from './eggShape.js';
import { animate, tween, easeOutCubic, rand, randInt } from '../utils.js';

/**
 * Общая механика для слоёв, которые «отламываются» кусками — фольга и
 * шоколад устроены одинаково: цельная гладкая поверхность яйца случайно
 * делится на неровные кусочки (как будто их отламывали руками), и пока
 * ничего не тронуто, швов между ними не видно вообще.
 *
 * Секрет гладкости: сначала считаем нормали для ЦЕЛОЙ (неразрезанной)
 * поверхности через обычный индексированный меш — там соседние треугольники
 * делят вершины, и computeVertexNormals() честно усредняет их, давая
 * гладкое яйцо. Затем каждый кусочек забирает себе те же самые готовые
 * нормали для своих вершин, поэтому даже после разрезания на кусочки
 * поверхность светится гладко, без «граней» на стыках.
 */

/** Строит сетку вершин по поверхности яйца и сразу считает гладкие нормали. */
export function buildShellGrid({ steps, segments, scale = 1 }) {
  const profile = eggProfile(steps, scale);
  const rows = profile.length;
  const cols = segments;
  const colsPerRow = cols + 1;

  const position = [];
  const uv = [];
  for (let i = 0; i < rows; i++) {
    const { x: r, y } = profile[i];
    for (let j = 0; j <= cols; j++) {
      const theta = (j / cols) * Math.PI * 2;
      position.push(Math.sin(theta) * r, y, Math.cos(theta) * r);
      uv.push(j / cols, 1 - i / (rows - 1));
    }
  }

  const index = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * colsPerRow + j;
      const b = a + 1;
      const c = a + colsPerRow;
      const d = c + 1;
      index.push(a, d, c, a, b, d);
    }
  }

  // Считаем нормали на цельном индексированном меше — вот откуда берётся гладкость.
  const fullGeometry = new THREE.BufferGeometry();
  fullGeometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  fullGeometry.setIndex(index);
  fullGeometry.computeVertexNormals();
  const normalAttr = fullGeometry.getAttribute('normal');

  const positions = [];
  const uvs = [];
  const normals = [];
  for (let i = 0; i < rows; i++) {
    const rowPos = [];
    const rowUv = [];
    const rowNorm = [];
    for (let j = 0; j <= cols; j++) {
      const idx = i * colsPerRow + j;
      rowPos.push(new THREE.Vector3(position[idx * 3], position[idx * 3 + 1], position[idx * 3 + 2]));
      rowUv.push([uv[idx * 2], uv[idx * 2 + 1]]);
      rowNorm.push(new THREE.Vector3(normalAttr.getX(idx), normalAttr.getY(idx), normalAttr.getZ(idx)));
    }
    positions.push(rowPos);
    uvs.push(rowUv);
    normals.push(rowNorm);
  }

  fullGeometry.dispose();
  return { positions, uvs, normals, rows, cols };
}

// Соседи по диагонали тоже считаются — иначе очаги растут ровными
// ромбами со ступенчатым краем строго по сетке (видно как «пиксели»).
// С диагоналями фронт роста округлее, а край после второго прохода — рваный.
const NEIGHBOUR_OFFSETS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
];

function shuffleInPlace(arr) {
  for (let k = arr.length - 1; k > 0; k--) {
    const r = Math.floor(Math.random() * (k + 1));
    [arr[k], arr[r]] = [arr[r], arr[k]];
  }
}

/**
 * «Выращивает» pieceCount неровных кусочков по сетке граней случайными
 * очагами — получаются хаотичные пятна, а не аккуратные дольки, и вместе
 * они покрывают всю поверхность без единого пропуска.
 *
 * Работает в два прохода:
 * 1. Полное покрытие — очаги растут во все 8 соседних граней, пока не
 *    заполнят всю сетку (гарантированно без дыр).
 * 2. Рваный край — часть граничных граней случайно передаётся соседнему
 *    кусочку, чтобы стык перестал быть ровной линией по сетке и стал
 *    похож на то, что кусок оторвали руками, а не вырезали.
 */
export function growPieces(rows, cols, pieceCount) {
  const faceRows = rows - 1;
  const total = faceRows * cols;
  const regionOf = new Int32Array(total).fill(-1);
  let wave = [];

  for (let p = 0; p < pieceCount; p++) {
    let idx;
    let attempts = 0;
    do {
      idx = randInt(0, faceRows - 1) * cols + randInt(0, cols - 1);
      attempts++;
    } while (regionOf[idx] !== -1 && attempts < 200);
    regionOf[idx] = p;
    wave.push(idx);
  }

  const neighboursOf = (idx) => {
    const i = Math.floor(idx / cols);
    const j = idx % cols;
    const list = [];
    for (const [di, dj] of NEIGHBOUR_OFFSETS) {
      const ni = i + di;
      if (ni < 0 || ni >= faceRows) continue;
      list.push(ni * cols + ((j + dj + cols) % cols));
    }
    return list;
  };

  while (wave.length) {
    shuffleInPlace(wave); // иначе очаги расползаются ровными кружками
    const next = [];
    for (const idx of wave) {
      const region = regionOf[idx];
      for (const nIdx of neighboursOf(idx)) {
        if (regionOf[nIdx] === -1) {
          regionOf[nIdx] = region;
          next.push(nIdx);
        }
      }
    }
    wave = next;
  }

  // Рвём границы: грань, у которой большинство соседей — из чужого
  // кусочка, переходит к одному из них. Работает только с уже занятыми
  // гранями, поэтому дыр появиться не может. Несколько проходов подряд —
  // иначе при мелкой сетке правки едва заметны на фоне общей формы.
  for (let pass = 0; pass < 3; pass++) {
    for (let idx = 0; idx < total; idx++) {
      if (Math.random() > 0.5) continue;
      const foreign = neighboursOf(idx).filter((n) => regionOf[n] !== regionOf[idx]);
      if (foreign.length >= 3) {
        regionOf[idx] = regionOf[foreign[Math.floor(Math.random() * foreign.length)]];
      }
    }
  }

  return regionOf;
}

/**
 * Собирает геометрию одного кусочка, используя уже готовые гладкие нормали
 * сетки. Возвращает null, если очагу не досталось ни одной грани (в теории
 * возможно после эрозии границ) — тогда кусочек просто не создаётся.
 */
export function buildPieceGeometry(grid, pieceIndex, regionOf) {
  const { positions, uvs, normals, rows, cols } = grid;
  const facePositions = [];
  const faceNormals = [];
  const faceUvs = [];

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      if (regionOf[i * cols + j] !== pieceIndex) continue;

      const p00 = positions[i][j];
      const p01 = positions[i][j + 1];
      const p10 = positions[i + 1][j];
      const p11 = positions[i + 1][j + 1];
      const n00 = normals[i][j];
      const n01 = normals[i][j + 1];
      const n10 = normals[i + 1][j];
      const n11 = normals[i + 1][j + 1];
      const uv00 = uvs[i][j];
      const uv01 = uvs[i][j + 1];
      const uv10 = uvs[i + 1][j];
      const uv11 = uvs[i + 1][j + 1];

      facePositions.push(p00.x, p00.y, p00.z, p11.x, p11.y, p11.z, p10.x, p10.y, p10.z);
      faceNormals.push(n00.x, n00.y, n00.z, n11.x, n11.y, n11.z, n10.x, n10.y, n10.z);
      faceUvs.push(...uv00, ...uv11, ...uv10);

      facePositions.push(p00.x, p00.y, p00.z, p01.x, p01.y, p01.z, p11.x, p11.y, p11.z);
      faceNormals.push(n00.x, n00.y, n00.z, n01.x, n01.y, n01.z, n11.x, n11.y, n11.z);
      faceUvs.push(...uv00, ...uv01, ...uv11);
    }
  }

  if (!facePositions.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(facePositions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(faceNormals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(faceUvs, 2));
  geometry.computeBoundingBox();
  return geometry;
}

/** Средний угол кусочка вокруг оси Y — чтобы яйцо могло довернуться к нему. */
export function pieceMidAngle(geometry) {
  const centroid = new THREE.Vector3();
  geometry.boundingBox.getCenter(centroid);
  return Math.atan2(centroid.x, centroid.z);
}

/** Локальный центр кусочка (центр его bounding box) — для расчёта направления полёта. */
export function pieceLocalCentroid(geometry) {
  const centroid = new THREE.Vector3();
  geometry.boundingBox.getCenter(centroid);
  return centroid;
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
