import * as THREE from 'three';
import { animate, rand, randInt } from './utils.js';

const COLORS = [0xff4d6d, 0xffd166, 0x4cc9f0, 0x80ed99, 0xf72585, 0x9b5de5, 0xffa552];

/** Салют из бумажек — вызывается, когда игрушка появилась. */
export function createConfetti(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const geometry = new THREE.PlaneGeometry(0.11, 0.16);
  const materials = COLORS.map(
    (color) =>
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true })
  );

  function burst(origin, count = 110) {
    const pieces = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, materials[randInt(0, materials.length - 1)].clone());
      mesh.position.copy(origin);
      mesh.position.x += rand(-0.3, 0.3);
      mesh.position.y += rand(-0.2, 0.2);
      mesh.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      group.add(mesh);

      const angle = rand(0, Math.PI * 2);
      const speed = rand(1.5, 4.5);
      pieces.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed * 0.6,
          rand(3.5, 6.5),
          Math.sin(angle) * speed * 0.45
        ),
        spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
        drift: rand(0.5, 1.6),
      });
    }

    let life = 0;
    const total = 3.2;
    animate((dt) => {
      life += dt;
      for (const piece of pieces) {
        piece.velocity.y -= 5.2 * dt;
        // Бумажки не падают камнем — их слегка сносит в стороны.
        piece.velocity.x += Math.sin(life * 3 + piece.drift) * dt * 0.8;
        piece.mesh.position.addScaledVector(piece.velocity, dt);
        piece.mesh.rotation.x += piece.spin.x * dt;
        piece.mesh.rotation.y += piece.spin.y * dt;
        piece.mesh.rotation.z += piece.spin.z * dt;
        if (life > total * 0.6) {
          piece.mesh.material.opacity = Math.max(0, 1 - (life - total * 0.6) / (total * 0.4));
        }
      }
      if (life >= total) {
        for (const piece of pieces) {
          piece.mesh.material.dispose();
          group.remove(piece.mesh);
        }
        return false;
      }
      return true;
    });
  }

  function clear() {
    group.clear();
  }

  return { burst, clear };
}
