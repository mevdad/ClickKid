import * as THREE from 'three';
import { EGG, eggProfile, outwardDirection } from './eggShape.js';
import { animate, tween, easeOutCubic, rand } from '../utils.js';

const FOIL_COLORS = [0xff4d6d, 0xffd166, 0x4cc9f0, 0x80ed99, 0xf72585, 0xffa552, 0x9b5de5, 0x00bbf9];

/**
 * Слой фольги: несколько разноцветных «лепестков» вокруг яйца.
 * Каждый клик отрывает один лепесток.
 */
export function createFoil(segmentCount = 8) {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const profile = eggProfile(28, 1.035);
  const gap = 0.035; // маленький зазор, чтобы были видны стыки фольги
  const petals = [];

  for (let i = 0; i < segmentCount; i++) {
    const phiStart = (i / segmentCount) * Math.PI * 2 + gap / 2;
    const phiLength = (Math.PI * 2) / segmentCount - gap;

    const geometry = new THREE.LatheGeometry(profile, 14, phiStart, phiLength);
    const material = new THREE.MeshStandardMaterial({
      color: FOIL_COLORS[i % FOIL_COLORS.length],
      metalness: 0.85,
      roughness: 0.18,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      transparent: true,
      flatShading: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.layer = 'foil';
    mesh.userData.midAngle = phiStart + phiLength / 2;
    group.add(mesh);
    petals.push(mesh);
  }

  /** Отрывает конкретный лепесток (или ближайший, если клик был мимо). */
  function peel(mesh, onDone) {
    const index = petals.indexOf(mesh);
    if (index === -1) return false;
    petals.splice(index, 1);

    const dir = outwardDirection(mesh.userData.midAngle);
    const start = mesh.position.clone();
    const spin = new THREE.Vector3(rand(-5, 5), rand(-5, 5), rand(-5, 5));
    const velocity = dir.clone().multiplyScalar(rand(2.2, 3.2));
    velocity.y = rand(2.4, 3.6);

    // Сначала лепесток слегка отгибается, потом улетает.
    tween(0.12, (t) => {
      mesh.position.copy(start).addScaledVector(dir, t * 0.18);
      mesh.scale.setScalar(1 + t * 0.06);
    }, () => {
      let life = 0;
      const total = 1.1;
      animate((dt) => {
        life += dt;
        velocity.y -= 9.5 * dt;
        mesh.position.addScaledVector(velocity, dt);
        mesh.rotation.x += spin.x * dt;
        mesh.rotation.y += spin.y * dt;
        mesh.rotation.z += spin.z * dt;
        mesh.material.opacity = Math.max(0, 1 - easeOutCubic(life / total));
        if (life >= total) {
          mesh.castShadow = false;
          group.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          onDone?.();
          return false;
        }
        return true;
      });
    });

    return true;
  }

  function dispose() {
    for (const petal of petals) {
      petal.geometry.dispose();
      petal.material.dispose();
    }
    group.clear();
    petals.length = 0;
  }

  return {
    group,
    get remaining() {
      return petals.length;
    },
    get meshes() {
      return petals;
    },
    peel,
    dispose,
  };
}
