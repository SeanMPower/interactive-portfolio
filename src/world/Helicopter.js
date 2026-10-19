import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { stickToHeading } from '../stick.js';

/**
 * RC helicopter with an arcade flight model:
 *   - a cannon-es sphere body (so it still bumps into landmarks, trees and crates)
 *   - rotation is NOT simulated; heading is driven by input and the visual tilts from velocity
 *   - inputs are eased (no instant throttle) and altitude is held automatically when you let go
 * Everything that affects feel lives in `tuning` (live-editable via ?debug).
 */
export class Helicopter {
  constructor(world, scene, terrain, { spawn = new THREE.Vector3(0, 10, 0), color = '#ff4d6d' } = {}) {
    this.world = world;
    this.scene = scene;
    this.terrain = terrain;
    this.spawn = spawn.clone();

    this.tuning = {
      mass: 300,
      forwardAccel: 30,     // m/s² when stick fully forward
      backwardAccel: 16,
      maxSpeed: 40,         // m/s horizontal (~145 km/h)
      climbAccel: 14,       // m/s² above gravity when ascending
      descendAccel: 12,
      maxClimbRate: 12,     // m/s
      yawSpeed: 1.9,        // rad/s at full stick
      inputEase: 5,         // how quickly inputs ramp (higher = snappier)
      drag: 0.85,           // horizontal velocity damping per second
      altitudeHold: 4,      // how strongly vertical velocity is cancelled when idle
      minAltitude: 3,       // soft floor above terrain
      maxAltitude: 75,
      pitchPerSpeed: 0.014, // visual tilt (rad per m/s)
      maxPitch: 0.42,
      maxRoll: 0.38,
      spoolUp: 2.2,         // rotor spool-up rate (≈1.5 s to flying speed)
      spoolDown: 1.1,       // rotor wind-down rate after landing (≈3 s)
      landingRate: 3.5,     // m/s descent when setting down on a pad
    };

    // eased input state
    this.in = { pitch: 0, yaw: 0, lift: 0 };
    this.yaw = 0;

    // landing state
    this.pads = [];
    this.pad = null;
    this.landed = false;
    this.rotorSpeed = 1;      // 0 = stopped, 1 = flying speed
    this.rotorTarget = 1;
    this.restHeight = 1.9;    // body-sphere centre above the pad surface when the skids touch it
    this.justLanded = false;
    this.justTookOff = false;
    this.speedKmh = 0;
    this.altitude = 0;       // metres above terrain
    this.flippedTime = 0;    // kept for API parity with the truck (never flips)

    this.#buildPhysics();
    this.#buildVisual();
    this.reset();
  }

