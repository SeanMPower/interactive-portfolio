import * as THREE from 'three';

/**
 * A chunky little research submarine. Nose at +z, like the helicopter.
 * No physics engine: the cave keeps it inside the tunnels (see Cave.confine); here we only
 * do an arcade motion model (thrust, water drag, dive planes) plus the visual bank/pitch.
 * Feel lives in `tuning` (live-editable via ?debug).
 */
export class Submarine {
  constructor() {
    this.tuning = {
      forwardAccel: 9,     // m/s²
      backwardAccel: 5,
      maxSpeed: 10,        // m/s
      vertAccel: 6,
      maxVert: 4,
      yawSpeed: 1.5,       // rad/s at full stick
      inputEase: 4,
      drag: 1.1,           // per second (water is thick)
      maxRoll: 0.35,
      maxPitch: 0.3,
      radius: 2.6,         // collision radius against cave walls
    };
    this.in = { pitch: 0, yaw: 0, lift: 0 };
    this.yaw = 0;
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.bumped = 0;       // set by the cave when we scrape a wall (for the HUD/bubbles)
    this.#buildVisual();
  }

  #buildVisual() {
    const hullMat = new THREE.MeshStandardMaterial({ color: '#ffb52e', roughness: 0.45, metalness: 0.15, emissive: '#8a5600', emissiveIntensity: 0.55 }); // stays warm under blue light
    const hullDark = new THREE.MeshStandardMaterial({ color: '#d98f12', roughness: 0.5, metalness: 0.15 });
    const steel = new THREE.MeshStandardMaterial({ color: '#8b94a3', roughness: 0.4, metalness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: '#8fd8ff', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, emissive: '#2a7bb0', emissiveIntensity: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.8 });
    const lamp = new THREE.MeshStandardMaterial({ color: '#fff6c8', emissive: '#ffe9a0', emissiveIntensity: 1.6 });

    this.group = new THREE.Group();   // position + yaw
    this.tilt = new THREE.Group();    // bank + pitch (visual)
    this.group.add(this.tilt);

