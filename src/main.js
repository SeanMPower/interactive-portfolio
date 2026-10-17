import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { projects } from './data/projects.js';
import { Terrain } from './world/Terrain.js';
import { Roads } from './world/Roads.js';
import { Helicopter } from './world/Helicopter.js';
import { Landmarks, padPositionFor, PAD_RADIUS } from './world/Landmarks.js';
import { Props } from './world/Props.js';
import { Dust } from './world/Dust.js';
import { Controls } from './Controls.js';
import { FollowCamera } from './Camera.js';
import { Overlay } from './ui/Overlay.js';
import { Leaderboard } from './ui/Leaderboard.js';
import { RingRun, fmtTime } from './world/RingRun.js';

const HOVER_TO_OPEN = 12; // metres above a pad at which the "open" prompt appears

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const SKY = '#9ddcff';
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 220, 560);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 1200);

const hemi = new THREE.HemisphereLight('#dff4ff', '#6e8b4a', 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
const S = 60;
sun.shadow.camera.left = -S; sun.shadow.camera.right = S; sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- physics
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.4;
world.defaultContactMaterial.restitution = 0.05;

// ---------------------------------------------------------------- world
const flatSpots = [];
for (const p of projects) {
  const pad = padPositionFor(p);
  const site = { x: p.position[0], z: p.position[1], radius: 15 };
  const padSpot = { x: pad.x, z: pad.z, radius: PAD_RADIUS + 4, pairWith: site };
  flatSpots.push(site, padSpot);
}
flatSpots.push({ x: 0, z: 0, radius: 14, height: 1.6 }); // spawn plateau

const MAP = 520; // 4× the original area
const terrain = new Terrain({
  size: MAP,
  segments: 320,
  flatSpots,
  lakes: [{ x: -140, z: 50, radius: 40, depth: 4 }, { x: 70, z: 20, radius: 18, depth: 2.5 }, { x: 60, z: -170, radius: 22, depth: 3 }],
});
scene.add(terrain.mesh, terrain.water);
world.addBody(terrain.body);

const landmarks = new Landmarks(projects, terrain, world, scene, camera);
// Roads: a ring road through the landmark pads in order around the map, plus a spur from spawn to the nearest pad
const padStops = landmarks.items.map((it) => ({ x: it.pad.x, z: it.pad.z })).sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
const nearestPad = padStops.reduce((best, p) => (Math.hypot(p.x, p.z) < Math.hypot(best.x, best.z) ? p : best));
const roads = new Roads(terrain, scene, [
  { stops: padStops, closed: true },
  { stops: [{ x: 0, z: 0 }, nearestPad], closed: false },
]);
const playground = projects.find((p) => p.id === 'playground');
// Keep trees well clear of landmarks and pads, plus an extra clearing on the camera side (+x,+z)
// so nothing stands between the camera and what you're flying toward.
const CAM = Math.SQRT1_2;
const avoid = [];
for (const s of flatSpots) {
  avoid.push({ x: s.x, z: s.z, radius: s.radius + 9 });
  avoid.push({ x: s.x + CAM * 16, z: s.z + CAM * 16, radius: s.radius + 6 });
}
const props = new Props(terrain, world, scene, {
  avoid,
  roads,
  crateCenter: playground ? { x: playground.position[0], z: playground.position[1] } : null,
});

// Peak name labels
const peakLabels = terrain.peaks.filter((p) => p.label).map((p) => {
  const el = document.createElement('div');
  el.className = 'label peak';
  el.textContent = p.name;
  document.getElementById('labels').appendChild(el);
  return { el, pos: new THREE.Vector3(p.x, terrain.heightAt(p.x, p.z) + 4, p.z) };
});
const _pv = new THREE.Vector3();

const spawn = new THREE.Vector3(0, terrain.heightAt(0, 0) + 8, 0);
const heli = new Helicopter(world, scene, terrain, { spawn });
heli.setPads(landmarks.items.map((it) => ({ x: it.pad.x, z: it.pad.z, radius: PAD_RADIUS, top: it.padTop })));
const dust = new Dust(scene);
const ringRun = new RingRun(scene, terrain, {
  obstacles: props.trees,                                             // rings lift themselves clear of the canopy
  arrowReach: () => followCam.baseDistance * followCam.zoom * 0.3,    // guide arrow's "screen edge" distance tracks the zoom
});
window.__heli = heli;
window.__ringRun = ringRun; // handy for poking at tuning from the console

// ---------------------------------------------------------------- input / camera / ui
const controls = new Controls();
const followCam = new FollowCamera(camera, canvas);
followCam.snapTo(heli.position);

const hud = {
  speed: document.getElementById('speed-val'),
  alt: document.getElementById('alt-val'),
  rotor: document.getElementById('rotor'),
  rr: document.getElementById('ringrun'),
  rrChevron: document.getElementById('rr-chevron'),
  rrCount: document.getElementById('rr-count'),
  rrTime: document.getElementById('rr-time'),
  rrBest: document.getElementById('rr-best'),
  rrHint: document.getElementById('rr-hint'),
  rotorFill: document.getElementById('rotor-fill'),
  prompt: document.getElementById('prompt'),
  promptText: document.getElementById('prompt-text'),
  toast: document.getElementById('toast'),
  touchAction: document.getElementById('touch-action'),
};
let toastTimer = 0;
function toast(msg, seconds = 2.5) {
  hud.toast.textContent = msg;
  hud.toast.classList.remove('hidden');
  toastTimer = seconds;
}

let paused = true;
const overlay = new Overlay({
  onOpen: () => { paused = true; controls.setEnabled(false); },
  onClose: () => { paused = false; controls.setEnabled(true); },
});

// Ring Run leaderboard: opened from the HUD link, or automatically after a finished run
let pausedBeforeBoard = false;
const board = new Leaderboard({
  onOpen: () => { pausedBeforeBoard = paused; paused = true; controls.setEnabled(false); },
  onClose: () => { paused = pausedBeforeBoard; controls.setEnabled(!paused); },
});
document.getElementById('rr-board').addEventListener('click', () => { if (!overlay.isOpen) board.show(); });

let activeProject = null;
controls.onAction = () => {
  if (overlay.isOpen || board.isOpen || paused) return;
  if (activeProject && (activeProject.url || activeProject.embed)) {
    landmarks.markVisited(activeProject.id);
    overlay.open(activeProject);
  } else if (activeProject) {
    toast(activeProject.description || 'Nothing to open here.');
  }
};
controls.onEscape = () => { if (board.isOpen) board.close(); else overlay.close(); };
controls.onReset = () => {
  if (board.isOpen) return;
  const p = heli.position;
  const onMap = Math.abs(p.x) < terrain.half && Math.abs(p.z) < terrain.half && p.y > -20;
  if (onMap) heli.reset(new THREE.Vector3(p.x, terrain.heightAt(p.x, p.z) + 8, p.z), heli.yaw);
  else heli.reset(spawn, 0);
  hud.toast.classList.add('hidden');
};

// Start screen
const startEl = document.getElementById('start');
function start() {
  startEl.classList.add('fade');
  setTimeout(() => startEl.classList.add('hidden'), 500);
  paused = false;
}
document.getElementById('start-btn').addEventListener('click', start);
window.addEventListener('keydown', (e) => { if (!startEl.classList.contains('hidden') && (e.code === 'Space' || e.code === 'Enter')) start(); });

// Deep link: #project=id → fly to its pad and open it
const hashId = new URLSearchParams(location.hash.slice(1)).get('project');
if (hashId) {
  const it = landmarks.get(hashId);
  if (it) {
    heli.reset(new THREE.Vector3(it.pad.x, it.pad.y + 6, it.pad.z), it.pad.yaw);
    followCam.snapTo(heli.position);
    start();
    overlay.open(it.project);
  }
}

// ---------------------------------------------------------------- debug panel (?debug)
if (new URLSearchParams(location.search).has('debug')) {
  import('lil-gui').then(({ default: GUI }) => {
    const gui = new GUI({ title: 'Helicopter tuning' });
    const t = heli.tuning;
    const f = gui.addFolder('Flight');
    f.add(t, 'forwardAccel', 5, 80, 1);
    f.add(t, 'backwardAccel', 5, 60, 1);
    f.add(t, 'maxSpeed', 10, 80, 1);
    f.add(t, 'climbAccel', 2, 40, 0.5);
    f.add(t, 'descendAccel', 2, 40, 0.5);
    f.add(t, 'maxClimbRate', 2, 30, 0.5);
    f.add(t, 'yawSpeed', 0.5, 5, 0.05);
    f.add(t, 'inputEase', 1, 15, 0.1);
    f.add(t, 'drag', 0.1, 3, 0.05);
    f.add(t, 'altitudeHold', 0.5, 12, 0.1);
    f.add(t, 'minAltitude', 1, 10, 0.5);
    f.add(t, 'maxAltitude', 20, 150, 1);
    const l = gui.addFolder('Landing');
    l.add(t, 'spoolUp', 0.5, 6, 0.1).name('spool-up rate');
    l.add(t, 'spoolDown', 0.3, 4, 0.1).name('wind-down rate');
    l.add(t, 'landingRate', 1, 10, 0.5);
    const v = gui.addFolder('Visual tilt');
    v.add(t, 'pitchPerSpeed', 0, 0.04, 0.001);
    v.add(t, 'maxPitch', 0, 1, 0.01);
    v.add(t, 'maxRoll', 0, 1, 0.01);
    const c = gui.addFolder('Camera');
    c.add(followCam, 'baseDistance', 15, 100, 1);
    c.add(followCam, 'zoom', 0.5, 2.6, 0.05);
    c.add(followCam, 'smooth', 0.5, 12, 0.1);
  });
}

// ---------------------------------------------------------------- loop
const FIXED = 1 / 60;
let accumulator = 0;
let last = performance.now();
let elapsed = 0;
const _vel = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  if (!paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED && steps < 4) {
      heli.drive(controls.state, FIXED);
      world.step(FIXED);
      accumulator -= FIXED;
      steps++;
    }
    heli.sync(dt);

    // rotor wash kicks up dust when flying low (scaled by how fast the rotors are spinning)
    if (heli.altitude < 8 && heli.spool > 0.3 && Math.random() < 0.5 * heli.spool) {
      _vel.copy(heli.body.velocity);
      const gp = heli.groundPoint();
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 3;
      gp.x += Math.cos(a) * r; gp.z += Math.sin(a) * r;
      dust.emit(gp, _vel, 0.9 * (1 - heli.altitude / 8) * heli.spool);
    }
    // ring run
    const rr = ringRun.update(heli.position, dt, elapsed);
    if (rr === 'start') toast('Go! Follow the glowing rings', 2.5);
    else if (rr === 'ring') toast(`Ring ${ringRun.next} of ${ringRun.total}`, 1.2);
    else if (rr === 'finish' || rr === 'record') {
      toast(rr === 'record' ? `New best time · ${fmtTime(ringRun.lastResult)}!` : `Course complete · ${fmtTime(ringRun.lastResult)}`, 4);
      const finished = ringRun.lastResult;
      setTimeout(() => { if (!overlay.isOpen && !board.isOpen) board.promptEntry(finished * 1000); }, 900);
    }

    const ev = heli.takeEvent();
    if (ev === 'landed') toast('Landed · hold Space to spool up and take off', 3.5);
    if (ev === 'tookoff') hud.toast.classList.add('hidden');
    if (heli.position.y < -30) controls.onReset();
  }
  props.update(dt);
  dust.update(dt);

  _vel.copy(heli.body.velocity);
  const focusItem = activeProject ? landmarks.get(activeProject.id) : null;
  followCam.update(heli.position, _vel, dt, focusItem ? focusItem.group.position : null);

  // sun + shadow frustum follow the helicopter
  sun.position.set(heli.position.x + 50, heli.position.y + 80, heli.position.z + 25);
  sun.target.position.copy(heli.position);

  // pads / labels
  activeProject = landmarks.update(heli.position, dt, elapsed, HOVER_TO_OPEN);
  for (const pl of peakLabels) {
    _pv.copy(pl.pos).project(camera);
    const on = _pv.z < 1 && Math.abs(_pv.x) < 1.05 && Math.abs(_pv.y) < 1.05;
    pl.el.style.opacity = on ? 0.8 : 0;
    if (on) { pl.el.style.left = `${(_pv.x * 0.5 + 0.5) * window.innerWidth}px`; pl.el.style.top = `${(-_pv.y * 0.5 + 0.5) * window.innerHeight}px`; }
  }
  const canOpen = !!activeProject && !overlay.isOpen && !paused;
  hud.prompt.classList.toggle('hidden', !canOpen);
  hud.touchAction.classList.toggle('hidden', !canOpen);
  if (canOpen) {
    hud.promptText.textContent = activeProject.url ? `Open ${activeProject.title}` : activeProject.title;
    hud.touchAction.textContent = activeProject.url ? 'OPEN' : 'INFO';
  }

  hud.speed.textContent = Math.round(heli.speedKmh);
  hud.alt.textContent = Math.max(0, Math.round(heli.altitude));
  // ring-run panel: chevron points toward the next ring in screen space (camera looks from +x,+z)
  const b = ringRun.bearingTo(heli.position);
  if (b) {
    const dx = Math.sin(b.angle), dz = Math.cos(b.angle);
    const sx = (dx - dz) / Math.SQRT2, sy = (-dx - dz) / Math.SQRT2;
    hud.rrChevron.style.transform = `rotate(${(Math.atan2(sx, sy) * 180) / Math.PI - 90}deg)`;
  }
  const running = ringRun.state === 'running';
  hud.rr.classList.toggle('done', ringRun.state === 'done');
  hud.rrCount.textContent = running ? `${ringRun.next}/${ringRun.total}` : ringRun.state === 'done' ? `${ringRun.total}/${ringRun.total}` : `0/${ringRun.total}`;
  hud.rrTime.textContent = fmtTime(running ? ringRun.time : ringRun.lastResult ?? 0);
  hud.rrBest.textContent = ringRun.best ? `Best ${fmtTime(ringRun.best)}` : '';
  hud.rrHint.textContent = running
    ? (b ? `Next ring ${Math.round(b.distance)} m ${b.altitude > 3 ? '↑' : b.altitude < -3 ? '↓' : '→'}` : '')
    : ringRun.state === 'done' ? 'Fly through the green ring to go again' : 'Fly through the green ring to start';

  hud.rotor.classList.toggle('hidden', !heli.landed && heli.spool > 0.98);
  hud.rotorFill.style.width = `${Math.round(heli.spool * 100)}%`;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) hud.toast.classList.add('hidden'); }

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