  #buildPhysics() {
    this.body = new CANNON.Body({
      mass: this.tuning.mass,
      shape: new CANNON.Sphere(1.7),
      material: new CANNON.Material('heli'),
      fixedRotation: true,
      allowSleep: false,
      linearDamping: 0, // we do our own, axis-aware damping
    });
    this.body.updateMassProperties();
    this.world.addBody(this.body);
  }

  #buildVisual() {
    // Friendly cartoon helicopter: deep blue body, big light-blue bubble canopy, silver belly stripe,
    // orange rotor cap and tail-rotor hub, skids.
    const blue = new THREE.MeshStandardMaterial({ color: '#1f4e8c', roughness: 0.45, metalness: 0.1 });
    const blueDark = new THREE.MeshStandardMaterial({ color: '#163a6b', roughness: 0.5, metalness: 0.1 });
    const silver = new THREE.MeshStandardMaterial({ color: '#c8d0da', roughness: 0.35, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: '#7fc4f5', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 });
    const orange = new THREE.MeshStandardMaterial({ color: '#ff7a1f', emissive: '#ff5a00', emissiveIntensity: 0.5, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e2430', roughness: 0.8 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: '#4a5566', roughness: 0.6, metalness: 0.3 });
    const blurMat = new THREE.MeshBasicMaterial({ color: '#4a5566', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });

    const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
    const sphere = (r, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 18) => {
      const o = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), m);
      o.position.set(x, y, z); o.scale.set(sx, sy, sz); return o;
    };

    this.group = new THREE.Group();      // position + yaw
    this.tilt = new THREE.Group();       // pitch + roll (visual only)
    this.tilt.position.y = -0.3;
    this.group.add(this.tilt);

    // ---- body: one rounded blob, nose at +z (high segment count keeps the silhouette smooth)
    const BODY = { x: 0, y: 0.1, z: 0.2, sx: 1.0, sy: 0.95, sz: 1.55, r: 1.5 };
    const body = sphere(BODY.r, blue, BODY.x, BODY.y, BODY.z, BODY.sx, BODY.sy, BODY.sz, 36);
    const belly = sphere(1.5, silver, 0, -0.55, 0.2, 1.02, 0.55, 1.56, 36); // silver stripe low on the body
    const rear = sphere(1.0, blueDark, 0, 0.2, -1.8, 1.0, 0.8, 1.2, 28);
    // ---- bubble canopy: the FRONT HALF of the very same ellipsoid, a hair larger, so its edge is a clean
    //      great-circle rather than a jagged sphere/sphere intersection. A frame ring covers the seam.
    const canopyGeo = new THREE.SphereGeometry(BODY.r * 1.025, 48, 32, 0, Math.PI); // phi 0..π = +z hemisphere
    const canopy = new THREE.Mesh(canopyGeo, glass);
    canopy.renderOrder = 2;
    canopy.position.set(BODY.x, BODY.y, BODY.z);
    canopy.scale.set(BODY.sx, BODY.sy, BODY.sz);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(BODY.r * 1.03, 0.07, 10, 64), blueDark);
    frame.position.set(BODY.x, BODY.y, BODY.z);
    frame.scale.set(BODY.sx, BODY.sy, 1);
    // windscreen divider: a thin band following the canopy surface
    const canopyBand = new THREE.Mesh(new THREE.TorusGeometry(BODY.r * 1.035, 0.045, 8, 64, Math.PI), blueDark);
    canopyBand.position.set(BODY.x, BODY.y, BODY.z);
    canopyBand.rotation.y = Math.PI / 2;      // ring in the y–z plane
    canopyBand.rotation.z = Math.PI / 2;      // keep only the front half (+z)
    canopyBand.scale.set(1, BODY.sy, BODY.sz);
    const sideWinL = frame; // kept names so the add() list below stays simple
    const sideWinR = canopyBand;
    // ---- engine hump, cap and orange beacon
    const hump = box(1.2, 0.5, 1.6, blueDark, 0, 1.3, -0.7);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 10), silver);
    mast.position.set(0, 1.8, -0.7);
    const beacon = sphere(0.22, orange, 0.75, 1.5, -0.9, 1, 0.8, 1, 10);
    // ---- tail boom + fin + round tail-rotor housing with orange hub
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 4.6, 12), blue);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.45, -4.2);
    const fin = box(0.18, 1.4, 1.0, blueDark, 0, 1.2, -6.2);
    const finTip = box(0.2, 0.3, 0.6, orange, 0, 1.95, -6.1);
    const housing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.16, 8, 20), blueDark);
    housing.rotation.y = Math.PI / 2;
    housing.position.set(0, 1.1, -6.5);
    const hstabL = box(1.3, 0.1, 0.5, blue, -0.75, 0.75, -5.4);
    const hstabR = box(1.3, 0.1, 0.5, blue, 0.75, 0.75, -5.4);

    // ---- skids on struts
    const skidGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.0, 8);
    skidGeo.rotateX(Math.PI / 2);
    const gear = [];
    for (const x of [-1.05, 1.05]) {
      const s = new THREE.Mesh(skidGeo, silver); s.position.set(x, -1.5, -0.1); gear.push(s);
      const tipF = sphere(0.1, silver, x, -1.45, 2.0, 1, 1, 1, 8); gear.push(tipF); // turned-up front tip
      for (const z of [0.9, -1.1]) {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8), silver);
        st.position.set(x * 0.9, -1.0, z); st.rotation.z = x > 0 ? -0.25 : 0.25; gear.push(st);
      }
    }

    // ---- lights
    const nav = [[-1.3, -0.2, 0.9, '#ff3b3b'], [1.3, -0.2, 0.9, '#3bff6a']].map(([x, y, z, c]) => {
      const l = sphere(0.09, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2 }), x, y, z, 1, 1, 1, 8);
      return l;
    });
    const spot = sphere(0.18, new THREE.MeshStandardMaterial({ color: '#fff6c8', emissive: '#ffe9a0', emissiveIntensity: 1.2 }), 0, -0.7, 1.9, 1, 1, 1, 8);

    // ---- main rotor: 4 blades, orange cap, blur disc
    this.rotor = new THREE.Group();
    this.rotor.position.set(0, 2.2, -0.7);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 5.4), bladeMat);
      b.position.z = 2.9;
      const arm = new THREE.Group(); arm.add(b); arm.rotation.y = (i * Math.PI) / 2;
      this.rotor.add(arm);
    }
    this.rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 14), silver));
    const cap = sphere(0.34, orange, 0, 0.2, 0, 1, 0.75, 1, 12);
    this.rotor.add(cap);
    this.rotorBlur = new THREE.Mesh(new THREE.CircleGeometry(5.6, 32), blurMat);
    this.rotorBlur.rotation.x = -Math.PI / 2;
    this.rotorBlur.position.copy(this.rotor.position);

    // ---- tail rotor: 3 blades inside the housing, orange hub
    this.tailRotor = new THREE.Group();
    this.tailRotor.position.set(0.2, 1.1, -6.5);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.16), bladeMat);
      b.position.y = 0.32;
      const arm = new THREE.Group(); arm.add(b); arm.rotation.x = (i * Math.PI * 2) / 3;
      this.tailRotor.add(arm);
    }
    this.tailRotor.add(sphere(0.16, orange, 0, 0, 0, 1, 1, 1, 10));

    // pods list kept for API parity (nothing is launched from them)
    this.pods = [];

    this.tilt.add(body, belly, rear, canopy, sideWinL, sideWinR, hump, mast, beacon,
      boom, fin, finTip, housing, hstabL, hstabR, ...gear, ...nav, spot, this.rotor, this.rotorBlur, this.tailRotor);
    this.tilt.traverse((o) => { if (o.isMesh && o !== this.rotorBlur) { o.castShadow = true; } });
    this.scene.add(this.group);
  }

  applyTuning() {
    this.body.mass = this.tuning.mass;
    this.body.updateMassProperties();
  }

  reset(position = this.spawn, yaw = 0) {
    this.body.position.set(position.x, position.y, position.z);
    this.body.velocity.setZero();
    this.body.force.setZero();
    this.yaw = yaw;
    this.in.pitch = this.in.yaw = this.in.lift = 0;
    this.landed = false;
    this.rotorSpeed = this.rotorTarget = 1;
    this.group.position.copy(this.body.position);
    this.group.rotation.y = yaw;
  }

  /**
   * @param input { forward, backward, left, right, up, down } booleans
   * @param dt fixed physics step
   */
  drive(input, dt) {
    const t = this.tuning;
    const b = this.body;
    const g = -this.world.gravity.y;

    // Which helipad (if any) are we over?
    this.pad = this.pads.find((p) => Math.hypot(b.position.x - p.x, b.position.z - p.z) < p.radius) || null;
    const restY = this.pad ? this.pad.top + this.restHeight : Infinity; // body centre height when sitting on the pad

    // ---------- Landed: rotors wind down; holding "up" spools them back up before lift-off
    if (this.landed) {
      this.in.pitch = this.in.yaw = this.in.lift = 0;
      this.rotorTarget = input.up ? 1 : 0;
      this.rotorSpeed = THREE.MathUtils.damp(this.rotorSpeed, this.rotorTarget, this.rotorTarget ? t.spoolUp : t.spoolDown, dt);
      if (input.up && this.rotorSpeed > 0.92) {
        this.landed = false;               // lift-off
        this.justTookOff = true;
      }
      // sit still on the pad (the pad collider holds the weight)
      b.velocity.x *= 0.5; b.velocity.z *= 0.5;
      this.speedKmh = 0;
      this.altitude = b.position.y - this.terrain.heightAt(b.position.x, b.position.z);
      return;
    }
    this.rotorSpeed = THREE.MathUtils.damp(this.rotorSpeed, 1, t.spoolUp, dt);

    // Ease inputs toward their targets
    const stick = stickToHeading(input, this.yaw); // touch joystick: fly toward where it points on screen
    const tgtPitch = THREE.MathUtils.clamp((input.forward ? 1 : 0) - (input.backward ? 1 : 0) + stick.pitch, -1, 1);
    const tgtYaw = THREE.MathUtils.clamp((input.left ? 1 : 0) - (input.right ? 1 : 0) + stick.yaw, -1, 1);
    const tgtLift = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    this.in.pitch = THREE.MathUtils.damp(this.in.pitch, tgtPitch, t.inputEase, dt);
    this.in.yaw = THREE.MathUtils.damp(this.in.yaw, tgtYaw, t.inputEase, dt);
    this.in.lift = THREE.MathUtils.damp(this.in.lift, tgtLift, t.inputEase, dt);

    // ---------- Touchdown: over a pad, descending, and resting on it
    if (this.pad && input.down && b.position.y < restY + 0.35 && Math.abs(b.velocity.y) < 1.5 && Math.hypot(b.velocity.x, b.velocity.z) < 4) {
      this.landed = true;
      this.justLanded = true;
      this.rotorTarget = 0;
      b.velocity.setZero();
      return;
    }

    // Heading
    this.yaw += this.in.yaw * t.yawSpeed * dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);

    // Horizontal thrust along heading (limited by max speed)
    const hv = new THREE.Vector2(b.velocity.x, b.velocity.z);
    const hSpeed = hv.length();
    const accel = this.in.pitch >= 0 ? t.forwardAccel : t.backwardAccel;
    let thrust = this.in.pitch * accel;
    const alongHeading = hv.x * fx + hv.y * fz;
    if (Math.abs(alongHeading) > t.maxSpeed && Math.sign(thrust) === Math.sign(alongHeading)) thrust = 0;

    // Axis-aware drag: strong sideways (helicopters don't slide much), lighter along heading
    const side = hv.x * fz - hv.y * fx; // lateral component
    const dragFwd = -alongHeading * t.drag;
    const dragSide = -side * (t.drag * 2.5);
    const ax = fx * (thrust + dragFwd) + fz * dragSide;
    const az = fz * (thrust + dragFwd) - fx * dragSide;

    // Vertical: climb / descend / hold
    const ground = this.terrain.heightAt(b.position.x, b.position.z);
    this.altitude = b.position.y - ground;
    let ay = g; // cancel gravity by default (hover)
    if (this.in.lift > 0.02) ay += this.in.lift * t.climbAccel;
    else if (this.in.lift < -0.02) ay += this.in.lift * t.descendAccel;
    else ay += -b.velocity.y * t.altitudeHold;
    if (b.velocity.y > t.maxClimbRate && ay > g) ay = g;
    if (b.velocity.y < -t.maxClimbRate && ay < g) ay = g;

    // Soft floor (lifted over a helipad so you can actually set down) and ceiling
    const floor = this.pad ? -Infinity : ground + t.minAltitude;
    if (b.position.y < floor) ay += (floor - b.position.y) * 10 - b.velocity.y * 4;
    if (this.pad && this.in.lift < -0.02) ay = g + (-t.landingRate - b.velocity.y) * 3; // settle gently onto the pad
    if (b.position.y > t.maxAltitude) ay += (t.maxAltitude - b.position.y) * 2 - Math.max(b.velocity.y, 0) * 3;

    b.applyForce(new CANNON.Vec3(ax * t.mass, ay * t.mass, az * t.mass));
    this.speedKmh = hSpeed * 3.6;
  }

  /** Copy physics → visuals, animate rotors and tilt. */
  sync(dt) {
    const t = this.tuning;
    const b = this.body;
    this.group.position.copy(b.position);
    this.group.rotation.y = this.yaw;

    // Tilt from velocity in local frame
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const vFwd = b.velocity.x * fx + b.velocity.z * fz;
    const targetPitch = THREE.MathUtils.clamp(vFwd * t.pitchPerSpeed + this.in.pitch * 0.08, -t.maxPitch, t.maxPitch);
    const targetRoll = THREE.MathUtils.clamp(-this.in.yaw * t.maxRoll * (0.4 + Math.min(Math.abs(vFwd) / t.maxSpeed, 1) * 0.6), -t.maxRoll, t.maxRoll);
    this.tilt.rotation.x = THREE.MathUtils.damp(this.tilt.rotation.x, targetPitch, 5, dt);
    this.tilt.rotation.z = THREE.MathUtils.damp(this.tilt.rotation.z, targetRoll, 5, dt);

    // Rotors: speed follows the spool state; the blur disc only appears once they're fast
    const rpm = (17 + Math.max(this.in.lift, 0) * 7) * this.rotorSpeed;
    this.rotor.rotation.y += rpm * dt;
    this.tailRotor.rotation.x += rpm * 2.2 * dt;
    const blur = THREE.MathUtils.smoothstep(this.rotorSpeed, 0.45, 0.9);
    this.rotorBlur.material.opacity = blur * (0.18 + Math.max(this.in.lift, 0) * 0.1);
    this.rotorBlur.visible = blur > 0.01;
  }

  /** Register helipads so the flight model knows where it may land. [{ x, z, radius, top }] */
  setPads(pads) { this.pads = pads; }

  /** One-shot flags the HUD can consume. */
  takeEvent() {
    if (this.justLanded) { this.justLanded = false; return 'landed'; }
    if (this.justTookOff) { this.justTookOff = false; return 'tookoff'; }
    return null;
  }

  get position() { return this.group.position; }
  get grounded() { return this.altitude < 6; }
  /** 0..1 — how close the rotors are to flying speed. */
  get spool() { return this.rotorSpeed; }

  /** Point on the ground directly below (for rotor-wash dust). */
  groundPoint() {
    const p = this.group.position;
    return new THREE.Vector3(p.x, this.terrain.heightAt(p.x, p.z) + 0.2, p.z);
  }
}
