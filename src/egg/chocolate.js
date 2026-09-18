import * as THREE from 'three';
import { EGG, eggProfile } from './eggShape.js';
import { animate, tween, easeOutCubic, rand, randInt } from '../utils.js';

const PROFILE_STEPS = 30; // строк по высоте
const ANGULAR_SEGMENTS = 28; // столбцов по кругу
export const CHOCOLATE_PIECES = 14; // на столько неровных кусков делится скорлупа

/** Текстура шоколада: тёплый коричневый с лёгкими крапинками. */
function createChocolateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

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

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Строит сетку вершин по поверхности яйца: rows строк (по высоте) на
 * cols+1 столбцов (по кругу, с дублированным швом для развёртки текстуры).
 * Из одной такой сетки режутся все кусочки — поэтому у них общие вершины
 * на границах и стыков между целыми кусочками не видно вообще.
 */
function buildGrid() {
  const profile = eggProfile(PROFILE_STEPS, 1.0);
  const rows = profile.length;
  const cols = ANGULAR_SEGMENTS;
  const positions = [];
  const uvs = [];

  for (let i = 0; i < rows; i++) {
    const { x: r, y } = profile[i];
    const rowPositions = [];
    const rowUvs = [];
    for (let j = 0; j <= cols; j++) {
      const theta = (j / cols) * Math.PI * 2;
      rowPositions.push(new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r));
      rowUvs.push([j / cols, 1 - i / (rows - 1)]);
    }
    positions.push(rowPositions);
    uvs.push(rowUvs);
  }

  return { positions, uvs, rows, cols };
}

/**
 * «Выращивает» N кусочков по сетке граней случайными очагами — получаются
 * неровные пятна, будто скорлупу кто-то раскрошил зубами, а не аккуратно
 * порезал на дольки. Вместе кусочки покрывают всю поверхность без дыр.
 */
function assignPieces(rows, cols, pieceCount) {
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

  while (wave.length) {
    // Перемешиваем порядок роста — иначе очаги расползаются ровными
    // кружками, а не хаотичными пятнами.
    for (let k = wave.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1));
      [wave[k], wave[r]] = [wave[r], wave[k]];
    }

    const next = [];
    for (const idx of wave) {
      const i = Math.floor(idx / cols);
      const j = idx % cols;
      const region = regionOf[idx];
      const neighbours = [
        [i - 1, j],
        [i + 1, j],
        [i, (j - 1 + cols) % cols],
        [i, (j + 1) % cols],
      ];
      for (const [ni, nj] of neighbours) {
        if (ni < 0 || ni >= faceRows) continue;
        const nIdx = ni * cols + nj;
        if (regionOf[nIdx] === -1) {
          regionOf[nIdx] = region;
          next.push(nIdx);
        }
      }
    }
    wave = next;
  }

  return regionOf;
}

/** Собирает геометрию одного кусочка из граней сетки, отданных ему при выращивании. */
function buildPieceGeometry(grid, pieceIndex, regionOf) {
  const { positions, uvs, rows, cols } = grid;
  const facePositions = [];
  const faceUvs = [];

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      if (regionOf[i * cols + j] !== pieceIndex) continue;

      const p00 = positions[i][j];
      const p01 = positions[i][j + 1];
      const p10 = positions[i + 1][j];
      const p11 = positions[i + 1][j + 1];
      const uv00 = uvs[i][j];
      const uv01 = uvs[i][j + 1];
      const uv10 = uvs[i + 1][j];
      const uv11 = uvs[i + 1][j + 1];

      facePositions.push(p00.x, p00.y, p00.z, p11.x, p11.y, p11.z, p10.x, p10.y, p10.z);
      faceUvs.push(...uv00, ...uv11, ...uv10);

      facePositions.push(p00.x, p00.y, p00.z, p01.x, p01.y, p01.z, p11.x, p11.y, p11.z);
      faceUvs.push(...uv00, ...uv01, ...uv11);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(facePositions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(faceUvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Направление «наружу» из центра кусочка — свой для каждого, а не общий угол сектора. */
function outwardFromCentroid(centroid) {
  const dir = new THREE.Vector3(centroid.x, 0, centroid.z);
  if (dir.lengthSq() < 1e-6) {
    const angle = rand(0, Math.PI * 2);
    dir.set(Math.sin(angle), 0, Math.cos(angle));
  } else {
    dir.normalize();
  }
  return dir;
}

/**
 * Шоколадный слой: цельная скорлупа без единого шва, пока её не трогали.
 * Внутри уже сетка нарезки на неровные кусочки — каждый клик откалывает
 * один, как если бы ребёнок отламывал шоколад руками, и сквозь дырку сразу
 * виден жёлтый контейнер внутри.
 */
export function createChocolate() {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const texture = createChocolateTexture();
  const baseMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.6,
    metalness: 0,
    envMapIntensity: 0.35,
    side: THREE.DoubleSide,
  });

  const grid = buildGrid();
  const regionOf = assignPieces(grid.rows, grid.cols, CHOCOLATE_PIECES);

  const pieces = [];
  for (let p = 0; p < CHOCOLATE_PIECES; p++) {
    const geometry = buildPieceGeometry(grid, p, regionOf);
    const material = baseMaterial.clone();
    material.transparent = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.layer = 'chocolate';

    const centroid = new THREE.Vector3();
    geometry.boundingBox.getCenter(centroid);
    mesh.userData.centroid = centroid;
    // midAngle нужен, чтобы яйцо могло довернуться этим кусочком к игроку —
    // тем же способом, что и для лепестков фольги.
    mesh.userData.midAngle = Math.atan2(centroid.x, centroid.z);

    group.add(mesh);
    pieces.push(mesh);
  }

  baseMaterial.dispose(); // сам не использовался — на мешах его клоны

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

  /** Откалывает конкретный кусочек: он подпрыгивает и улетает с гравитацией. */
  function peel(mesh) {
    const index = pieces.indexOf(mesh);
    if (index === -1) return false;
    pieces.splice(index, 1);
    shake();

    const dir = outwardFromCentroid(mesh.userData.centroid);
    const start = mesh.position.clone();
    const spin = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
    const velocity = dir.clone().multiplyScalar(rand(1.6, 2.6));
    velocity.y = rand(1.2, 2.4);

    // Сначала кусочек чуть отваливается наружу, потом падает с вращением.
    tween(0.1, (t) => {
      mesh.position.copy(start).addScaledVector(dir, t * 0.12);
    }, () => {
      let life = 0;
      const total = 1.0;
      animate((dt) => {
        life += dt;
        velocity.y -= 12 * dt;
        mesh.position.addScaledVector(velocity, dt);
        mesh.rotation.x += spin.x * dt;
        mesh.rotation.y += spin.y * dt;
        mesh.rotation.z += spin.z * dt;
        mesh.material.opacity = Math.max(0, 1 - easeOutCubic(life / total));
        if (life >= total) {
          group.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          return false;
        }
        return true;
      });
    });

    return true;
  }

  function dispose() {
    for (const piece of pieces) {
      piece.geometry.dispose();
      piece.material.dispose();
    }
    texture.dispose();
    group.clear();
    pieces.length = 0;
  }

  return {
    group,
    get remaining() {
      return pieces.length;
    },
    get meshes() {
      return pieces;
    },
    peel,
    dispose,
  };
}
