import * as THREE from 'three';
import { toyMaterial, ball, limb, tube, cone, dotEye, smile, blush } from './parts.js';

/** Розовый поросёнок с шарфиком. */
export function createPiglet() {
  const group = new THREE.Group();

  const pink = toyMaterial(0xffa3ba);
  const pinkDark = toyMaterial(0xf97e9d);
  const dark = toyMaterial(0x4a2d33, { roughness: 0.4 });
  const scarfMaterial = toyMaterial(0x3fbfa0, { roughness: 0.8 });

  // Туловище — поросёнок поменьше медвежонка.
  group.add(ball(0.32, pink, [0, 0.42, 0], [1, 1.05, 0.88]));

  // Ножки и копытца.
  for (const side of [-1, 1]) {
    group.add(limb(0.09, 0.1, pink, [side * 0.16, 0.16, 0.02]));
    group.add(ball(0.09, pinkDark, [side * 0.16, 0.07, 0.04], [1, 0.6, 1.1]));
  }

  // Ручки.
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = limb(0.075, 0.16, pink, [side * 0.31, 0.44, 0.02], [0, 0, side * 0.35]);
    group.add(arm);
    arms.push(arm);
  }

  // Шарфик.
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.065, 12, 30), scarfMaterial);
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 0.68;
  scarf.castShadow = true;
  group.add(scarf);
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.3, 0.06), scarfMaterial);
  scarfTail.position.set(0.17, 0.55, 0.16);
  scarfTail.rotation.z = 0.25;
  scarfTail.castShadow = true;
  group.add(scarfTail);

  // Голова — крупная, как у игрушки.
  const head = new THREE.Group();
  head.position.set(0, 0.99, 0.02);
  group.add(head);
  head.add(ball(0.33, pink, [0, 0, 0], [1, 0.96, 0.94]));

  // Ушки — плоские треугольнички, наклонённые вперёд.
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = cone(0.13, 0.22, pink, [side * 0.21, 0.28, 0.02], [0.4, 0, side * 0.3]);
    ear.scale.z = 0.5;
    head.add(ear);
    ears.push({ ear, side });
  }

  // Пятачок.
  const snout = tube(0.16, 0.16, 0.12, pinkDark, [0, -0.06, 0.31], [Math.PI / 2, 0, 0]);
  head.add(snout);
  for (const side of [-1, 1]) {
    head.add(ball(0.03, dark, [side * 0.06, -0.06, 0.39], [1, 1.4, 0.6]));
  }

  head.add(dotEye(0.05, [-0.13, 0.08, 0.29]));
  head.add(dotEye(0.05, [0.13, 0.08, 0.29]));
  head.add(smile(0.06, 0.015, [0, -0.2, 0.28], Math.PI * 0.7));
  head.add(blush(0.06, [-0.24, -0.02, 0.22], 0xff7a9c));
  head.add(blush(0.06, [0.24, -0.02, 0.22], 0xff7a9c));

  // Хвостик-пружинка.
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 10, 20, Math.PI * 1.6), pink);
  tail.position.set(0, 0.45, -0.3);
  tail.rotation.y = Math.PI / 2;
  tail.castShadow = true;
  group.add(tail);

  function update(dt, elapsed) {
    // Подпрыгивает и шевелит ушами.
    const hop = Math.abs(Math.sin(elapsed * 2.2));
    group.position.y = hop * 0.08;
    group.rotation.y = Math.sin(elapsed * 0.9) * 0.12;
    for (const { ear, side } of ears) {
      ear.rotation.z = side * (0.3 + Math.sin(elapsed * 3.1 + side) * 0.12);
    }
    for (let i = 0; i < arms.length; i++) {
      arms[i].rotation.z = (i === 0 ? -1 : 1) * (0.35 + Math.sin(elapsed * 2.2) * 0.2);
    }
    tail.rotation.z = Math.sin(elapsed * 4) * 0.3;
  }

  return { group, name: 'Поросёнок', update };
}
