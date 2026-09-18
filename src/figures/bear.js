import * as THREE from 'three';
import { toyMaterial, ball, limb, tube, dotEye, smile, blush } from './parts.js';

/**
 * Медвежонок-сладкоежка с горшочком мёда.
 * Образ собственный, в духе классических книжных иллюстраций.
 */
export function createBear() {
  const group = new THREE.Group();

  const fur = toyMaterial(0xd9a441);
  const furLight = toyMaterial(0xefc989);
  const dark = toyMaterial(0x3b2a18, { roughness: 0.4 });
  const potMaterial = toyMaterial(0x4a6fa5, { roughness: 0.4 });
  const honey = toyMaterial(0xffc233, { roughness: 0.25, metalness: 0.05 });

  // Туловище.
  const body = ball(0.42, fur, [0, 0.52, 0], [1, 1.05, 0.9]);
  group.add(body);
  group.add(ball(0.3, furLight, [0, 0.46, 0.22], [1, 1.05, 0.55]));

  // Ножки.
  for (const side of [-1, 1]) {
    group.add(ball(0.19, fur, [side * 0.22, 0.14, 0.05], [1, 0.8, 1.2]));
    group.add(ball(0.12, furLight, [side * 0.22, 0.12, 0.2], [1, 0.75, 0.6]));
  }

  // Голова.
  const head = new THREE.Group();
  head.position.set(0, 1.09, 0.02);
  group.add(head);

  head.add(ball(0.36, fur, [0, 0, 0], [1, 0.95, 0.95]));

  // Ушки.
  for (const side of [-1, 1]) {
    head.add(ball(0.13, fur, [side * 0.27, 0.26, -0.02]));
    head.add(ball(0.08, furLight, [side * 0.28, 0.26, 0.05], [1, 1, 0.5]));
  }

  // Мордочка.
  head.add(ball(0.19, furLight, [0, -0.09, 0.26], [1.15, 0.85, 0.8]));
  head.add(ball(0.07, dark, [0, -0.02, 0.4], [1.3, 0.9, 0.9]));
  head.add(smile(0.08, 0.018, [0, -0.13, 0.39], Math.PI * 0.8));

  head.add(dotEye(0.055, [-0.14, 0.06, 0.32]));
  head.add(dotEye(0.055, [0.14, 0.06, 0.32]));
  head.add(blush(0.07, [-0.26, -0.06, 0.24]));
  head.add(blush(0.07, [0.26, -0.06, 0.24]));

  // Горшочек мёда в лапах.
  const pot = new THREE.Group();
  pot.position.set(0, 0.42, 0.42);
  group.add(pot);
  pot.add(tube(0.19, 0.15, 0.26, potMaterial, [0, 0, 0]));
  const potRim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 10, 28), potMaterial);
  potRim.rotation.x = Math.PI / 2;
  potRim.position.y = 0.13;
  potRim.castShadow = true;
  pot.add(potRim);
  const honeyTop = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), honey);
  honeyTop.rotation.x = -Math.PI / 2;
  honeyTop.position.y = 0.125;
  pot.add(honeyTop);

  // Лапки обнимают горшочек.
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = limb(0.1, 0.24, fur, [side * 0.34, 0.52, 0.22], [1.1, 0, side * 0.5]);
    group.add(arm);
    group.add(ball(0.11, furLight, [side * 0.24, 0.42, 0.42]));
    arms.push(arm);
  }

  function update(dt, elapsed) {
    // Покачивается и заглядывает в горшочек.
    group.position.y = Math.sin(elapsed * 1.6) * 0.035;
    group.rotation.z = Math.sin(elapsed * 1.1) * 0.05;
    head.rotation.z = Math.sin(elapsed * 1.4 + 0.5) * 0.09;
    head.rotation.x = Math.sin(elapsed * 0.9) * 0.06 + 0.04;
  }

  return { group, name: 'Медвежонок', update };
}
