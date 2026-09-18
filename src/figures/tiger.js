import * as THREE from 'three';
import { toyMaterial, ball, tube, dotEye, smile, blush } from './parts.js';

/**
 * Тигрёнок — запасная процедурная фигурка на случай, если модель
 * из public/models/tiger.glb не загрузится (см. figures/index.js).
 */
export function createTiger() {
  const group = new THREE.Group();

  const orange = toyMaterial(0xff9f43);
  const cream = toyMaterial(0xfff3d6);
  const dark = toyMaterial(0x2b1c14, { roughness: 0.4 });
  const pink = toyMaterial(0xffabc0);

  // Туловище со светлым брюшком.
  group.add(ball(0.4, orange, [0, 0.5, 0], [1, 1.0, 0.88]));
  group.add(ball(0.28, cream, [0, 0.42, 0.2], [0.95, 1.0, 0.55]));

  // Полоски на теле — сплюснутые и повёрнутые шарики.
  const bodyStripes = [
    [0.28, 0.64, 0.06, 0.5],
    [-0.28, 0.64, 0.06, -0.5],
    [0.32, 0.42, -0.05, 0.4],
    [-0.32, 0.42, -0.05, -0.4],
    [0.2, 0.8, 0.08, 0.3],
    [-0.2, 0.8, 0.08, -0.3],
  ];
  for (const [x, y, z, rot] of bodyStripes) {
    const stripe = ball(0.09, dark, [x, y, z], [0.32, 1.15, 0.55]);
    stripe.rotation.z = rot;
    group.add(stripe);
  }

  // Ножки.
  for (const side of [-1, 1]) {
    group.add(ball(0.17, orange, [side * 0.21, 0.13, 0.04], [1, 0.75, 1.15]));
    group.add(ball(0.1, cream, [side * 0.21, 0.1, 0.18], [1, 0.7, 0.55]));
  }

  // Голова.
  const head = new THREE.Group();
  head.position.set(0, 1.05, 0.02);
  group.add(head);

  head.add(ball(0.35, orange, [0, 0, 0], [1, 0.94, 0.95]));

  // Ушки.
  for (const side of [-1, 1]) {
    head.add(ball(0.12, orange, [side * 0.26, 0.27, -0.02]));
    head.add(ball(0.07, pink, [side * 0.27, 0.27, 0.04], [1, 1, 0.5]));
  }

  // Полоски на лбу.
  for (const [x, rot] of [[0.12, 0.3], [-0.12, -0.3], [0, 0]]) {
    const s = ball(0.05, dark, [x, 0.27, 0.22], [0.35, 1.2, 0.45]);
    s.rotation.z = rot;
    head.add(s);
  }

  // Мордочка.
  head.add(ball(0.18, cream, [0, -0.1, 0.25], [1.15, 0.85, 0.78]));
  head.add(ball(0.06, dark, [0, -0.03, 0.38], [1.3, 0.9, 0.9]));
  head.add(smile(0.075, 0.016, [0, -0.14, 0.37], Math.PI * 0.8));

  head.add(dotEye(0.055, [-0.13, 0.05, 0.31]));
  head.add(dotEye(0.055, [0.13, 0.05, 0.31]));
  head.add(blush(0.06, [-0.25, -0.05, 0.22], 0xffab91));
  head.add(blush(0.06, [0.25, -0.05, 0.22], 0xffab91));

  // Полосатый хвостик.
  const tail = new THREE.Group();
  tail.position.set(0, 0.5, -0.35);
  group.add(tail);
  tail.add(tube(0.06, 0.09, 0.5, orange, [0, 0.15, -0.05], [0.6, 0, 0]));
  tail.add(ball(0.07, dark, [0, 0.4, -0.25], [1, 0.6, 1]));

  function update(dt, elapsed) {
    // Слегка покачивается и помахивает хвостом.
    group.position.y = Math.sin(elapsed * 1.7) * 0.04;
    group.rotation.y = Math.sin(elapsed * 0.8) * 0.1;
    head.rotation.z = Math.sin(elapsed * 1.3) * 0.07;
    tail.rotation.z = Math.sin(elapsed * 2.4) * 0.25;
  }

  return { group, name: 'Тигрёнок', update };
}
