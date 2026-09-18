import * as THREE from 'three';
import { EGG, eggProfile, outwardDirection } from './eggShape.js';
import { animate, tween, rand } from '../utils.js';

const CRACK_STAGES = 3; // столько раз яйцо трескается, следующий клик его разбивает

/** Текстура шоколада: тёплый коричневый с крапинками; трещины дорисовываются. */
function createChocolateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  function paintBase() {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#542c14');
    gradient.addColorStop(0.5, '#70391b');
    gradient.addColorStop(1, '#40200f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,220,180' : '40,20,10'},${Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 3, 3);
    }
  }

  paintBase();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;

  /** Рисует ветвящуюся трещину; u и v — от 0 до 1 по развёртке яйца. */
  function drawCrack(u, v) {
    const startX = u * canvas.width;
    const startY = v * canvas.height;
    ctx.lineCap = 'round';

    const branch = (x, y, angle, length, width, depth) => {
      if (depth > 3 || length < 10) return;
      let cx = x;
      let cy = y;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        angle += rand(-0.45, 0.45);
        cx += Math.cos(angle) * (length / steps);
        cy += Math.sin(angle) * (length / steps);
        ctx.lineTo(cx, cy);
      }
      // Тёмная сердцевина трещины и светлый скол по краю — так она заметнее.
      ctx.strokeStyle = 'rgba(255,226,186,0.4)';
      ctx.lineWidth = width * 1.7;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(16,7,2,1)';
      ctx.lineWidth = width;
      ctx.stroke();

      branch(cx, cy, angle + rand(0.5, 1.2), length * 0.62, width * 0.72, depth + 1);
      if (Math.random() < 0.8) branch(cx, cy, angle - rand(0.5, 1.2), length * 0.55, width * 0.7, depth + 1);
      if (depth === 0) branch(x, y, angle + Math.PI + rand(-0.6, 0.6), length * 0.8, width * 0.85, depth + 1);
    };

    branch(startX, startY, rand(0, Math.PI * 2), rand(150, 220), 8, 0);
    texture.needsUpdate = true;
  }

  function reset() {
    paintBase();
    texture.needsUpdate = true;
  }

  return { texture, drawCrack, reset };
}

/** Осколки: яйцо делится на пояса по высоте и на секторы по кругу. */
function createShards(material) {
  const shards = [];
  const profile = eggProfile(30, 0.995);
  const bands = [[0, 11], [10, 21], [20, 30]];
  const sectors = 6;

  for (const [from, to] of bands) {
    const bandPoints = profile.slice(from, to + 1);
    for (let s = 0; s < sectors; s++) {
      const phiStart = (s / sectors) * Math.PI * 2;
      const phiLength = (Math.PI * 2) / sectors;
      const geometry = new THREE.LatheGeometry(bandPoints, 8, phiStart, phiLength);
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.castShadow = true;
      mesh.userData.midAngle = phiStart + phiLength / 2;
      shards.push(mesh);
    }
  }
  return shards;
}

/**
 * Шоколадный слой. Первые клики оставляют трещины, последний разбивает
 * скорлупу на осколки.
 */
export function createChocolate() {
  const group = new THREE.Group();
  group.position.y = EGG.centerY;

  const { texture, drawCrack, reset } = createChocolateTexture();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.0,
    envMapIntensity: 0.35,
    side: THREE.DoubleSide,
    transparent: true,
  });

  const shell = new THREE.Mesh(new THREE.LatheGeometry(eggProfile(40), 48), material);
  shell.castShadow = true;
  shell.receiveShadow = true;
  shell.userData.layer = 'chocolate';
  group.add(shell);

  const shardGroup = new THREE.Group();
  shardGroup.visible = false;
  group.add(shardGroup);

  let cracks = 0;
  let shattered = false;

  /** Один удар: трещина + дрожание. Возвращает 'crack' или 'shatter'. */
  function hit(onShattered) {
    if (shattered) return null;

    if (cracks < CRACK_STAGES) {
      cracks++;
      // Трещины раскиданы по окружности, чтобы их было видно с любой стороны.
      const u = (cracks - 1) / CRACK_STAGES + rand(0.05, 0.25);
      drawCrack(u % 1, rand(0.2, 0.62));
      shake();
      return 'crack';
    }

    shattered = true;
    shatter(onShattered);
    return 'shatter';
  }

  function shake() {
    const strength = 0.06;
    let t = 0;
    animate((dt) => {
      t += dt;
      const decay = Math.max(0, 1 - t / 0.35);
      shell.position.x = Math.sin(t * 60) * strength * decay;
      shell.rotation.z = Math.sin(t * 50) * 0.05 * decay;
      if (t >= 0.35) {
        shell.position.x = 0;
        shell.rotation.z = 0;
        return false;
      }
      return true;
    });
  }

  function shatter(onDone) {
    shell.visible = false;
    const shards = createShards(material);
    for (const shard of shards) shardGroup.add(shard);
    shardGroup.visible = true;

    const bodies = shards.map((shard) => {
      const dir = outwardDirection(shard.userData.midAngle);
      const velocity = dir.multiplyScalar(rand(1.8, 3.4));
      velocity.y = rand(1.6, 3.8);
      return {
        mesh: shard,
        velocity,
        spin: new THREE.Vector3(rand(-7, 7), rand(-7, 7), rand(-7, 7)),
      };
    });

    let life = 0;
    const total = 1.25;
    animate((dt) => {
      life += dt;
      for (const body of bodies) {
        body.velocity.y -= 11 * dt;
        body.mesh.position.addScaledVector(body.velocity, dt);
        body.mesh.rotation.x += body.spin.x * dt;
        body.mesh.rotation.y += body.spin.y * dt;
        body.mesh.rotation.z += body.spin.z * dt;
        body.mesh.material.opacity = Math.max(0, 1 - life / total);
      }
      if (life >= total) {
        for (const body of bodies) {
          body.mesh.geometry.dispose();
          body.mesh.material.dispose();
        }
        shardGroup.clear();
        onDone?.();
        return false;
      }
      return true;
    });
  }

  /** Появление шоколада после фольги — лёгкий «пружинящий» въезд. */
  function playIntro() {
    shell.scale.setScalar(0.85);
    material.opacity = 0;
    tween(0.4, (t) => {
      shell.scale.setScalar(0.85 + 0.15 * t);
      material.opacity = t;
    });
  }

  function dispose() {
    shell.geometry.dispose();
    material.dispose();
    texture.dispose();
    shardGroup.clear();
    group.clear();
  }

  return {
    group,
    shell,
    get remaining() {
      return shattered ? 0 : CRACK_STAGES + 1 - cracks;
    },
    get meshes() {
      return shattered ? [] : [shell];
    },
    hit,
    playIntro,
    reset,
    dispose,
  };
}
