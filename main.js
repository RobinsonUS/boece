import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ===== Réglages =====
const SPIN_TURNS = 4;        // nombre de tours pendant la rotation rapide
const SPIN_TIME = 3.3;       // durée de la rotation (s)
const PAUSE_TIME = 0.35;     // pause sur la face avant de monter (s)
const MOVE_TIME = 1.2;       // durée de la montée (s)
const START_SIZE = 0.62;     // diamètre de départ (part du plus petit côté de l'écran)
const END_SCALE = 0.75;      // taille finale par rapport à la taille de départ
const GAP = 0.08;            // espace entre la pièce et "BOECE" (part de la hauteur)
const LIFT = 0.05;           // remonte l'ensemble pièce + titre (part de la hauteur)
const TITLE_MARGIN = 0.05;   // le titre apparaît dès que la pièce est assez haute (part de l'espace GAP)
const TITLE_TIME = 0.7;      // durée d'apparition du titre (s)
const TEXT_HEIGHT = 0.11;    // hauteur des lettres (part de la largeur, plafonnée)
const TEXT_SPACING = 0.16;   // espace entre les lettres (part de la hauteur des lettres)
// ====================

// same version number as in index.html, so the models are never served from an old cache
const V = new URL(import.meta.url).searchParams.get('v') || '0';

// phones and small tablets get the light model and a lower resolution
const lowEnd = window.matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
const MODEL = lowEnd ? 'boece_coin_lite.glb' : 'boece_coin.glb';
const MAX_DPR = lowEnd ? 1.5 : 2;

const canvas = document.getElementById('coin');
const shadow = document.getElementById('shadow');
const halo = document.getElementById('halo');

// Give the canvas its final size BEFORE the 3D context exists.
// Safari keeps the wrong display scale when a WebGL canvas is resized right after
// creation (default 300x150), which drew everything zoomed into the top-right corner.
{
  const r0 = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  canvas.width = Math.floor(window.innerWidth * r0);
  canvas.height = Math.floor(window.innerHeight * r0);
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
const gl = renderer.getContext();
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xfff3dc, 2.6);
key.position.set(-3, 3, 5);
scene.add(key);
const fill = new THREE.DirectionalLight(0xfff8ea, 1.0);
fill.position.set(3, -1, 6);
scene.add(fill);

const CAM_Z = 10;
const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 100);
camera.position.set(0, 0, CAM_Z);

const holder = new THREE.Group();   // the coin
const word = new THREE.Group();     // the gold word
scene.add(holder, word);

// ----- size: always match the real screen and the real drawing buffer -----
let W = 0, H = 0, dpr = 1, R0 = 1, R1 = 1, endY = 0, textY = 0, textPx = 0, pxToWorld = 1;

function layout() {
  W = window.innerWidth; H = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H);
  // some browsers (Safari) silently give a smaller drawing buffer than asked;
  // if so, use the real one, otherwise the image is drawn zoomed into a corner
  if (gl.drawingBufferWidth !== canvas.width || gl.drawingBufferHeight !== canvas.height) {
    dpr = Math.min(gl.drawingBufferWidth / W, gl.drawingBufferHeight / H);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H);
  }
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z;
  pxToWorld = halfH / (H / 2);

  R0 = (Math.min(W, H) * START_SIZE) / 2;
  R1 = R0 * END_SCALE;
  textPx = Math.min(W * TEXT_HEIGHT, 130, H * 0.14);
  const gap = H * GAP;
  const groupH = 2 * R1 + gap + textPx;
  const top = Math.max(H * 0.04, (H - groupH) / 2 - H * LIFT);
  endY = top + R1;
  textY = top + 2 * R1 + gap + textPx / 2;
  fitWord();
}

function sizeIsWrong() {
  return window.innerWidth !== W || window.innerHeight !== H ||
    gl.drawingBufferWidth !== canvas.width || gl.drawingBufferHeight !== canvas.height ||
    Math.abs(canvas.clientWidth - W) > 1 || Math.abs(canvas.clientHeight - H) > 1;
}

window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
canvas.addEventListener('webglcontextrestored', layout);

// ----- easing -----
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
const easeOutQuart = (u) => 1 - Math.pow(1 - u, 4);  // longer slow-down at the end
const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// ----- the gold word, modelled in 3D -----
const goldMat = new THREE.MeshStandardMaterial({
  color: 0xe0ac48,
  metalness: 1,
  roughness: 0.3,
  transparent: true,
  opacity: 0,
});
// fine hammered grain, like the coin
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 40;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  goldMat.bumpMap = tex;
  goldMat.bumpScale = 0.6;
}

