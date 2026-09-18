import * as THREE from 'three';
import { toyMaterial, ball, cone, tube, eye, smile, limb } from './parts.js';

/** Пчёлка: полосатое тельце, прозрачные крылышки, усики. */
export function createBee() {
  const group = new THREE.Group();

  const yellow = toyMaterial(0xffc93c);
  const black = toyMaterial(0x33291c, { roughness: 0.4 });
  const wingMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd8f3ff,
    roughness: 0.15,
    metalness: 0,
    transmission: 0.75,
    thickness: 0.2,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });

  const bodyY = 0.5;

  // Тельце вытянуто вдоль оси Z.
  const body = ball(0.36, yellow, [0, bodyY, -0.05], [1, 0.92, 1.25]);
  group.add(body);

  // Чёрные полоски — тонкие торы поперёк тельца.
  for (const [z, scale] of [[-0.38, 0.86], [-0.12, 0.99], [0.14, 0.95]]) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 10, 32), black);
    stripe.position.set(0, bodyY, z);
    stripe.scale.set(scale, scale * 0.92, 1);
    stripe.castShadow = true;
    group.add(stripe);
  }

  // Жало.
  group.add(cone(0.07, 0.18, black, [0, bodyY, -0.55], [-Math.PI / 2, 0, 0]));

  // Голова.
  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.12, 0.38);
  group.add(head);
  head.add(ball(0.26, black, [0, 0, 0], [1, 0.95, 0.92]));
  head.add(eye(0.095, [-0.11, 0.05, 0.2]));
  head.add(eye(0.095, [0.11, 0.05, 0.2]));
  head.add(smile(0.07, 0.016, [0, -0.09, 0.24]));

  // Усики.
  for (const side of [-1, 1]) {
    const antenna = tube(0.014, 0.014, 0.24, black, [side * 0.1, 0.22, 0.05], [0.2, 0, side * 0.45]);
    head.add(antenna);
    head.add(ball(0.04, yellow, [side * 0.2, 0.33, 0.07]));
  }

  // Крылышки — по паре с каждой стороны.
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(side * 0.14, bodyY + 0.3, 0.02);
    const blade = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), wingMaterial);
    blade.scale.set(1, 0.12, 0.55);
    blade.position.set(side * 0.3, 0, 0);
    wing.add(blade);
    const small = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), wingMaterial);
    small.scale.set(1, 0.12, 0.55);
    small.position.set(side * 0.24, -0.03, -0.24);
    wing.add(small);
    group.add(wing);
    wings.push({ wing, side });
  }

  // Лапки.
  for (const side of [-1, 1]) {
    for (const z of [0.12, -0.12, -0.34]) {
      group.add(limb(0.028, 0.16, black, [side * 0.26, bodyY - 0.32, z], [0, 0, side * 0.7]));
    }
  }

  function update(dt, elapsed) {
    // Быстрое «жужжание» крыльями и лёгкое парение.
    for (const { wing, side } of wings) {
      wing.rotation.z = Math.sin(elapsed * 34) * 0.55 * side;
    }
    group.position.y = Math.sin(elapsed * 2.4) * 0.07;
    group.rotation.z = Math.sin(elapsed * 1.7) * 0.06;
  }

  return { group, name: 'Пчёлка', update };
}
