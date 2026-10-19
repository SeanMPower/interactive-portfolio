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
    const grey = new THREE.MeshStandardMaterial({ color: '#8d9298', roughness: 0.55, metalness: 0.35 });
    const greyDark = new THREE.MeshStandardMaterial({ color: '#676d74', roughness: 0.6, metalness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2e34', roughness: 0.7 });
    const canopy = new THREE.MeshStandardMaterial({ color: '#c89a3c', roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.8, emissive: '#5a3c10', emissiveIntensity: 0.25 });
    const nozzle = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.7 });
    this.flameMat = new THREE.MeshBasicMaterial({ color: '#ff9a2e', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });

    this.group = new THREE.Group();   // position + yaw
    this.tilt = new THREE.Group();    // pitch + roll
    this.group.add(this.tilt);
    const T = this.tilt;
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; T.add(m); return m; };

    // fuselage: a blended body — wide flat centre, chined nose, tapering tail. Nose at +z.
    const body = mesh(new THREE.BoxGeometry(2.9, 1.4, 8.0), grey, 0, 0, 0.4);
    const upper = mesh(new THREE.BoxGeometry(1.9, 0.8, 9.0), grey, 0, 0.8, 0.2);
    const nose = mesh(new THREE.ConeGeometry(1.15, 5.8, 4), grey, 0, 0.15, 7.2);
    nose.rotation.x = Math.PI / 2; nose.rotation.z = Math.PI / 4; nose.scale.set(1.25, 0.75, 1); // chined, flattened
    const radome = mesh(new THREE.ConeGeometry(0.36, 1.2, 4), dark, 0, 0.15, 10.5);
    radome.rotation.x = Math.PI / 2; radome.rotation.z = Math.PI / 4; radome.scale.set(1.25, 0.75, 1);
    const tail = mesh(new THREE.BoxGeometry(2.6, 1.3, 4.5), greyDark, 0, 0.05, -5.2);
    tail.scale.set(1, 0.9, 1);
    // intakes: angular boxes either side under the wing root
    for (const sx of [-1, 1]) {
      const intake = mesh(new THREE.BoxGeometry(1.0, 1.25, 4.4), greyDark, sx * 1.85, -0.3, 2.8);
      intake.rotation.y = sx * 0.08;
      mesh(new THREE.BoxGeometry(0.8, 0.95, 0.3), dark, sx * 1.85, -0.3, 5.05);
    }
    // canopy: half-ellipsoid, gold-tinted
    const can = mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), canopy, 0, 1.2, 4.0);
    can.scale.set(0.95, 0.85, 2.3);
    mesh(new THREE.BoxGeometry(0.1, 0.9, 0.6), greyDark, 0, 1.5, 3.3); // canopy bow frame

    // wings: trapezoids (leading edge swept 35°, trailing edge swept slightly forward), extruded thin
    const wingShape = (span, rootChord, tipChord, sweep) => {
      const s = new THREE.Shape();
      s.moveTo(0, rootChord / 2); s.lineTo(span, rootChord / 2 - sweep); s.lineTo(span, rootChord / 2 - sweep - tipChord); s.lineTo(0, -rootChord / 2); s.closePath();
      return new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false });
    };
    for (const sx of [-1, 1]) {
      const w = mesh(wingShape(4.9, 6.2, 1.7, 3.7), grey, sx * 1.4, -0.1, 0.4);
      w.rotation.x = Math.PI / 2; if (sx < 0) w.scale.x = -1;          // extrude along z → flip flat, mirror for the left wing
      const hs = mesh(wingShape(2.4, 2.8, 0.9, 1.7), grey, sx * 1.1, -0.05, -5.4);
      hs.rotation.x = Math.PI / 2; if (sx < 0) hs.scale.x = -1;
      // canted twin tails
      const vt = mesh(wingShape(2.6, 2.6, 1.0, 1.7), grey, sx * 1.05, 0.5, -4.4);
      vt.rotation.set(Math.PI / 2, 0, 0);                                            // lay it flat like a wing…
      vt.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), sx * (Math.PI / 2 - 0.35));  // …then stand it up, canted outward
      if (sx < 0) vt.scale.x = -1;
    }
    // engine nozzle + afterburner
    const noz = mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.4, 12, 1, true), nozzle, 0, 0.05, -7.9);
    noz.rotation.x = Math.PI / 2; noz.material.side = THREE.DoubleSide;
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4, 10, 1, true), this.flameMat);
    this.flame.rotation.x = -Math.PI / 2; this.flame.position.set(0, 0.05, -9.8); T.add(this.flame);
    // landing gear (hidden in flight)
    const strut = new THREE.MeshStandardMaterial({ color: '#d7d9dc', roughness: 0.5, metalness: 0.4 });
    this.gear = new THREE.Group();
    const wheel = (x, z) => {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 6), strut); st.position.set(x, -1.0, z);
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 12), dark); wh.rotation.z = Math.PI / 2; wh.position.set(x, -1.6, z);
      this.gear.add(st, wh);
    };
    wheel(0, 5.2); wheel(-1.3, -0.6); wheel(1.3, -0.6);
    T.add(this.gear);
    // nav lights
    const nav = (x, c) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2 })); l.position.set(x, -0.05, 0.6 - 0.9); T.add(l); };
    nav(-6.2, '#ff3b3b'); nav(6.2, '#3bff6a');
    this.tilt.position.y = 0; // fuselage centre is the pivot
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
