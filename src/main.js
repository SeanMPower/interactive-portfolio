import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { projects } from './data/projects.js';
import { Terrain } from './world/Terrain.js';
import { Roads } from './world/Roads.js';
import { Helicopter } from './world/Helicopter.js';
import { Pilot } from './world/Pilot.js';
import { Dock } from './world/Dock.js';
import { Submarine } from './underwater/Submarine.js';
import { Underwater } from './underwater/Underwater.js';
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
const LAKES = [{ x: -140, z: 50, radius: 40, depth: 4 }, { x: 70, z: 20, radius: 18, depth: 2.5 }, { x: 60, z: -170, radius: 22, depth: 3 }];
const terrain = new Terrain({
  size: MAP,
  segments: 320,
  flatSpots,
  lakes: LAKES,
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
// The dock on the big lake, with the submarine moored at its end (built before the props so trees keep clear)
const dock = new Dock(terrain, world, scene, LAKES[0], { toward: { x: 0, z: 0 } });
avoid.push({ x: dock.center.x, z: dock.center.z, radius: 16 });
const sub = new Submarine();
sub.place(dock.moor, dock.moorYaw);
scene.add(sub.group);
const underwater = new Underwater(sub, camera);
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
const padColliders = landmarks.items.map((it) => ({ x: it.pad.x, z: it.pad.z, radius: PAD_RADIUS, top: it.padTop }));
heli.setPads(padColliders);
const pilot = new Pilot(world, scene, terrain);
pilot.setPads(padColliders);
pilot.setPlatforms([dock.platform]);
const dust = new Dust(scene);
const ringRun = new RingRun(scene, terrain, {
  obstacles: props.trees,                                             // rings lift themselves clear of the canopy
  arrowReach: () => followCam.baseDistance * followCam.zoom * 0.3,    // guide arrow's "screen edge" distance tracks the zoom
  camera,                                                             // …and is clamped to the actual viewport (phones)
});
window.__heli = heli;
window.__camera = camera;
window.__pilot = pilot;
window.__sub = sub;
window.__underwater = underwater;
window.__dock = dock;
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
  rrHint: document.getElementById('rr-hint'),
  rotorFill: document.getElementById('rotor-fill'),
  prompt: document.getElementById('prompt'),
  promptText: document.getElementById('prompt-text'),
  prompt2: document.getElementById('prompt2'),
  prompt2Text: document.getElementById('prompt2-text'),
  touchSecondary: document.getElementById('touch-secondary'),
  altUnit: document.getElementById('alt-unit'),
  challenge: document.getElementById('challenge'),
  trophy: document.getElementById('trophy-btn'),
  pearlhunt: document.getElementById('pearlhunt'),
  pearlsVal: document.getElementById('pearls-val'),
  pearlHint: document.getElementById('pearl-hint'),
  pearlArrow: document.getElementById('pearl-arrow'),
  labels: document.getElementById('labels'),
  dive: document.getElementById('dive'),
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
// Challenge panel: closed by default; the trophy toggles it, and it pops open on its own when a run starts or you dive
let challengeOpen = false;
function setChallenge(open) {
  challengeOpen = open;
  hud.challenge.classList.toggle('hidden', !open);
  hud.trophy.setAttribute('aria-expanded', String(open));
  hud.trophy.classList.toggle('open', open);
}
hud.trophy.addEventListener('click', () => setChallenge(!challengeOpen));

let activeProject = null;
controls.onAction = () => {
  if (overlay.isOpen || board.isOpen || paused) return;
  if (mode === 'subdocked') { startDive(); return; }
  if (activeProject && (activeProject.url || activeProject.embed)) {
    landmarks.markVisited(activeProject.id);
    overlay.open(activeProject);
  } else if (activeProject) {
    toast(activeProject.description || 'Nothing to open here.');
  }
};
// ---------------------------------------------------------------- on foot
// mode: 'heli' (flying / sitting in the cockpit) | 'exiting' | 'foot' (running around) | 'boarding'
//     | 'subboarding' | 'subdocked' (in the sub at the dock) | 'diving' | 'sub' (in the cave) | 'surfacing' | 'subexiting'
let mode = 'heli';
const SUB_CAM_SCALE = 0.8;
const SUB_BOARD_RANGE = 4.5;
let anim = null;                 // hop animation between cockpit and ground: { t, duration, from, to, arc, yaw, onDone }
const FOOT_CAM_SCALE = 0.45;     // camera comes in closer when you're on foot
const BOARD_RANGE = 5;           // metres from the helicopter at which you can climb back in
const NO_INPUT = {};
const _seat = new THREE.Vector3();
const _step = new THREE.Vector3();

/** World position of the pilot's seat and of the spot on the ground just outside the door (right-hand side). */
function cockpitPoints() {
  const rx = Math.cos(heli.yaw), rz = -Math.sin(heli.yaw);   // helicopter's local +x in world space
  const fx = Math.sin(heli.yaw), fz = Math.cos(heli.yaw);    // nose direction
  const hp = heli.position;
  _seat.set(hp.x + rx * 0.5 + fx * 0.6, hp.y - 1.1, hp.z + rz * 0.5 + fz * 0.6);
  const gx = hp.x + rx * 2.9 + fx * 0.6, gz = hp.z + rz * 2.9 + fz * 0.6;
  _step.set(gx, pilot.groundAt(gx, gz), gz);
  return { seat: _seat, step: _step, outYaw: Math.atan2(rx, rz) };
}
const canExit = () => mode === 'heli' && heli.landed && heli.spool < 0.05;
const canBoard = () => mode === 'foot' && Math.hypot(pilot.position.x - heli.position.x, pilot.position.z - heli.position.z) < BOARD_RANGE;
const canBoardSub = () => mode === 'foot' && Math.hypot(pilot.position.x - dock.boardSpot.x, pilot.position.z - dock.boardSpot.z) < SUB_BOARD_RANGE;
const canExitSub = () => mode === 'subdocked';
const inSub = () => mode === 'sub' || mode === 'subdocked' || mode === 'diving' || mode === 'surfacing' || mode === 'subboarding' || mode === 'subexiting';

function startExit() {
  const { seat, step, outYaw } = cockpitPoints();
  mode = 'exiting';
  pilot.group.visible = true;
  pilot.group.position.copy(seat);
  anim = {
    t: 0, duration: 0.75, arc: 1.1, yaw: outYaw, from: seat.clone(), to: step.clone(),
    onDone: () => {
      pilot.activate(step, outYaw);
      mode = 'foot';
      followCam.targetScale = FOOT_CAM_SCALE;
      toast('On foot · WASD to run · Space to jump · F to climb back in · there\'s a submarine at the lake dock', 5);
    },
  };
}
function startBoard() {
  const { seat } = cockpitPoints();
  pilot.deactivate();
  mode = 'boarding';
  const from = pilot.position.clone();
  anim = {
    t: 0, duration: 0.6, arc: 0.9, yaw: Math.atan2(seat.x - from.x, seat.z - from.z), from, to: seat.clone(),
    onDone: () => {
      pilot.group.visible = false;
      mode = 'heli';
      followCam.targetScale = 1;
      toast('Buckled in · hold Space to spool up and take off', 3);
    },
  };
}
// ---- submarine
function startBoardSub() {
  const hatch = sub.hatchPoint();
  pilot.deactivate();
  mode = 'subboarding';
  const from = pilot.position.clone();
  anim = {
    t: 0, duration: 0.7, arc: 1.4, yaw: Math.atan2(hatch.x - from.x, hatch.z - from.z), from, to: hatch.clone(),
    onDone: () => {
      pilot.group.visible = false;
      mode = 'subdocked';
      followCam.targetScale = SUB_CAM_SCALE;
      toast('Hatch sealed · E to dive · F to climb out', 3.5);
    },
  };
}
function startExitSub() {
  const hatch = sub.hatchPoint();
  mode = 'subexiting';
  pilot.group.visible = true;
  pilot.group.position.copy(hatch);
  const to = dock.boardSpot.clone();
  anim = {
    t: 0, duration: 0.7, arc: 1.2, yaw: Math.atan2(to.x - hatch.x, to.z - hatch.z), from: hatch.clone(), to,
    onDone: () => {
      pilot.activate(to, Math.atan2(to.x - hatch.x, to.z - hatch.z));
      mode = 'foot';
      followCam.targetScale = FOOT_CAM_SCALE;
    },
  };
}
function fade(on) { hud.dive.classList.toggle('on', on); }
function startDive() {
  mode = 'diving';
  fade(true);
  setTimeout(() => {
    scene.remove(sub.group);
    underwater.enter();
    followCam.targetScale = SUB_CAM_SCALE;
    followCam.snapTo(sub.position);
    setTimeout(() => { fade(false); mode = 'sub'; setChallenge(true); toast(`Dive! Find the ${underwater.cave.total} pearls · hold Space at the surface to come back up`, 5); }, 250);
  }, 750);
}
function startSurface() {
  mode = 'surfacing';
  fade(true);
  setTimeout(() => {
    underwater.exit();
    sub.place(dock.moor, dock.moorYaw);
    scene.add(sub.group);
    followCam.snapTo(sub.position);
    setTimeout(() => { fade(false); mode = 'subdocked'; toast('Surfaced · F to climb out · E to dive again', 3.5); }, 250);
  }, 750);
}

/** Put the pilot back beside the helicopter (fell in a lake, off the map, pressed R). */
function respawnPilot(msg) {
  const { step, outYaw } = cockpitPoints();
  pilot.teleport(step);
  pilot.yaw = outYaw;
  if (msg) toast(msg, 2.5);
}
controls.onSecondary = () => {
  if (overlay.isOpen || board.isOpen || paused) return;
  if (canExit()) startExit();
  else if (canBoard()) startBoard();
  else if (canBoardSub()) startBoardSub();
  else if (canExitSub()) startExitSub();
};

controls.onEscape = () => { if (board.isOpen) board.close(); else overlay.close(); };
controls.onReset = () => {
  if (board.isOpen) return;
  if (mode === 'foot') { respawnPilot(); hud.toast.classList.add('hidden'); return; }
  if (mode === 'sub') { sub.place(new THREE.Vector3(0, -7, -6), 0); followCam.snapTo(sub.position); hud.toast.classList.add('hidden'); return; }
  if (mode !== 'heli') return;
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
    const pf = gui.addFolder('Pilot (on foot)');
    const pt = pilot.tuning;
    pf.add(pt, 'runSpeed', 2, 20, 0.5);
    pf.add(pt, 'accel', 5, 120, 1);
    pf.add(pt, 'jumpSpeed', 2, 14, 0.25);
    pf.add(pt, 'turnSpeed', 2, 30, 0.5);
    pf.add(pt, 'stride', 0.5, 5, 0.1);
    const sf = gui.addFolder('Submarine');
    const st = sub.tuning;
    sf.add(st, 'forwardAccel', 2, 30, 0.5);
    sf.add(st, 'maxSpeed', 2, 30, 0.5);
    sf.add(st, 'vertAccel', 1, 20, 0.5);
    sf.add(st, 'maxVert', 1, 12, 0.5);
    sf.add(st, 'yawSpeed', 0.3, 4, 0.05);
    sf.add(st, 'drag', 0.2, 4, 0.05);
    sf.add(st, 'radius', 1, 5, 0.1).name('hull radius');
    sf.add(underwater.scene.fog, 'density', 0.005, 0.06, 0.001).name('fog density');
    sf.add(underwater.tuning, 'bubbleRate', 0, 60, 1);
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
      heli.drive(mode === 'heli' ? controls.state : NO_INPUT, FIXED); // parked heli just keeps its rotors stopped
      if (mode === 'foot') pilot.drive(controls.state, FIXED);
      if (mode === 'sub') underwater.step(controls.state, FIXED);
      world.step(FIXED);
      accumulator -= FIXED;
      steps++;
    }
    heli.sync(dt);
    pilot.sync(dt);

    // hop out of / into the cockpit
    if (anim) {
      anim.t += dt;
      const u = Math.min(1, anim.t / anim.duration);
      const e = u * u * (3 - 2 * u);
      pilot.group.position.lerpVectors(anim.from, anim.to, e);
      pilot.group.position.y += Math.sin(u * Math.PI) * anim.arc;
      pilot.group.rotation.y = anim.yaw;
      pilot.animate(dt, 0.4, u < 0.1 || u > 0.9);
      if (u >= 1) { const done = anim.onDone; anim = null; done(); }
    }
    if (underwater.active) {
      let uev;
      while ((uev = underwater.takeEvent())) {
        if (uev === 'pearl') toast(`Pearl ${underwater.cave.found} of ${underwater.cave.total}`, 2);
        else if (uev === 'allpearls') toast('All pearls found! Hold Space at the surface to come back up', 5);
        else if (uev === 'surface' && mode === 'sub') startSurface();
      }
    }
    if (mode === 'foot') {
      const fp = pilot.position;
      if (fp.y < -30 || Math.abs(fp.x) > terrain.half || Math.abs(fp.z) > terrain.half) respawnPilot('Back to the helicopter');
      else if (fp.y < terrain.waterLevel - 1.2) respawnPilot('Splash! Back to the helicopter');
    }

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
    if (rr === 'start') { toast('Go! Follow the glowing rings', 2.5); setChallenge(true); }
    else if (rr === 'ring') toast(`Ring ${ringRun.next} of ${ringRun.total}`, 1.2);
    else if (rr === 'finish' || rr === 'record') {
      toast(rr === 'record' ? `New best time · ${fmtTime(ringRun.lastResult)}!` : `Course complete · ${fmtTime(ringRun.lastResult)}`, 4);
      const finished = ringRun.lastResult;
      setTimeout(() => { if (!overlay.isOpen && !board.isOpen) board.promptEntry(finished * 1000); }, 900);
    }

    const ev = heli.takeEvent();
    if (ev === 'landed') toast('Landed · hold Space to take off · F to get out once the rotors stop', 4);
    if (ev === 'tookoff') hud.toast.classList.add('hidden');
    if (heli.position.y < -30 && mode === 'heli') controls.onReset();
  }
  props.update(dt);
  dust.update(dt);

  // whoever the player currently is: the helicopter, the pilot on foot, or the submarine
  const onFoot = mode !== 'heli';
  const subMode = inSub();
  const player = subMode ? sub.position : onFoot ? pilot.position : heli.position;
  if (mode === 'sub') _vel.copy(sub.velocity); else if (mode === 'foot') _vel.copy(pilot.body.velocity); else if (onFoot) _vel.set(0, 0, 0); else _vel.copy(heli.body.velocity);
  const focusItem = activeProject ? landmarks.get(activeProject.id) : null;
  followCam.update(player, _vel, dt, focusItem ? focusItem.group.position : null);

  // the moored sub bobs gently; the underwater level animates itself
  if (!underwater.active) {
    sub.group.position.y = dock.moor.y + Math.sin(elapsed * 1.1) * 0.08;
    sub.tilt.rotation.z = Math.sin(elapsed * 0.9) * 0.02;
    sub.tilt.rotation.x = Math.sin(elapsed * 0.7 + 1) * 0.015;
    sub.prop.rotation.z += dt * 0.5;
  } else underwater.update(dt, elapsed);

  // sun + shadow frustum follow the player
  sun.position.set(player.x + 50, player.y + 80, player.z + 25);
  sun.target.position.copy(player);

  // pads / labels (hidden while underwater: they're positioned by the overworld camera)
  hud.labels.classList.toggle('hidden', underwater.active);
  activeProject = underwater.active ? null : landmarks.update(player, dt, elapsed, HOVER_TO_OPEN);
  for (const pl of peakLabels) {
    _pv.copy(pl.pos).project(camera);
    const on = _pv.z < 1 && Math.abs(_pv.x) < 1.05 && Math.abs(_pv.y) < 1.05;
    pl.el.style.opacity = on ? 0.8 : 0;
    if (on) { pl.el.style.left = `${(_pv.x * 0.5 + 0.5) * window.innerWidth}px`; pl.el.style.top = `${(-_pv.y * 0.5 + 0.5) * window.innerHeight}px`; }
  }
  const canDive = mode === 'subdocked';
  const canOpen = (!!activeProject || canDive) && !overlay.isOpen && !paused;
  hud.prompt.classList.toggle('hidden', !canOpen);
  hud.touchAction.classList.toggle('hidden', !canOpen);
  if (canDive) {
    hud.promptText.textContent = 'Dive';
    hud.touchAction.textContent = 'DIVE';
  } else if (canOpen) {
    hud.promptText.textContent = activeProject.url ? `Open ${activeProject.title}` : activeProject.title;
    hud.touchAction.textContent = activeProject.url ? 'OPEN' : 'INFO';
  }

  // get out / climb back in prompt (sits above the project prompt when both show)
  const exit = canExit(), boardHeli = canBoard(), boardSub = canBoardSub(), exitSub = canExitSub();
  const showSecondary = (exit || boardHeli || boardSub || exitSub) && !overlay.isOpen && !paused;
  hud.prompt2.classList.toggle('hidden', !showSecondary);
  hud.touchSecondary.classList.toggle('hidden', !showSecondary);
  hud.prompt2.classList.toggle('solo', !canOpen);
  hud.touchSecondary.classList.toggle('solo', !canOpen);
  if (showSecondary) {
    hud.prompt2Text.textContent = exit ? 'Get out' : boardHeli ? 'Climb back in' : boardSub ? 'Board the submarine' : 'Climb out';
    hud.touchSecondary.textContent = exit ? 'GET OUT' : boardHeli ? 'BOARD' : boardSub ? 'BOARD SUB' : 'CLIMB OUT';
  }

  hud.speed.textContent = Math.round(mode === 'sub' ? sub.speedKmh : mode === 'foot' ? pilot.speedKmh : onFoot ? 0 : heli.speedKmh);
  hud.alt.textContent = Math.max(0, Math.round(underwater.active ? underwater.depth : onFoot ? 0 : heli.altitude));
  hud.altUnit.textContent = underwater.active ? 'm deep' : 'm alt';
  hud.pearlhunt.classList.toggle('hidden', !underwater.active);
  if (underwater.active) {
    hud.pearlsVal.textContent = `${underwater.cave.found}/${underwater.cave.total}`;
    const np = underwater.cave.nearestPearl(sub.position);
    hud.pearlHint.textContent = np ? `nearest ${Math.round(np.distance)} m` : 'all found';
    if (np) {
      const dx = Math.sin(np.angle), dz = Math.cos(np.angle);
      const sx = (dx - dz) / Math.SQRT2, sy = (-dx - dz) / Math.SQRT2;
      hud.pearlArrow.style.transform = `rotate(${(Math.atan2(sx, sy) * 180) / Math.PI - 90}deg)`;
    }
    hud.pearlArrow.classList.toggle('hidden', !np);
  }
  hud.rr.classList.toggle('hidden', underwater.active);
  hud.trophy.classList.toggle('live', ringRun.state === 'running' && !underwater.active);
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
  hud.rrHint.textContent = running
    ? (b ? `Next ring ${Math.round(b.distance)} m ${b.altitude > 3 ? '↑' : b.altitude < -3 ? '↓' : '→'}` : '')
    : ringRun.state === 'done' ? 'Green ring to go again' : 'Fly through the green ring to start';

  hud.rotor.classList.toggle('hidden', onFoot || (!heli.landed && heli.spool > 0.98));
  hud.rotorFill.style.width = `${Math.round(heli.spool * 100)}%`;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) hud.toast.classList.add('hidden'); }

  renderer.render(underwater.active ? underwater.scene : scene, camera);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
