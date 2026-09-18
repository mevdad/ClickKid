import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { animate, tween, easeOutCubic, easeOutElastic, rand } from '../utils.js';

const TWISTS = 3; // два поворота крышки, третий клик её открывает

/** На такой высоте контейнер «стоит» донышком на полу. */
export const CAPSULE_REST_Y = 1.06;
/** Верхняя кромка контейнера в этой позиции — с неё встаёт игрушка. */
export const CAPSULE_TOP_Y = CAPSULE_REST_Y + 0.22;

/**
 * Жёлтый цилиндрический контейнер с игрушкой внутри.
 * Крышка откручивается за несколько кликов.
 */
export function createCapsule() {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;
  group.visible = false;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffc300,
    roughness: 0.35,
    metalness: 0.05,
  });
  const lidMaterial = new THREE.MeshStandardMaterial({
    color: 0xffdd55,
    roughness: 0.3,
    metalness: 0.05,
    transparent: true,
  });
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff3c4,
    roughness: 0.5,
  });
  // Насечки чуть темнее корпуса — читаются как рифление, а не как корона.
  const notchMaterial = new THREE.MeshStandardMaterial({
    color: 0xeaa900,
    roughness: 0.45,
  });

  const body = new THREE.Group();

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.0, 40), bodyMaterial);
  barrel.position.y = -0.2;
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  body.add(barrel);

  const bottom = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    bodyMaterial
  );
  bottom.position.y = -0.7;
  bottom.scale.y = 0.6;
  bottom.castShadow = true;
  body.add(bottom);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.605, 0.04, 12, 44), rimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.22;
  rim.castShadow = true;
  body.add(rim);

  group.add(body);

  const lid = new THREE.Group();
  const lidSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.63, 0.63, 0.3, 40), lidMaterial);
  lidSkirt.castShadow = true;
  lid.add(lidSkirt);

  const lidDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.63, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    lidMaterial
  );
  lidDome.position.y = 0.15;
  lidDome.scale.y = 0.55;
  lidDome.castShadow = true;
  lid.add(lidDome);

  // Насечки на крышке — подсказка, что её надо крутить.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), notchMaterial);
    notch.position.set(Math.sin(angle) * 0.63, -0.02, Math.cos(angle) * 0.63);
    notch.rotation.y = angle;
    lid.add(notch);
  }

  lid.position.y = 0.45;
  group.add(lid);

  let twists = 0;
  let opened = false;

  /** Плавное появление контейнера после того, как шоколад разлетелся. */
  function reveal(onDone) {
    group.visible = true;
    group.scale.setScalar(0.6);
    tween(0.55, (t) => {
      const e = easeOutElastic(t);
      group.scale.setScalar(0.6 + 0.4 * e);
      group.position.y = EGG.centerY - (EGG.centerY - 1.35) * easeOutCubic(t);
    }, onDone);
  }

  /** Клик по контейнеру: поворот крышки или её открытие. */
  function hit(onOpened) {
    if (opened) return null;

    if (twists < TWISTS - 1) {
      twists++;
      const fromRot = lid.rotation.y;
      const fromY = lid.position.y;
      tween(0.3, (t) => {
        const e = easeOutCubic(t);
        lid.rotation.y = fromRot + e * (Math.PI * 0.75);
        lid.position.y = fromY + e * 0.06;
      });
      wobble();
      return 'twist';
    }

    opened = true;
    popLid(onOpened);
    return 'open';
  }

  function wobble() {
    let t = 0;
    animate((dt) => {
      t += dt;
      const decay = Math.max(0, 1 - t / 0.4);
      group.rotation.z = Math.sin(t * 38) * 0.05 * decay;
      if (t >= 0.4) {
        group.rotation.z = 0;
        return false;
      }
      return true;
    });
  }

  function popLid(onDone) {
    const velocity = new THREE.Vector3(rand(-0.8, 0.8), 4.6, rand(-0.4, 1.2));
    const spin = new THREE.Vector3(rand(-6, 6), 8, rand(-6, 6));
    let life = 0;
    const total = 1.1;
    animate((dt) => {
      life += dt;
      velocity.y -= 9.5 * dt;
      lid.position.addScaledVector(velocity, dt);
      lid.rotation.x += spin.x * dt;
      lid.rotation.y += spin.y * dt;
      lid.rotation.z += spin.z * dt;
      lidMaterial.opacity = Math.max(0, 1 - life / total);
      if (life >= total) {
        lid.visible = false;
        onDone?.();
        return false;
      }
      return true;
    });
  }

  /** Контейнер «садится» вниз, чтобы игрушка была хорошо видна. */
  function settle() {
    const fromY = group.position.y;
    tween(0.5, (t) => {
      group.position.y = fromY + (CAPSULE_REST_Y - fromY) * easeOutCubic(t);
    });
  }

  function dispose() {
    group.traverse((obj) => {
      if (obj.isMesh) obj.geometry.dispose();
    });
    bodyMaterial.dispose();
    lidMaterial.dispose();
    rimMaterial.dispose();
    notchMaterial.dispose();
    group.clear();
  }

  return {
    group,
    get remaining() {
      return opened ? 0 : TWISTS - twists;
    },
    get meshes() {
      const list = [];
      group.traverse((obj) => {
        if (obj.isMesh && obj.visible) list.push(obj);
      });
      return list;
    },
    hit,
    reveal,
    settle,
    dispose,
  };
}
