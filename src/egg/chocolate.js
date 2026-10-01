import * as THREE from 'three';
import { EGG } from './eggShape.js';
import { animate, rand } from '../utils.js';
import { Delaunay } from 'd3-delaunay';
import { buildFullShellGeometry, surfacePoint } from './shellPieces.js';

export const CHOCOLATE_PIECES = 14; // на столько округлых кусков делится скорлупа
const TEXTURE_W = 2048;
const TEXTURE_H = 1024; // theta: 0..2π (по ширине), t: 0..π (по высоте)

/** Тёплый коричневый фон с лёгкими крапинками — база текстуры шоколада. */
function paintChocolateBase(ctx, canvas) {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#5a2f18');
  gradient.addColorStop(0.5, '#7a4020');
  gradient.addColorStop(1, '#40200f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,225,190' : '30,15,8'},${Math.random() * 0.07})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 3, 3);
  }
}

/**
 * Заранее делит всю поверхность шоколада на ровно count кусков — точными
 * ячейками диаграммы Вороного в «реальных» единицах поверхности яйца
 * (x = theta·радиус, y = t·полувысота), чтобы кусок у полюса не искажался.
 * Чтобы шов theta=0/2π не рвал ячейки, очаги дублируются со сдвигом на
 * окружность влево и вправо, а берётся ячейка средней копии; границы
 * вычисления вынесены далеко за полюса — ячейка продолжается за край
 * текстуры, и у полюсов не остаётся ни полоски, которую контур не накрыл бы.
 * Ячейки соседей делят одни и те же рёбра, поэтому после съедания всех
 * кусков не остаётся ни одного висящего клочка шоколада.
 */
