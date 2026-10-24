// BOECE — the 3D coin of the hero.
// The page never waits for this file: a still image of the coin is shown first,
// and the 3D coin silently takes its place once it is ready.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ===== Réglages =====
const SPIN_TURNS = 4;        // tours de la rotation d'arrivée
const SPIN_TIME = 2.6;       // durée de la rotation d'arrivée (s)
const DRAG_SPEED = 0.012;    // sensibilité quand on fait tourner la pièce à la main
const FRICTION = 2.2;        // freinage après un lancer
// ====================

const V = new URL(import.meta.url).searchParams.get('v') || '0';
const POSTER_MODE = new URLSearchParams(location.search).has('poster'); // used once to make img/coin.webp

const stage = document.getElementById('coin-stage');
const canvas = document.getElementById('coin');
const poster = document.getElementById('coin-poster');
const halo = document.getElementById('coin-halo');
const ca = document.getElementById('ca');

// ---------- contract address copy (works even if WebGL is unavailable) ----------
const copyBtn = document.getElementById('ca-copy');
if (copyBtn && ca) {
  copyBtn.addEventListener('click', async () => {
    const text = ca.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(ca);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copyBtn.textContent = 'Selected';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1600);
  });
}

// ---------- 3D ----------
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

if (stage && canvas && webglAvailable()) start();

function start() {
  const MAX_DPR = 2.5;

  // size the canvas BEFORE creating the context (Safari keeps a wrong scale otherwise)
  let size = 0, dpr = 1;
  function measure() {
    size = Math.round(stage.getBoundingClientRect().width);
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  }
  measure();
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch { return; } // the still image simply stays
  const gl = renderer.getContext();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfff3dc, 2.6);
  key.position.set(-3, 3, 5);
  const fill = new THREE.DirectionalLight(0xfff8ea, 1.0);
  fill.position.set(3, -1, 6);
  scene.add(key, fill);

  const CAM_Z = 10, FOV = 25;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);
  const halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_Z;

  const holder = new THREE.Group();
  holder.scale.setScalar(halfH * 0.97); // coin fills the stage, with a hair of margin
  scene.add(holder);

  function resize() {
    measure();
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size, false);
    // some browsers give a smaller drawing buffer than asked: follow the real one
    if (gl.drawingBufferWidth !== canvas.width) {
      dpr = gl.drawingBufferWidth / size;
      renderer.setPixelRatio(dpr);
      renderer.setSize(size, size, false);
    }
    requestRender();
  }

  // ---------- motion state ----------
  // the arrival spin: speed rises quickly, then slows down for a long time
  const N = 400, curve = new Float32Array(N + 1);
  {
    let acc = 0;
    curve[0] = 0;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const ramp = Math.min(1, u / 0.1);
      const easeRamp = ramp * ramp * (3 - 2 * ramp);
      acc += easeRamp * (1 - u) * (1 - u);
      curve[i] = acc;
    }
    for (let i = 0; i <= N; i++) curve[i] /= acc;
  }
  const spinAt = (u) => {
    const x = Math.min(1, Math.max(0, u)) * N, i = Math.floor(x);
    return i >= N ? 1 : curve[i] + (curve[i + 1] - curve[i]) * (x - i);
  };

  let rot = 0;            // current angle
  let introT = -1;        // time into the arrival spin, -1 = not started
  let vel = 0;            // free spin speed (rad/s), after a throw
  let target = null;      // angle we are settling to
  let dragging = false, lastX = 0, lastMoveT = 0, moved = 0, dragVel = 0;
  let running = false, last = 0;

  function updateHalo() {
    if (!halo) return;
    // the glow follows the coin: round from the front, thin from the side
    const c = Math.abs(Math.cos(rot));
    halo.style.transform = `scaleX(${((c * 0.94 + 0.51) / 1.45).toFixed(4)})`;
  }

  function requestRender() {
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); }
  }

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    let busy = false;

    if (introT >= 0 && !dragging) {
      introT += dt;
      const u = introT / SPIN_TIME;
      rot = SPIN_TURNS * 2 * Math.PI * spinAt(u);
      if (u >= 1) { introT = -1; rot = 0; } else busy = true;
    } else if (!dragging) {
      if (Math.abs(vel) > 0.6) {
        rot += vel * dt;
        vel *= Math.exp(-FRICTION * dt);
        busy = true;
      } else {
        if (target === null) target = Math.round(rot / Math.PI) * Math.PI; // nearest face
        const d = target - rot;
        if (Math.abs(d) > 1e-4) {
          vel = 0;
          rot += d * (1 - Math.exp(-dt * 7));
          busy = true;
        } else { rot = target; target = null; vel = 0; }
      }
    } else busy = true;

    holder.rotation.set(0, rot, 0);
    updateHalo();
    renderer.render(scene, camera);
    if (busy) requestAnimationFrame(tick); else running = false;
  }

  // ---------- interaction: drag to spin, tap to flip ----------
  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    dragging = true; moved = 0; dragVel = 0;
    lastX = e.clientX; lastMoveT = performance.now();
    introT = -1; target = null; vel = 0;
    canvas.setPointerCapture(e.pointerId);
    requestRender();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dtm = Math.max(1, now - lastMoveT) / 1000;
    lastX = e.clientX; lastMoveT = now;
    moved += Math.abs(dx);
    rot += dx * DRAG_SPEED;
    dragVel = dragVel * 0.6 + (dx * DRAG_SPEED / dtm) * 0.4;
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (moved < 5) { target = Math.round(rot / Math.PI) * Math.PI + Math.PI; vel = 0; } // tap: flip
    else { vel = performance.now() - lastMoveT > 120 ? 0 : dragVel; target = null; }
    requestRender();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      target = Math.round(rot / Math.PI) * Math.PI + Math.PI;
      requestRender();
    }
  });

  // ---------- load ----------
  new GLTFLoader().load(`models/coin.glb?v=${V}`, (gltf) => {
    const coin = gltf.scene;
    const box = new THREE.Box3().setFromObject(coin);
    const s = box.getSize(new THREE.Vector3());
    coin.position.sub(box.getCenter(new THREE.Vector3()));
    const inner = new THREE.Group();
    inner.add(coin);
    inner.scale.setScalar(2 / Math.max(s.x, s.y)); // radius 1
    holder.add(inner);

    resize();
    // upload everything to the GPU before showing anything
    renderer.compile(scene, camera);
    for (const a of [1.2, 2.4, 0]) { holder.rotation.set(0, a, 0); renderer.render(scene, camera); }

    if (POSTER_MODE) { canvas.classList.add('is-live'); document.documentElement.dataset.posterReady = '1'; return; }

    // same pose as the still image: swap invisibly, then spin
    requestAnimationFrame(() => {
      canvas.classList.add('is-live');
      if (poster) poster.classList.add('is-hidden');
      stage.classList.add('is-interactive');
      canvas.tabIndex = 0;
      introT = 0;
      requestRender();
    });
  }, undefined, () => { /* model failed: keep the still image */ });

  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(stage);
}