let wordWidth = 1, wordHeight = 1;
function buildWord(font) {
  const size = 1;
  const geos = [...'BOECE'].map((ch) => {
    const g = new TextGeometry(ch, {
      font, size, height: 0.16, depth: 0.16, curveSegments: 10, // 'height' for three r160, 'depth' for newer
      bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 5,
    });
    g.computeBoundingBox();
    return g;
  });
  let x = 0;
  const gap = TEXT_SPACING * size;
  for (const g of geos) {
    const b = g.boundingBox;
    const m = new THREE.Mesh(g, goldMat);
    m.position.x = x - b.min.x;
    x += b.max.x - b.min.x + gap;
    word.add(m);
  }
  word.scale.setScalar(1); // measure at real size
  word.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(word);
  wordWidth = box.max.x - box.min.x;
  wordHeight = box.max.y - box.min.y;
  const center = box.getCenter(new THREE.Vector3());
  word.children.forEach((m) => { m.position.x -= center.x; m.position.y -= center.y; m.position.z -= box.max.z; });
  fitWord();
}

function fitWord() {
  // letter height in pixels, but never wider than 86% of the screen
  let s = textPx / wordHeight;
  s = Math.min(s, (W * 0.86) / wordWidth);
  word.scale.setScalar(s * pxToWorld);
}

// ----- load everything, then play -----
let ready = 0, last = 0, t = 0, titleStart = null;
// third safety net: what switching tabs does by hand, i.e. make the browser
// redraw the canvas layer from scratch
function recomposite() {
  canvas.style.display = 'none';
  void canvas.offsetHeight;
  canvas.style.display = 'block';
}
window.addEventListener('pageshow', () => { layout(); recomposite(); });

function loaded() {
  if (++ready < 2) return;
  layout();
  renderer.compile(scene, camera);
  renderer.render(scene, camera); // uploads textures before the clock starts
  const go = () => requestAnimationFrame((now) => {
    // second safety net: force Safari to rebuild the canvas surface once, at the real size
    renderer.setSize(W, H + 1);
    renderer.setSize(W, H);
    last = now;
    frame(now);
    recomposite();
    setTimeout(recomposite, 400);
  });
  if (document.hidden) {
    document.addEventListener('visibilitychange', function once() {
      if (!document.hidden) { document.removeEventListener('visibilitychange', once); go(); }
    });
  } else go();
}

new GLTFLoader().load(`${MODEL}?v=${V}`, (gltf) => {
  const coin = gltf.scene;
  const box = new THREE.Box3().setFromObject(coin);
  const size = box.getSize(new THREE.Vector3());
  coin.position.sub(box.getCenter(new THREE.Vector3()));
  const inner = new THREE.Group();
  inner.add(coin);
  inner.scale.setScalar(2 / Math.max(size.x, size.y)); // radius 1
  holder.add(inner);
  loaded();
});

new TTFLoader().load(`fonts/cinzel-latin-700-normal.woff?v=${V}`, (json) => {
  buildWord(new Font(json));
  loaded();
});

layout();

// ----- animation -----
function frame(now) {
  if (sizeIsWrong()) layout();

  // time advances at most 1/30 s per frame: a slow frame slows the intro down instead of skipping it
  t += Math.min((now - last) / 1000, 1 / 30);
  last = now;

  // 1. fast spin that slows down and lands exactly on the front face, then stays still
  const spinU = clamp01(t / SPIN_TIME);
  const rot = SPIN_TURNS * 2 * Math.PI * easeOutCubic(spinU);

  // 2. move up and shrink, uncovering the word
  const moveU = easeInOutCubic(clamp01((t - SPIN_TIME - PAUSE_TIME) / MOVE_TIME));
  const r = THREE.MathUtils.lerp(R0, R1, moveU);
  const cy = THREE.MathUtils.lerp(H / 2, endY, moveU);

  holder.position.set(0, (H / 2 - cy) * pxToWorld, 0);
  holder.scale.setScalar(r * pxToWorld);
  holder.rotation.set(0, spinU < 1 ? rot : 0, 0);

  // shadow follows the coin
  const sh = r * 2.0;
  const sw = sh * (0.3 + 0.7 * Math.abs(Math.cos(rot)));
  shadow.style.width = `${sw}px`;
  shadow.style.height = `${sh}px`;
  shadow.style.transform = `translate(${W / 2 - sw / 2}px, ${cy - sh / 2 + r * 0.14}px)`;
  shadow.style.opacity = '1';

  // darker glow centred on the coin
  const hs = r * 2.9;
  halo.style.width = `${hs}px`;
  halo.style.height = `${hs}px`;
  halo.style.transform = `translate(${W / 2 - hs / 2}px, ${cy - hs / 2}px)`;
  halo.style.opacity = '1';

  // 3. the word rises into place
  // only once the coin has fully settled: the coin and the word never touch
  // the word starts as soon as the coin's bottom is clear of it: they never touch
  const coinBottom = cy + r;
  const wordTop = textY - textPx / 2 - 14;
  if (titleStart === null && moveU > 0 && coinBottom < wordTop - H * GAP * TITLE_MARGIN) titleStart = t;
  const reveal = titleStart === null ? 0 : easeOutCubic(clamp01((t - titleStart) / TITLE_TIME));
  word.position.set(0, (H / 2 - textY - (1 - reveal) * 14) * pxToWorld, 0);
  goldMat.opacity = reveal;
  const solid = reveal >= 1;
  if (goldMat.transparent === solid) { goldMat.transparent = !solid; goldMat.needsUpdate = true; }
  word.visible = reveal > 0;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
