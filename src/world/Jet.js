import * as THREE from 'three';
import { stickToHeading } from '../stick.js';

/**
 * A stubby low-poly stealth fighter and an arcade flight model.
 *   - no physics engine: position/heading/pitch are integrated directly (like the submarine)
 *   - on the ground it taxis; above `takeoffSpeed` holding "up" rotates it into the air
 *   - in the air it flies along its nose; below `stallSpeed` the nose drops and it sinks
 *   - touching down: gentle, wings level, on the runway or flat dry grass → rolls out; otherwise 'crash'
 * Feel lives in `tuning` (live-editable via ?debug).
 */
export class Jet {
  constructor(terrain, { onRunway = () => false } = {}) {
    this.terrain = terrain;
    this.onRunway = onRunway;
    this.tuning = {
      taxiAccel: 6.3,       // m/s² on the ground with throttle — tuned so rotation comes at the far end of the 140 m runway
      rollDrag: 5.6,        // m/s² a rolling jet loses with the throttle closed (a 40 m/s touchdown rolls the length of the runway)
      brake: 7.5,           // m/s² extra when holding S on the ground
      airAccel: 11,         // m/s² throttle in the air
      airBrake: 7,
      maxSpeed: 80,         // m/s (~290 km/h)
      cruise: 45,           // speed the jet settles to with no throttle input
      takeoffSpeed: 38,     // m/s; reached ~125 m down the runway at taxiAccel
      stallSpeed: 24,
      turnRate: 1.25,       // rad/s at full stick in the air
      groundTurnRate: 1.6,
      maxPitch: 0.6,        // rad
      pitchRate: 2.2,       // how fast the nose follows the stick
      maxBank: 1.0,         // visual roll at full turn
      maxAltitude: 140,
      gearHeight: 1.7,      // height of the fuselage centre above the ground on its wheels
      landSink: 7,          // max descent rate (m/s) for a safe touchdown
      landSlope: 0.3,       // steepest grass you can land on
    };
    this.state = 'ground';  // 'ground' | 'air'
    this.in = { throttle: 0, turn: 0, pitch: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 0;
    this.vy = 0;
    this.altitude = 0;
    this.events = [];
    this.#buildVisual();
  }

  // ---------------------------------------------------------------- model
  #buildVisual() {
    const grey = new THREE.MeshStandardMaterial({ color: '#8f949a', roughness: 0.5, metalness: 0.4 });
    const greyDark = new THREE.MeshStandardMaterial({ color: '#6b7178', roughness: 0.55, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2e34', roughness: 0.7 });
    const canopy = new THREE.MeshPhysicalMaterial({ color: '#b98a34', roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.82, clearcoat: 1, clearcoatRoughness: 0.1, emissive: '#4a3010', emissiveIntensity: 0.3 });
    const nozzle = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.45, metalness: 0.75, side: THREE.DoubleSide });
    this.flameMat = new THREE.MeshBasicMaterial({ color: '#ff9a2e', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });

    this.group = new THREE.Group();   // position + yaw
    this.tilt = new THREE.Group();    // pitch + roll
    this.group.add(this.tilt);
    const T = this.tilt;
    const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; T.add(m); return m; };

    // ---- fuselage: a smooth loft through cross-sections (superellipses: round at the nose, squarer
    //      amidships, with a chine where the flatter top meets the deeper belly). Nose at +z.
    //      { z, w: half-width, hT: height above centreline, hB: depth below, nT/nB: top/bottom exponents }
    const stations = [
      { z: 10.9, w: 0.03, hT: 0.03, hB: 0.03, nT: 2.0, nB: 2.0 },
      { z: 10.0, w: 0.42, hT: 0.36, hB: 0.34, nT: 2.0, nB: 2.0 },
      { z: 8.6, w: 0.85, hT: 0.62, hB: 0.62, nT: 2.1, nB: 2.3 },
      { z: 7.0, w: 1.22, hT: 0.80, hB: 0.86, nT: 2.2, nB: 2.5 },
      { z: 5.4, w: 1.52, hT: 0.92, hB: 1.02, nT: 2.4, nB: 2.7 },
      { z: 3.6, w: 1.74, hT: 1.00, hB: 1.10, nT: 2.6, nB: 2.9 },
      { z: 1.5, w: 1.90, hT: 1.02, hB: 1.14, nT: 2.8, nB: 3.0 },
      { z: -0.8, w: 1.92, hT: 1.00, hB: 1.12, nT: 2.8, nB: 3.0 },
      { z: -3.0, w: 1.78, hT: 0.94, hB: 1.02, nT: 2.6, nB: 2.8 },
      { z: -5.0, w: 1.46, hT: 0.84, hB: 0.88, nT: 2.4, nB: 2.5 },
      { z: -6.6, w: 1.08, hT: 0.74, hB: 0.74, nT: 2.2, nB: 2.2 },
      { z: -7.9, w: 0.86, hT: 0.68, hB: 0.68, nT: 2.0, nB: 2.0 },
    ];
    add(loft(stations, 56, 90), grey);
    // dorsal spine behind the canopy, blending into the fin roots
    add(loft([
      { z: 2.2, w: 0.02, hT: 0.02, hB: 0.0, nT: 2, nB: 2 },
      { z: 1.0, w: 0.75, hT: 0.55, hB: 0.0, nT: 2.2, nB: 2 },
      { z: -2.0, w: 0.95, hT: 0.62, hB: 0.0, nT: 2.4, nB: 2 },
      { z: -5.0, w: 0.80, hT: 0.45, hB: 0.0, nT: 2.2, nB: 2 },
      { z: -7.6, w: 0.50, hT: 0.12, hB: 0.0, nT: 2, nB: 2 },
    ], 32, 40), grey, 0, 0.95, 0);
    // radome tip
    const radome = add(new THREE.ConeGeometry(0.42, 1.0, 32), dark, 0, 0, 10.45);
    radome.rotation.x = Math.PI / 2;

