// BOECE — the 3D coin on the home screen.
// Nothing on the page waits for it: the coin simply appears, spinning, as soon as it is ready.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ===== Réglages =====
const SPIN_TURNS = 4;        // tours de la rotation d'arrivée
const SPIN_TIME = 2.6;       // durée de la rotation d'arrivée (s)
const FADE_TIME = 0.5;       // fondu d'apparition (s)
const SCROLL_TURN = Math.PI; // la pièce se retourne quand on quitte l'accueil (radians)
const DRAG_SPEED = 0.012;    // sensibilité quand on la fait tourner à la main
const FRICTION = 2.2;        // freinage après un lancer
// ====================

const V = new URL(import.meta.url).searchParams.get('v') || '0';
const stage = document.getElementById('stage');
const canvas = document.getElementById('coin');
const halo = document.getElementById('halo');
const hero = document.querySelector('.hero');

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

function fallback() {
  // no 3D available: show a still coin instead
  const img = new Image();
  img.src = 'img/coin-600.webp';
  img.alt = 'The BOECE coin';
  img.className = 'coin-fallback';
  stage.appendChild(img);
  if (halo) halo.style.opacity = '1';
}

if (!stage || !canvas) { /* nothing to do */ }
else if (!webglOK()) fallback();
else start();

function start() {
  const MAX_DPR = 3;
  let size = 0, dpr = 1;
  const measure = () => {
    size = Math.max(1, Math.round(stage.getBoundingClientRect().width));
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  };

  // give the canvas its real size BEFORE the 3D context exists (Safari keeps a wrong scale otherwise)
  measure();
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch { fallback(); return; }
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
  holder.scale.setScalar(halfH * 0.97);
  scene.add(holder);

  function resize() {
    measure();
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size, false);
    if (gl.drawingBufferWidth !== canvas.width) { // smaller buffer than asked: follow the real one
      dpr = gl.drawingBufferWidth / size;
      renderer.setPixelRatio(dpr);
      renderer.setSize(size, size, false);
    }
    wake();
  }

  // ---------- arrival spin: speeds up fast, then slows down for a long time ----------
  const N = 400, curve = new Float32Array(N + 1);
  {
    let acc = 0;
    for (let i = 1; i <= N; i++) {
      const u = i / N, r = Math.min(1, u / 0.1);
      acc += r * r * (3 - 2 * r) * (1 - u) * (1 - u);
      curve[i] = acc;
    }
    for (let i = 0; i <= N; i++) curve[i] /= acc;
  }
  const spinAt = (u) => {
    const x = Math.min(1, Math.max(0, u)) * N, i = Math.floor(x);
    return i >= N ? 1 : curve[i] + (curve[i + 1] - curve[i]) * (x - i);
  };

  // ---------- state ----------
  let ready = false;
  let rot = 0, introT = -1, fadeT = 0, vel = 0, target = null;
  let dragging = false, lastX = 0, lastMoveT = 0, moved = 0, dragVel = 0;
  let scrollTurn = 0, shownScroll = 0;
  let running = false, last = 0;

  function readScroll() {
    const h = hero ? hero.offsetHeight : window.innerHeight;
    const p = Math.min(1, Math.max(0, window.scrollY / (h * 0.8)));
    scrollTurn = p * p * (3 - 2 * p) * SCROLL_TURN;
  }

  function wake() {
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); }
  }

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    let busy = false;

    if (ready) {
      if (fadeT < FADE_TIME) { fadeT = Math.min(FADE_TIME, fadeT + dt); busy = true; }
      const f = fadeT / FADE_TIME;
      canvas.style.opacity = (f * f * (3 - 2 * f)).toFixed(3);

      if (introT >= 0 && !dragging) {
        introT += dt;
        const u = introT / SPIN_TIME;
        rot = SPIN_TURNS * 2 * Math.PI * spinAt(u);
        if (u >= 1) { introT = -1; rot = 0; } else busy = true;
      } else if (!dragging) {
        if (Math.abs(vel) > 0.6) {
          rot += vel * dt; vel *= Math.exp(-FRICTION * dt); busy = true;
        } else {
          if (target === null) target = Math.round(rot / Math.PI) * Math.PI;
          const d = target - rot;
          if (Math.abs(d) > 1e-4) { vel = 0; rot += d * (1 - Math.exp(-dt * 7)); busy = true; }
          else { rot = target; target = null; vel = 0; }
        }
      } else busy = true;

      // follow the page scroll smoothly
      const ds = scrollTurn - shownScroll;
      if (Math.abs(ds) > 1e-4) { shownScroll += ds * (1 - Math.exp(-dt * 10)); busy = true; }
      else shownScroll = scrollTurn;

      const angle = rot + shownScroll;
      holder.rotation.set(0, angle, 0);
      if (halo) {
        const c = Math.abs(Math.cos(angle));
        halo.style.opacity = canvas.style.opacity;
        halo.style.transform = `scaleX(${((c * 0.94 + 0.51) / 1.45).toFixed(4)})`;
      }
      renderer.render(scene, camera);
    }
    if (busy) requestAnimationFrame(tick); else running = false;
  }

  // ---------- interaction: drag to spin, tap to flip ----------
  canvas.addEventListener('pointerdown', (e) => {
    if (!ready || !e.isPrimary) return;
    dragging = true; moved = 0; dragVel = 0;
    lastX = e.clientX; lastMoveT = performance.now();
    introT = -1; target = null; vel = 0;
    canvas.setPointerCapture(e.pointerId);
    wake();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dts = Math.max(1, now - lastMoveT) / 1000;
    lastX = e.clientX; lastMoveT = now;
    moved += Math.abs(dx);
    rot += dx * DRAG_SPEED;
    dragVel = dragVel * 0.6 + (dx * DRAG_SPEED / dts) * 0.4;
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (moved < 5) { target = Math.round(rot / Math.PI) * Math.PI + Math.PI; vel = 0; }
    else { vel = performance.now() - lastMoveT > 120 ? 0 : dragVel; target = null; }
    wake();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('keydown', (e) => {
    if (!ready || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    target = Math.round(rot / Math.PI) * Math.PI + Math.PI;
    wake();
  });

  window.addEventListener('scroll', () => { readScroll(); if (ready) wake(); }, { passive: true });
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(stage);

  // ---------- load ----------
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(`models/coin.glb?v=${V}`, (gltf) => {
    const coin = gltf.scene;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    coin.traverse((o) => {
      if (!o.isMesh) return;
      for (const k of ['map', 'normalMap']) {
        const t = o.material[k];
        if (t) { t.anisotropy = maxAniso; t.needsUpdate = true; } // sharp at an angle
      }
    });
    const box = new THREE.Box3().setFromObject(coin);
    const s = box.getSize(new THREE.Vector3());
    coin.position.sub(box.getCenter(new THREE.Vector3()));
    const inner = new THREE.Group();
    inner.add(coin);
    inner.scale.setScalar(2 / Math.max(s.x, s.y)); // radius 1
    holder.add(inner);

    resize();
    readScroll();
    shownScroll = scrollTurn;
    // put everything on the GPU first, while the canvas is still invisible
    renderer.compile(scene, camera);
    for (const a of [1.2, 2.4, 0]) { holder.rotation.set(0, a, 0); renderer.render(scene, camera); }

    requestAnimationFrame(() => {
      ready = true;
      canvas.classList.add('is-ready');
      canvas.tabIndex = 0;
      introT = 0;
      wake();
    });
  }, undefined, () => fallback());
}
