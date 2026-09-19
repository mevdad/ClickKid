import * as THREE from 'three';
import { toyMaterial, ball, limb, dotEye, smile, blush } from './parts.js';

/**
 * Малыш — запасная процедурная фигурка на случай, если модель
 * из public/models/baby.glb не загрузится (см. figures/index.js).
 */
export function createBaby() {
  const group = new THREE.Group();

  const skin = toyMaterial(0xffdfc2);
  const onesie = toyMaterial(0xa0e7e5);
  const hair = toyMaterial(0x5a3a2a, { roughness: 0.4 });

  // Пухлое тельце в комбинезоне.
  group.add(ball(0.36, onesie, [0, 0.4, 0], [1, 0.92, 0.9]));
  group.add(ball(0.1, toyMaterial(0xffe27a), [0, 0.28, 0.32], [1, 0.7, 0.6])); // пуговка

  // Ручки и ножки.
  for (const side of [-1, 1]) {
    group.add(limb(0.09, 0.22, onesie, [side * 0.33, 0.46, 0.05], [0, 0, side * 0.6]));
    group.add(ball(0.09, skin, [side * 0.44, 0.36, 0.08]));

    group.add(limb(0.1, 0.24, onesie, [side * 0.17, 0.12, 0.05], [0.2, 0, side * 0.15]));
    group.add(ball(0.1, skin, [side * 0.19, -0.02, 0.12], [1.1, 0.7, 1]));
  }

  // Голова — большая и круглая, как у малыша.
  const head = new THREE.Group();
  head.position.set(0, 0.86, 0.02);
  group.add(head);

  head.add(ball(0.33, skin, [0, 0, 0], [1, 0.98, 0.96]));

  // Ушки.
  for (const side of [-1, 1]) {
    head.add(ball(0.06, skin, [side * 0.31, -0.02, 0]));
  }

  // Хохолок волос.
  head.add(ball(0.05, hair, [0, 0.3, 0.12], [0.7, 1.3, 0.7]));
  head.add(ball(0.045, hair, [0.05, 0.29, 0.1], [0.6, 1.1, 0.6]));
  head.add(ball(0.045, hair, [-0.05, 0.29, 0.1], [0.6, 1.1, 0.6]));

  // Мордочка.
  head.add(dotEye(0.05, [-0.12, 0.02, 0.29]));
  head.add(dotEye(0.05, [0.12, 0.02, 0.29]));
  head.add(smile(0.07, 0.014, [0, -0.09, 0.31], Math.PI * 0.75));
  head.add(blush(0.06, [-0.23, -0.06, 0.2]));
  head.add(blush(0.06, [0.23, -0.06, 0.2]));

  function update(dt, elapsed) {
    // Довольное покачивание и взмахи ручками.
    group.position.y = Math.sin(elapsed * 1.6) * 0.045;
    head.rotation.z = Math.sin(elapsed * 1.1) * 0.08;
    group.rotation.y = Math.sin(elapsed * 0.7) * 0.12;
  }

  return { group, name: 'Малыш', update };
}
