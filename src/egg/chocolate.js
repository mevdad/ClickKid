import * as THREE from 'three';
import { EGG, eggProfile, outwardDirection } from './eggShape.js';
import { animate, tween, easeOutCubic, rand } from '../utils.js';

const BANDS = 2;
const SECTORS = 5;
export const CHOCOLATE_PIECES = BANDS * SECTORS;

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

/** Делит профиль яйца на несколько поясов по высоте (соседние пояса делят границу). */
function sliceBands(pointCount, bands) {
  const step = (pointCount - 1) / bands;
  const ranges = [];
  for (let b = 0; b < bands; b++) {
    ranges.push([Math.round(b * step), Math.round((b + 1) * step)]);
  }
  return ranges;
}

/**
 * Шоколадный слой: скорлупа сразу поделена на кусочки (пояса × секторы).
 * Как и фольга, каждый клик откалывает один кусочек — так шагов получается
 * больше и процесс выглядит как настоящее разламывание, а не один взрыв.
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
    transparent: true,
  });

  const profile = eggProfile(30, 1.0);
  const angularGap = 0.05; // зазор между кусочками — видно, что скорлупа составная
  const pieces = [];

  for (const [from, to] of sliceBands(profile.length, BANDS)) {
    const bandPoints = profile.slice(from, to + 1);
    for (let s = 0; s < SECTORS; s++) {
      const phiStart = (s / SECTORS) * Math.PI * 2 + angularGap / 2;
      const phiLength = (Math.PI * 2) / SECTORS - angularGap;
      const geometry = new THREE.LatheGeometry(bandPoints, 10, phiStart, phiLength);
      const mesh = new THREE.Mesh(geometry, baseMaterial.clone());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.layer = 'chocolate';
      mesh.userData.midAngle = phiStart + phiLength / 2;
      group.add(mesh);
      pieces.push(mesh);
    }
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

    const dir = outwardDirection(mesh.userData.midAngle);
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
    baseMaterial.dispose();
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