    // ---- canopy: a smooth bubble, frame hoop, and a dark cockpit tub under it
    const bubble = add(new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2), canopy, 0, 0.98, 4.1);
    bubble.scale.set(0.92, 0.95, 2.35);
    const hoop = add(new THREE.TorusGeometry(0.92, 0.05, 10, 48, Math.PI), greyDark, 0, 0.98, 3.3);
    hoop.rotation.y = 0; hoop.scale.set(1, 0.95, 1);
    add(new THREE.SphereGeometry(0.75, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), dark, 0, 0.9, 4.4).scale.set(0.8, 0.35, 2.0);
    // pilot's headrest + helmet
    add(new THREE.SphereGeometry(0.3, 20, 14), new THREE.MeshStandardMaterial({ color: '#d8dde3', roughness: 0.5 }), 0, 1.45, 3.4);

    // ---- intakes: rounded-edge ducts either side under the wing root, with dark mouths
    const intakeShape = roundedRect(1.0, 1.25, 0.3);
    for (const sx of [-1, 1]) {
      const duct = add(new THREE.ExtrudeGeometry(intakeShape, { depth: 4.6, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 4 }), greyDark, sx * 1.95, -0.28, 0.6);
      duct.rotation.y = sx * 0.06;
      const mouth = add(new THREE.ExtrudeGeometry(roundedRect(0.78, 1.0, 0.25), { depth: 0.2, bevelEnabled: false }), dark, sx * 1.95, -0.28, 5.3);
      mouth.rotation.y = sx * 0.06;
    }

    // ---- wings, stabilators, canted fins: beveled extrusions so the edges are rounded, not razor-flat
    const airfoil = (shape, thick) => new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.02, thick - 0.24), bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.16, bevelSegments: 5 });
    const planform = (span, rootChord, tipChord, sweep) => {
      const s = new THREE.Shape();
      s.moveTo(0, rootChord / 2); s.lineTo(span, rootChord / 2 - sweep); s.lineTo(span, rootChord / 2 - sweep - tipChord); s.lineTo(0, -rootChord / 2); s.closePath();
      return s;
    };
    for (const sx of [-1, 1]) {
      const w = add(airfoil(planform(4.9, 6.2, 1.7, 3.7), 0.34), grey, sx * 1.5, -0.12, 0.4);
      w.rotation.x = Math.PI / 2; if (sx < 0) w.scale.x = -1;
      const hs = add(airfoil(planform(2.4, 2.8, 0.9, 1.7), 0.26), grey, sx * 1.05, -0.05, -5.5);
      hs.rotation.x = Math.PI / 2; if (sx < 0) hs.scale.x = -1;
      const vt = add(airfoil(planform(2.7, 2.7, 1.0, 1.75), 0.24), grey, sx * 1.0, 0.95, -4.6);
      vt.rotation.set(Math.PI / 2, 0, 0);
      vt.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), sx * (Math.PI / 2 - 0.35));
      if (sx < 0) vt.scale.x = -1;
    }

    // ---- engine nozzle + afterburner
    const noz = add(new THREE.CylinderGeometry(0.72, 0.86, 1.3, 36, 1, true), nozzle, 0, 0, -8.3);
    noz.rotation.x = Math.PI / 2;
    const inner = add(new THREE.ConeGeometry(0.6, 1.4, 36, 1, true), dark, 0, 0, -8.2);
    inner.rotation.x = -Math.PI / 2;
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.62, 4.5, 24, 1, true), this.flameMat);
    this.flame.rotation.x = -Math.PI / 2; this.flame.position.set(0, 0, -10.6); T.add(this.flame);

    // ---- landing gear (hidden in flight)
    const strut = new THREE.MeshStandardMaterial({ color: '#d7d9dc', roughness: 0.5, metalness: 0.4 });
    this.gear = new THREE.Group();
    const wheel = (x, z, h) => {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, h, 12), strut); st.position.set(x, -h / 2 - 0.2, z);
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.26, 24), dark); wh.rotation.z = Math.PI / 2; wh.position.set(x, -h - 0.2 + 0.1, z);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.28, 16), strut); hub.rotation.z = Math.PI / 2; hub.position.copy(wh.position);
      this.gear.add(st, wh, hub);
    };
    wheel(0, 5.6, 1.15); wheel(-1.35, -0.9, 1.05); wheel(1.35, -0.9, 1.05);
    T.add(this.gear);
    // nav lights on the wingtips
    const nav = (x, c) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2 })); l.position.set(x, -0.1, -0.6); T.add(l); };
    nav(-6.3, '#ff3b3b'); nav(6.3, '#3bff6a');
  }

  // ---------------------------------------------------------------- control
  place(x, z, yaw, { airborne = false, speed = 0, altitude = 0 } = {}) {
    const ground = this.terrain.heightAt(x, z);
    this.group.position.set(x, airborne ? ground + altitude : ground + this.tuning.gearHeight, z);
    this.yaw = yaw; this.pitch = 0; this.speed = speed; this.vy = 0;
    this.state = airborne ? 'air' : 'ground';
    this.in.throttle = this.in.turn = this.in.pitch = 0;
    this.group.rotation.y = yaw;
    this.tilt.rotation.set(0, 0, 0);
    this.gear.visible = !airborne;
  }

  /** @param input { forward, backward, left, right, up, down, axisX, axisY } @param dt fixed step */
  drive(input, dt) {
    const t = this.tuning, p = this.group.position;
    const stick = stickToHeading(input, this.yaw);
    const throttle = THREE.MathUtils.clamp((input.forward ? 1 : 0) - (input.backward ? 1 : 0) + stick.pitch, -1, 1);
    const turn = THREE.MathUtils.clamp((input.left ? 1 : 0) - (input.right ? 1 : 0) + stick.yaw, -1, 1);
    const lift = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    this.in.throttle = THREE.MathUtils.damp(this.in.throttle, throttle, 6, dt);
    this.in.turn = THREE.MathUtils.damp(this.in.turn, turn, 6, dt);
    this.in.pitch = THREE.MathUtils.damp(this.in.pitch, lift, 6, dt);
    const ground = this.terrain.heightAt(p.x, p.z);

    if (this.state === 'ground') {
      // throttle pushes; with it closed the jet rolls down at rollDrag (plus brake while holding S)
      let accel = this.in.throttle > 0 ? this.in.throttle * t.taxiAccel : 0;
      if (this.speed > 0 && this.in.throttle <= 0.05) accel -= t.rollDrag + Math.max(0, -this.in.throttle) * t.brake;
      this.speed = Math.max(0, this.speed + accel * dt);
      this.yaw += this.in.turn * t.groundTurnRate * Math.min(1, this.speed / 10) * dt;
      // roll along the ground, following the terrain
      p.x += Math.sin(this.yaw) * this.speed * dt;
      p.z += Math.cos(this.yaw) * this.speed * dt;
      p.y = THREE.MathUtils.damp(p.y, this.terrain.heightAt(p.x, p.z) + t.gearHeight, 20, dt);
      this.pitch = THREE.MathUtils.damp(this.pitch, 0, 8, dt);
      // rotate at takeoff speed when pulling up, or on its own a touch faster (so it always leaves the runway at the far end)
      if ((this.speed > t.takeoffSpeed && this.in.pitch > 0.3) || this.speed > t.takeoffSpeed * 1.08) {
        this.state = 'air'; this.pitch = 0.2; this.vy = 2; this.gear.visible = false; this.events.push('takeoff');
      }
    } else {
      // throttle: push toward max / brake toward stall; relax toward cruise when idle
      let target = this.in.throttle > 0.05 ? t.maxSpeed : this.in.throttle < -0.05 ? t.stallSpeed * 0.8 : t.cruise;
      let rate = this.in.throttle > 0.05 ? t.airAccel * this.in.throttle : this.in.throttle < -0.05 ? t.airBrake * -this.in.throttle : 3;
      this.speed += THREE.MathUtils.clamp(target - this.speed, -rate * dt, rate * dt);
      // nose follows the stick; a stalled jet can't hold its nose up
      const stalled = this.speed < t.stallSpeed;
      const wantPitch = stalled ? -0.5 : this.in.pitch * t.maxPitch;
      this.pitch = THREE.MathUtils.damp(this.pitch, wantPitch, stalled ? 1.2 : t.pitchRate, dt);
      if (p.y > t.maxAltitude && this.pitch > 0) this.pitch = THREE.MathUtils.damp(this.pitch, -0.1, 3, dt);
      this.yaw += this.in.turn * t.turnRate * dt;
      const fwd = this.speed * Math.cos(this.pitch);
      this.vy = this.speed * Math.sin(this.pitch) - (stalled ? (t.stallSpeed - this.speed) * 0.4 : 0);
      // flare assist: close to the ground the sink rate is capped, so a held "down" still lands rather than crashes
      if (p.y - ground < 14 && this.vy < -(t.landSink - 1.5)) this.vy = -(t.landSink - 1.5);
      p.x += Math.sin(this.yaw) * fwd * dt;
      p.z += Math.cos(this.yaw) * fwd * dt;
      p.y += this.vy * dt;
      // touchdown or crash
      const g2 = this.terrain.heightAt(p.x, p.z);
      if (p.y < g2 + t.gearHeight) {
        const gentle = this.vy > -t.landSink && this.pitch < 0.3 && Math.abs(this.in.turn) < 0.5;
        let flat = this.onRunway(p.x, p.z);
        if (!flat && g2 > this.terrain.waterLevel + 0.3) {
          const e = 3;
          const sx = (this.terrain.heightAt(p.x + e, p.z) - this.terrain.heightAt(p.x - e, p.z)) / (2 * e);
          const sz = (this.terrain.heightAt(p.x, p.z + e) - this.terrain.heightAt(p.x, p.z - e)) / (2 * e);
          flat = Math.hypot(sx, sz) < t.landSlope;
        }
        if (gentle && flat) {
          this.state = 'ground'; p.y = g2 + t.gearHeight; this.pitch = 0; this.vy = 0; this.gear.visible = true; this.events.push('landed');
        } else {
          this.events.push('crash');
        }
      }
    }
    // keep inside the map
    const lim = this.terrain.half - 6;
    if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) { p.x = THREE.MathUtils.clamp(p.x, -lim, lim); p.z = THREE.MathUtils.clamp(p.z, -lim, lim); this.yaw += Math.PI * dt; }
    this.altitude = p.y - ground - t.gearHeight;
  }

  sync(dt) {
    const t = this.tuning;
    this.group.rotation.y = this.yaw;
    const bank = this.state === 'air' ? -this.in.turn * t.maxBank * Math.min(1, this.speed / 30) : 0;
    this.tilt.rotation.z = THREE.MathUtils.damp(this.tilt.rotation.z, bank, 4, dt);
    this.tilt.rotation.x = THREE.MathUtils.damp(this.tilt.rotation.x, -this.pitch, 6, dt);
    const burn = this.state === 'air' ? Math.max(0, this.in.throttle) : Math.max(0, this.in.throttle) * Math.min(1, this.speed / 20);
    this.flameMat.opacity = burn * 0.8;
    this.flame.scale.set(1, 0.6 + burn * 0.9 + Math.random() * 0.15, 1);
  }

  takeEvent() { return this.events.shift() || null; }
  get position() { return this.group.position; }
  get speedKmh() { return this.speed * 3.6; }
  get stopped() { return this.state === 'ground' && this.speed < 0.5; }
  /** World position of the cockpit (for the pilot's hop in/out). */
  seatPoint(out = new THREE.Vector3()) {
    return out.set(0, 1.4, 4.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.group.position);
  }
}

