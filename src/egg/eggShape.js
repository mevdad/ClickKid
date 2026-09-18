import * as THREE from 'three';

/** Общие размеры яйца — от них считаются все слои. */
export const EGG = {
  halfHeight: 1.35,
  radius: 0.92,
  centerY: 1.5,
};

/**
 * Профиль яйца для LatheGeometry: снизу шире, сверху уже.
 * Возвращает точки от вершины к донышку.
 */
export function eggProfile(steps = 32, scale = 1) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI;
    const y = Math.cos(t) * EGG.halfHeight * scale;
    const r = Math.sin(t) * EGG.radius * scale * (1 - 0.25 * Math.cos(t));
    points.push(new THREE.Vector2(Math.max(r, 0.0001), y));
  }
  return points;
}

/** Направление «наружу» для сектора, заданного средним углом. */
export function outwardDirection(midAngle) {
  return new THREE.Vector3(Math.sin(midAngle), 0, Math.cos(midAngle));
}
