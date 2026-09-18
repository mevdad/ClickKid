import * as THREE from 'three';

/** Матовый «игрушечный» материал. */
export function toyMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.0,
    envMapIntensity: 0.65,
    ...options,
  });
}

export function ball(radius, material, position = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function limb(radius, length, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 16), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  return mesh;
}

export function cone(radius, height, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 24), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  return mesh;
}

export function tube(radiusTop, radiusBottom, height, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 28), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  return mesh;
}

const WHITE = toyMaterial(0xffffff, { roughness: 0.35 });
const BLACK = toyMaterial(0x241a14, { roughness: 0.3 });
const SHINE = new THREE.MeshBasicMaterial({ color: 0xffffff });

/** Большой мультяшный глаз, смотрящий в +Z. */
export function eye(radius, position) {
  const group = new THREE.Group();
  group.position.set(...position);

  const sclera = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), WHITE);
  sclera.castShadow = true;
  group.add(sclera);

  const pupil = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.55, 20, 16), BLACK);
  pupil.position.z = radius * 0.62;
  group.add(pupil);

  const shine = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.18, 12, 10), SHINE);
  shine.position.set(-radius * 0.22, radius * 0.25, radius * 0.9);
  group.add(shine);

  return group;
}

/** Точка-глаз для маленьких мордочек. */
export function dotEye(radius, position) {
  const group = new THREE.Group();
  group.position.set(...position);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), BLACK);
  group.add(dot);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.3, 10, 8), SHINE);
  shine.position.set(-radius * 0.25, radius * 0.3, radius * 0.75);
  group.add(shine);
  return group;
}

/** Улыбка из дуги — тонкий тор с обрезанным углом. */
export function smile(radius, tubeRadius, position, arc = Math.PI * 0.7) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tubeRadius, 10, 24, arc),
    BLACK
  );
  mesh.position.set(...position);
  mesh.rotation.z = -Math.PI / 2 - arc / 2;
  return mesh;
}

/** Румянец на щеках. */
export function blush(radius, position, color = 0xff9bb3) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
  );
  mesh.position.set(...position);
  return mesh;
}
