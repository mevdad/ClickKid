import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { animate } from '../utils.js';
import { buildVoronoiShell, flyAway } from './shellPieces.js';

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
 * Шоколадный слой: цельная гладкая скорлупа без единого шва, пока её не
 * трогали. Внутри уже размечена диаграмма Вороного на неровные
 * многоугольники — каждый клик откалывает один, как если бы ребёнок
 * отламывал шоколад руками, и сквозь дырку сразу виден контейнер внутри.
 */
export function createChocolate(debris) {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const texture = createChocolateTexture();
  const shards = buildVoronoiShell({ pieceCount: CHOCOLATE_PIECES, scale: 1.0 });

  const pieces = [];
  for (const shard of shards) {
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.6,
      metalness: 0,
      envMapIntensity: 0.35,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(shard.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.layer = 'chocolate';
    mesh.userData.centroid = shard.centroid;
    mesh.userData.midAngle = shard.midAngle;

    group.add(mesh);
    pieces.push(mesh);
  }

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
    flyAway(mesh, { group, debris });
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
