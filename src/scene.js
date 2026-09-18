import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { rand } from './utils.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();

  // Без карты окружения металлическая фольга выглядит чёрной.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 1.1;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 1.5, 6.6);
  camera.lookAt(0, 1.4, 0);

  // Мягкий «студийный» свет: небо/земля + основной источник с тенью.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffd9ec, 1.25));

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(3.5, 6, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0015;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffe0f0, 0.7);
  fill.position.set(-4, 2.5, 2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xbfe9ff, 0.9);
  rim.position.set(-1, 3, -5);
  scene.add(rim);

  // Пол ловит только тень — фон остаётся CSS-градиентом.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.18 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const bokeh = createBokeh();
  scene.add(bokeh.group);

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // На узких экранах отодвигаем камеру, чтобы яйцо целиком влезало.
    const portrait = camera.aspect < 0.85;
    camera.position.z = portrait ? 8.6 : 6.6;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 1.4, 0);
  }

  return { renderer, scene, camera, resize, updateBackground: bokeh.update };
}

/** Медленно плывущие пастельные шарики на фоне — просто для настроения. */
function createBokeh() {
  const group = new THREE.Group();
  const colors = [0xffd9ec, 0xd9f0ff, 0xfff3c4, 0xdcffe0, 0xe8dcff];
  const balls = [];

  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(rand(0.18, 0.5), 20, 16),
      new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: rand(0.25, 0.5),
      })
    );
    mesh.position.set(rand(-7, 7), rand(-1, 5), rand(-9, -3));
    group.add(mesh);
    balls.push({ mesh, speed: rand(0.12, 0.35), phase: rand(0, Math.PI * 2) });
  }

  function update(dt, elapsed) {
    for (const ball of balls) {
      ball.mesh.position.y += ball.speed * dt;
      ball.mesh.position.x += Math.sin(elapsed * 0.4 + ball.phase) * dt * 0.25;
      if (ball.mesh.position.y > 5.5) {
        ball.mesh.position.y = -1.5;
        ball.mesh.position.x = rand(-7, 7);
      }
    }
  }

  return { group, update };
}
