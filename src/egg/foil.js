import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { buildShellGrid, growPieces, buildPieceGeometry, pieceMidAngle, pieceLocalCentroid, flyAway } from './shellPieces.js';

const FOIL_COLORS = [0xff4d6d, 0xffd166, 0x4cc9f0, 0x80ed99, 0xf72585, 0xffa552, 0x9b5de5, 0x00bbf9];
const PROFILE_STEPS = 30;
const ANGULAR_SEGMENTS = 32;

/**
 * Слой фольги: цельная блестящая оболочка без единого шва, пока её не
 * тронули. Внутри уже размечена сетка на неровные разноцветные кусочки —
 * так же, как и шоколад под ней — и каждый клик отрывает один из них.
 */
export function createFoil(pieceCount = 8, debris) {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const grid = buildShellGrid({ steps: PROFILE_STEPS, segments: ANGULAR_SEGMENTS, scale: 1.035 });
  const regionOf = growPieces(grid.rows, grid.cols, pieceCount);

  const pieces = [];
  for (let p = 0; p < pieceCount; p++) {
    const geometry = buildPieceGeometry(grid, p, regionOf);
    const material = new THREE.MeshStandardMaterial({
      color: FOIL_COLORS[p % FOIL_COLORS.length],
      metalness: 0.85,
      roughness: 0.18,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      transparent: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.layer = 'foil';
    mesh.userData.centroid = pieceLocalCentroid(geometry);
    mesh.userData.midAngle = pieceMidAngle(geometry);

    group.add(mesh);
    pieces.push(mesh);
  }

  /** Отрывает конкретный кусочек фольги. */
  function peel(mesh) {
    const index = pieces.indexOf(mesh);
    if (index === -1) return false;
    pieces.splice(index, 1);
    flyAway(mesh, { group, debris });
    return true;
  }

  function dispose() {
    for (const piece of pieces) {
      piece.geometry.dispose();
      piece.material.dispose();
    }
    group.clear();
    pieces.length = 0;
  }

  return {
    group,
    get remaining() {
      return pieces.length;
    },
    get meshes() {
      return pieces;
    },
    peel,
    dispose,
  };
}
