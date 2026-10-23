import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ===== Réglages =====
const SPIN_TURNS = 5;        // nombre de tours pendant la rotation rapide
const SPIN_TIME = 2.8;       // durée de la rotation (s)
const PAUSE_TIME = 0.35;     // pause sur la face avant de monter (s)
const MOVE_TIME = 1.2;       // durée de la montée (s)
const START_SIZE = 0.62;     // diamètre de départ (part du plus petit côté de l'écran)
const END_SCALE = 0.75;      // taille finale par rapport à la taille de départ
const GAP = 0.05;            // espace entre la pièce et "BOECE" (part de la hauteur)
// ====================

const canvas = document.getElementById('coin');
const title = document.getElementById('title');
const shadow = document.getElementById('shadow');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xfff3dc, 2.0);
key.position.set(-3, 3, 5);
scene.add(key);

const CAM_Z = 10;
const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 100);
camera.position.set(0, 0, CAM_Z);

const holder = new THREE.Group();
scene.add(holder);

// ----- layout (in pixels) -----
let W = 1, H = 1, R0 = 1, R1 = 1, endY = 0, pxToWorld = 1;
function layout() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H); // also sets the canvas CSS size, so it always matches
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z;
  pxToWorld = halfH / (H / 2);

  R0 = (Math.min(W, H) * START_SIZE) / 2;
  R1 = R0 * END_SCALE;
  const gap = H * GAP;
  const titleH = title.offsetHeight;
  const groupH = 2 * R1 + gap + titleH;
  const top = (H - groupH) / 2;
  endY = top + R1;                                   // final coin centre
  title.style.top = `${top + 2 * R1 + gap + titleH / 2}px`;
}
window.addEventListener('resize', layout);
layout();
document.fonts?.ready.then(layout);

// ----- easing -----
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// ----- load the coin -----
let coin = null, last = 0, t = 0;
new GLTFLoader().load('boece_coin.glb', (gltf) => {
  coin = gltf.scene;
  const box = new THREE.Box3().setFromObject(coin);
  const size = box.getSize(new THREE.Vector3());
  coin.position.sub(box.getCenter(new THREE.Vector3()));
  const inner = new THREE.Group();
  inner.add(coin);
  inner.scale.setScalar(2 / Math.max(size.x, size.y)); // radius 1
  holder.add(inner);
  // prepare the GPU first, then start the clock on the first real frame,
  // and only once the tab is visible, so the intro is never skipped
  renderer.compile(scene, camera);
  renderer.render(scene, camera); // uploads the textures before the clock starts
  const go = () => requestAnimationFrame((now) => { last = now; frame(now); });
  if (document.hidden) {
    document.addEventListener('visibilitychange', function once() {
      if (!document.hidden) { document.removeEventListener('visibilitychange', once); go(); }
    });
  } else go();
});

function frame(now) {
  // time advances at most 1/30 s per frame: a slow frame slows the intro down
  // instead of skipping part of it
  t += Math.min((now - last) / 1000, 1 / 30);
  last = now;

  // 1. fast spin that slows down and lands on the front face
  const spinU = clamp01(t / SPIN_TIME);
  const rot = SPIN_TURNS * 2 * Math.PI * easeOutCubic(spinU);

  // 2. move up and shrink, uncovering the title
  const moveU = easeInOutCubic(clamp01((t - SPIN_TIME - PAUSE_TIME) / MOVE_TIME));
  const r = THREE.MathUtils.lerp(R0, R1, moveU);
  const cy = THREE.MathUtils.lerp(H / 2, endY, moveU);

  holder.position.set(0, (H / 2 - cy) * pxToWorld, 0);

  // shadow follows the coin, slightly below it
  const sh = r * 2.0;
  const sw = sh * (0.3 + 0.7 * Math.abs(Math.cos(rot)));   // narrower when the coin is edge-on
  shadow.style.width = `${sw}px`;
  shadow.style.height = `${sh}px`;
  shadow.style.transform = `translate(${W / 2 - sw / 2}px, ${cy - sh / 2 + r * 0.14}px)`;
  shadow.style.opacity = '1';
  holder.scale.setScalar(r * pxToWorld);

  // gentle sway once settled, so the gold keeps catching the light
  const settled = clamp01((t - SPIN_TIME - PAUSE_TIME - MOVE_TIME) / 1.5);
  const idle = settled * Math.sin((t - SPIN_TIME) * 0.9) * 0.12;
  holder.rotation.set(0, rot + idle, 0);

  const reveal = clamp01((moveU - 0.3) / 0.7);
  title.style.opacity = reveal;
  title.style.transform = `translateY(calc(-50% + ${(1 - reveal) * 14}px))`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