/**
 * Loft a smooth closed surface through cross-section stations (nose first, decreasing z).
 * Each ring is a superellipse: |x/w|^n + |y/h|^n = 1, with separate heights/exponents above and
 * below the centreline. Stations are Catmull-Rom-interpolated so the skin has no creases.
 */
function loft(stations, around = 48, rings = 80) {
  const keys = ['z', 'w', 'hT', 'hB', 'nT', 'nB'];
  const curves = Object.fromEntries(keys.map((k) => [k, new THREE.CatmullRomCurve3(stations.map((s, i) => new THREE.Vector3(i, s[k], 0)), false, 'catmullrom', 0.5)]));
  const pos = [], idx = [];
  const tmp = new THREE.Vector3();
  const sample = (k, u) => curves[k].getPoint(u, tmp).y;
  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    const z = sample('z', u), w = Math.max(0.001, sample('w', u)), hT = Math.max(0.001, sample('hT', u)), hB = Math.max(0.001, sample('hB', u));
    const nT = Math.max(1.2, sample('nT', u)), nB = Math.max(1.2, sample('nB', u));
    for (let j = 0; j <= around; j++) {
      const th = (j / around) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const n = s >= 0 ? nT : nB;
      const x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const y = s >= 0 ? hT * Math.pow(s, 2 / n) : -hB * Math.pow(-s, 2 / n);
      pos.push(x, y, z);
    }
  }
  const W = around + 1;
  for (let r = 0; r < rings; r++) for (let j = 0; j < around; j++) {
    const a = r * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