function buildBitePieces(width, height, count) {
  const circumference = Math.PI * 2 * EGG.radius;
  const span = Math.PI * EGG.halfHeight;

  const seeds = [];
  for (let i = 0; i < count; i++) {
    const baseTheta = (i / count) * Math.PI * 2;
    const theta = baseTheta + rand(-0.35, 0.35);
    const t = rand(Math.PI * 0.1, Math.PI * 0.9);
    seeds.push({ theta, t });
  }

  const points = [];
  for (const shift of [-1, 0, 1]) {
    for (const seed of seeds) {
      points.push([(seed.theta / (Math.PI * 2) + shift) * circumference, (seed.t / Math.PI) * span]);
    }
  }
  const voronoi = Delaunay.from(points).voronoi([
    -circumference * 2,
    -span * 2,
    circumference * 3,
    span * 3,
  ]);

  const pieces = seeds.map((seed, i) => {
    const polygon = voronoi.cellPolygon(count + i).slice(0, -1);

    // Центр куска — по площади той его части, что попала на текстуру
    // (поэтому у полюса центр лежит на видимой стороне, а не в «воздухе»).
    let area = 0;
    let cx = 0;
    let cy = 0;
    const visible = polygon.map(([x, y]) => [x, Math.min(span, Math.max(0, y))]);
    for (let k = 0; k < visible.length; k++) {
      const [x0, y0] = visible[k];
      const [x1, y1] = visible[(k + 1) % visible.length];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    let midAngle = seed.theta;
    let t = seed.t;
    if (Math.abs(area) > 1e-9) {
      midAngle = ((((cx / (3 * area)) / circumference) * Math.PI * 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      t = Math.min(Math.PI * 0.95, Math.max(Math.PI * 0.05, (cy / (3 * area) / span) * Math.PI));
    }

    const path = new Path2D();
    polygon.forEach(([x, y], k) => {
      const px = (x / circumference) * width;
      const py = (y / span) * height;
      if (k === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    });
    path.closePath();

    return {
      index: i,
      torn: false,
      midAngle,
      t,
      path,
      centroid: surfacePoint(midAngle, t, 1.0),
    };
  });

  return { pieces };
}

/** Стирает альфу ровно по контуру куска — как и фольга (см. tearPatch в
 *  foil.js). Заливает контур при трёх горизонтальных сдвигах, потому что
 *  контур, пересекающий шов theta=0/2π, хранится развёрнутым и может
 *  выходить за границы канвы — сдвиги гарантируют, что видимая часть
 *  всегда закрасится правильно, откуда бы контур ни начинался. */
function biteCanvas(ctx, canvas, piece) {
  piece.torn = true;
  ctx.globalCompositeOperation = 'destination-out';
  // fillStyle мог остаться от крапинок базовой текстуры — там альфа
  // специально низкая (0.03–0.07), и destination-out с таким fillStyle
  // стирает только эту крошечную долю альфы, а не всю: кусок выглядит
  // «полустёртым» пятном вместо настоящей дыры.
  ctx.fillStyle = '#000';
  // Обводка в пару текселей перекрывает соседние контуры, чтобы на стыке
  // двух съеденных кусков не оставалось сглаженной (полупрозрачной) нитки.
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  for (const dx of [0, -canvas.width, canvas.width]) {
    ctx.save();
    ctx.translate(dx, 0);
    ctx.fill(piece.path);
    ctx.stroke(piece.path);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Шоколадный слой: одна цельная гладкая скорлупа без единого шва, пока её
 * не трогали — заранее поделённая на 14 округлых кусков. Клик «откусывает»
 * намеченный кусок целиком, ровно по его гладкому контуру — не рваным
 * многоугольником и не пиксельной ступенькой, а плавной кривой, как будто
 * его действительно откусили. Сквозь съеденный кусок сразу виден жёлтый
 * контейнер внутри.
 *
 * topology — та же общая триангуляция, что и у фольги (см. foil.js) —
 * гарантирует, что шоколад (scale 1.0) нигде не вылезает за фольгу
 * (scale 1.05): оба слоя строят цельный меш по одним и тем же точкам
 * поверхности, просто с разным масштабом радиуса.
 */
export function createChocolate(topology) {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const ctx = canvas.getContext('2d');
  paintChocolateBase(ctx, canvas);
  const { pieces } = buildBitePieces(canvas.width, canvas.height, CHOCOLATE_PIECES);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = buildFullShellGeometry(topology, 1.0);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    // Маска откушенных кусков всегда либо полностью цела, либо полностью
    // стёрта — не полупрозрачная. alphaTest вырезает такие пиксели
    // насквозь и оставляет материал полностью непрозрачным (без сортировки
    // прозрачности), поэтому шоколад не «спорит» за глубину с соседним
    // прозрачным слоем фольги.
    alphaTest: 0.5,
    roughness: 0.6,
    metalness: 0,
    envMapIntensity: 0.35,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.layer = 'chocolate';
  group.add(mesh);

  /** Короткий рывок всей скорлупы — тактильная отдача на удар. */
  function shake() {
    const strength = 0.05;
    let t = 0;
    animate((dt) => {
      t += dt;
      const decay = Math.max(0, 1 - t / 0.3);
      group.position.x = Math.sin(t * 55) * strength * decay;
      group.rotation.z = Math.sin(t * 46) * 0.04 * decay;
      if (t >= 0.3) {
        group.position.x = 0;
        group.rotation.z = 0;
        return false;
      }
      return true;
    });
  }

  /** «Откусывает» кусок: стирает альфу текстуры ровно по его контуру одним движением. */
  function bite(piece) {
    if (!piece || piece.torn) return false;
    shake();
    biteCanvas(ctx, canvas, piece);
    texture.needsUpdate = true;
    return true;
  }

  function peel(target) {
    return bite(target?.patch);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    group.clear();
  }

  return {
    group,
    get remaining() {
      return pieces.filter((p) => !p.torn).length;
    },
    /** Ещё целые куски как псевдо-меши — та же форма (.userData.centroid/.midAngle),
     *  что и раньше ожидал game.js, чтобы не трогать его логику доворота. */
    get meshes() {
      return pieces
        .filter((p) => !p.torn)
        .map((p) => ({ userData: { centroid: p.centroid, midAngle: p.midAngle }, patch: p }));
    },
    peel,
    dispose,
  };
}