    // hull: capsule along z
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 4.2, 8, 24), hullMat);
    hull.rotation.x = Math.PI / 2;
    // belly stripe
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(1.62, 4.0, 8, 24, ), hullDark);
    belly.rotation.x = Math.PI / 2; belly.scale.set(1, 0.5, 1); belly.position.y = -0.55;
    // bow dome viewport
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    dome.rotation.x = Math.PI / 2; dome.position.set(0, 0.1, 3.0);
    const domeRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 8, 32), steel);
    domeRing.position.set(0, 0.1, 3.0);
    // conning tower + hatch + periscope
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.3, 16), hullMat);
    tower.position.set(0, 1.9, -0.4);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.15, 16), steel);
    hatch.position.set(0, 2.6, -0.4);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8), steel);
    scope.position.set(0.25, 3.1, -0.5);
    const scopeHead = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.4), steel);
    scopeHead.position.set(0.25, 3.7, -0.35);
    // portholes
    const ports = [];
    for (const z of [-1.2, 0.2, 1.4]) for (const sx of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 8, 16), steel);
      rim.rotation.y = Math.PI / 2; rim.position.set(sx * 1.55, 0.35, z);
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), glass);
      win.rotation.y = sx * Math.PI / 2; win.position.set(sx * 1.6, 0.35, z);
      ports.push(rim, win);
    }
    // stern: fins + prop in a shroud
    const finV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 1.0), hullDark); finV.position.set(0, 0.2, -3.3);
    const finH = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.0), hullDark); finH.position.set(0, 0, -3.3);
    this.planes = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 0.7), hullDark); // dive planes up front, animate with lift
    this.planes.position.set(0, 0.2, 1.6);
    const shroud = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 8, 24), steel);
    shroud.position.set(0, 0.2, -4.1);
    this.prop = new THREE.Group(); this.prop.position.set(0, 0.2, -4.1);
    for (let i = 0; i < 4; i++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.06), dark);
      bl.position.y = 0.42; bl.rotation.z = 0.0; bl.rotation.y = 0.5;
      const arm = new THREE.Group(); arm.add(bl); arm.rotation.z = (i * Math.PI) / 2;
      this.prop.add(arm);
    }
    this.prop.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), steel));
    // headlights
    const lampL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lamp); lampL.position.set(-0.9, -0.5, 2.9);
    const lampR = lampL.clone(); lampR.position.x = 0.9;
    this.headlight = new THREE.SpotLight('#dff4ff', 0, 60, 0.55, 0.5, 1.2);
    this.headlight.position.set(0, -0.3, 2.5);
    this.headlight.target.position.set(0, -1.5, 30);
    this.tilt.add(this.headlight, this.headlight.target);
    this.glow = new THREE.PointLight('#ffd27a', 0, 14, 1.5); // soft fill so the hull reads in the dark
    this.glow.position.set(0, 1, 0);
    this.tilt.add(this.glow);

    this.tilt.add(hull, belly, dome, domeRing, tower, hatch, scope, scopeHead, ...ports, finV, finH, this.planes, shroud, this.prop, lampL, lampR);
    this.tilt.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  /** World position of the hatch on top of the conning tower (where the pilot climbs in). */
  hatchPoint(out = new THREE.Vector3()) {
    out.set(0, 2.7, -0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.group.position);
    return out;
  }

  /** Lights on when underwater, off when docked in daylight. */
  setLights(on) {
    this.headlight.intensity = on ? 900 : 0;
    this.glow.intensity = on ? 60 : 0;
  }

  place(position, yaw = 0) {
    this.group.position.copy(position);
    this.yaw = yaw;
    this.group.rotation.y = yaw;
    this.velocity.set(0, 0, 0);
    this.in.pitch = this.in.yaw = this.in.lift = 0;
    this.speed = 0;
  }

  /** @param input { forward, backward, left, right, up, down } booleans  @param dt fixed step */
  drive(input, dt) {
    const t = this.tuning;
    const tgtPitch = THREE.MathUtils.clamp((input.forward ? 1 : 0) - (input.backward ? 1 : 0) + (input.axisY || 0), -1, 1);
    const tgtYaw = THREE.MathUtils.clamp((input.left ? 1 : 0) - (input.right ? 1 : 0) - (input.axisX || 0), -1, 1);
    const tgtLift = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    this.in.pitch = THREE.MathUtils.damp(this.in.pitch, tgtPitch, t.inputEase, dt);
    this.in.yaw = THREE.MathUtils.damp(this.in.yaw, tgtYaw, t.inputEase, dt);
    this.in.lift = THREE.MathUtils.damp(this.in.lift, tgtLift, t.inputEase, dt);

    this.yaw += this.in.yaw * t.yawSpeed * dt * (0.5 + 0.5 * Math.min(1, Math.abs(this.speed) / 3 + 0.4));
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const v = this.velocity;
    const along = v.x * fx + v.z * fz;
    const side = v.x * fz - v.z * fx;
    let thrust = this.in.pitch * (this.in.pitch >= 0 ? t.forwardAccel : t.backwardAccel);
    if (Math.abs(along) > t.maxSpeed && Math.sign(thrust) === Math.sign(along)) thrust = 0;
    const aFwd = thrust - along * t.drag;
    const aSide = -side * t.drag * 3;
    v.x += (fx * aFwd + fz * aSide) * dt;
    v.z += (fz * aFwd - fx * aSide) * dt;
    let aY = this.in.lift * t.vertAccel - v.y * t.drag * 1.5;
    if (Math.abs(v.y) > t.maxVert && Math.sign(aY) === Math.sign(v.y)) aY = -v.y * t.drag;
    v.y += aY * dt;
    this.group.position.addScaledVector(v, dt);
    this.speed = along;
  }

  sync(dt) {
    const t = this.tuning;
    this.group.rotation.y = this.yaw;
    const roll = THREE.MathUtils.clamp(-this.in.yaw * t.maxRoll * Math.min(1, Math.abs(this.speed) / 4), -t.maxRoll, t.maxRoll);
    const pitch = THREE.MathUtils.clamp(-this.in.lift * t.maxPitch - this.velocity.y * 0.03, -t.maxPitch, t.maxPitch);
    this.tilt.rotation.z = THREE.MathUtils.damp(this.tilt.rotation.z, roll, 4, dt);
    this.tilt.rotation.x = THREE.MathUtils.damp(this.tilt.rotation.x, pitch, 4, dt);
    this.planes.rotation.x = THREE.MathUtils.damp(this.planes.rotation.x, -this.in.lift * 0.6, 6, dt);
    this.prop.rotation.z += (2 + Math.abs(this.in.pitch) * 18) * dt;
    this.bumped = Math.max(0, this.bumped - dt);
  }

  get position() { return this.group.position; }
  get speedKmh() { return Math.abs(this.speed) * 3.6; }
}
