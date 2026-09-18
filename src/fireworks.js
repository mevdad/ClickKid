import * as THREE from 'three';
import { animate, rand, pick } from './utils.js';

const COLORS = [0xff5d8f, 0xffd23f, 0x4cc9f0, 0x7bf1a8, 0xc77dff, 0xff8c42, 0x5de4c7];

/**
 * Праздничный салют: несколько залпов взлетают и рассыпаются искрами в небе.
 * Играется вместе с конфетти, когда игрушка появляется из контейнера.
 */
export function createFireworks(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const sparkGeometry = new THREE.SphereGeometry(0.045, 8, 6);
  let timers = [];

  function explode(position, onBurst) {
    const color = pick(COLORS);
    const count = 55;
    const particles = [];

    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(sparkGeometry, material);
      mesh.position.copy(position);
      group.add(mesh);

      // Равномерный разлёт по сфере — классический шар салюта.
      const theta = rand(0, Math.PI * 2);
      const phi = Math.acos(rand(-1, 1));
      const speed = rand(2.4, 4.6);
      const velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi)
      ).multiplyScalar(speed);

      particles.push({ mesh, velocity });
    }

    onBurst?.();

    let life = 0;
    const total = 1.4;
    animate((dt) => {
      life += dt;
      for (const p of particles) {
        p.velocity.y -= 3.4 * dt; // лёгкая гравитация — искры оседают дугой
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.material.opacity = Math.max(0, 1 - life / total);
      }
      if (life >= total) {
        for (const p of particles) {
          p.mesh.material.dispose();
          group.remove(p.mesh);
        }
        return false;
      }
      return true;
    });
  }

  /** Запускает несколько залпов салюта с небольшой задержкой между ними. */
  function launch(origin, { count = 4, onBurst } = {}) {
    for (let i = 0; i < count; i++) {
      const delay = i * rand(0.16, 0.28);
      const position = origin
        .clone()
        .add(new THREE.Vector3(rand(-1.3, 1.3), rand(-0.3, 0.9), rand(-0.4, 0.5)));
      const id = setTimeout(() => explode(position, onBurst), delay * 1000);
      timers.push(id);
    }
  }

  function clear() {
    timers.forEach(clearTimeout);
    timers = [];
    group.clear();
  }

  return { launch, clear };
}
