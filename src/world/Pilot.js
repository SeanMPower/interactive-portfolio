import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * The pilot: a nondescript little person who climbs out once the rotors have stopped and
 * can run around the map on foot.
 *   - a cannon-es sphere body (bumps into landmarks, trees, crates and the pad rim; the
 *     sphere is just big enough to roll up onto the 0.8 m helipad step)
 *   - velocity is driven directly from screen-relative input (the camera is fixed-angle,
 *     so "up" on the keys is away from the camera)
 *   - a hand-animated walk cycle; no rig, no skinning
 * Movement feel lives in `tuning` (live-editable via ?debug).
 */
export class Pilot {
  constructor(world, scene, terrain) {
    this.world = world;
    this.scene = scene;
    this.terrain = terrain;

    this.tuning = {
      radius: 0.9,       // body sphere; also how high the feet sit above the sphere centre
      runSpeed: 9,       // m/s
      accel: 45,         // m/s² toward the target velocity
      turnSpeed: 14,     // how snappily the figure faces its direction of travel
      jumpSpeed: 7.5,    // m/s
      stride: 2.4,       // walk-cycle phase per metre
    };

    this.active = false;      // in the world and under player control
    this.yaw = 0;
    this.speed = 0;
    this.phase = 0;           // walk-cycle phase
    this.grounded = false;
    this.pads = [];
    this.platforms = [];      // rotated rectangles you can stand on (the dock): { x, z, yaw, hw, hl, top }
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    // screen-relative basis for a camera looking from +x,+z toward the origin
    this.screenUp = new THREE.Vector3(-1, 0, -1).normalize();
    this.screenRight = new THREE.Vector3(1, 0, -1).normalize();

    this.#buildPhysics();
    this.#buildVisual();
    this.group.visible = false;
  }

  #buildPhysics() {
    this.body = new CANNON.Body({
      mass: 70,
      shape: new CANNON.Sphere(this.tuning.radius),
      material: new CANNON.Material('pilot'),
      fixedRotation: true,
      allowSleep: false,
      linearDamping: 0,
    });
    this.body.updateMassProperties();
    // Zero friction against the world: cannon's friction solver pins a non-rotating sphere in place,
    // so the pilot does his own traction (see drive). Restitution 0 so landings don't bounce.
    const slick = (m) => this.world.addContactMaterial(new CANNON.ContactMaterial(this.body.material, m, { friction: 0, restitution: 0 }));
    slick(this.world.defaultMaterial);                  // pads, landmarks, trees, rocks, crates…
    if (this.terrain.body?.material) slick(this.terrain.body.material); // …and the terrain heightfield
    // cannon only consults ContactMaterials when BOTH bodies carry a material, so give the
    // material-less static bodies the world default explicitly (the pilot is built after the world).
    for (const other of this.world.bodies) if (!other.material) other.material = this.world.defaultMaterial;
  }

  #buildVisual() {
    // Deliberately generic: grey hoodie, dark trousers, sneakers, cap. Group origin is at the feet.
    const skin = new THREE.MeshStandardMaterial({ color: '#e0b89a', roughness: 0.8 });
    const hoodie = new THREE.MeshStandardMaterial({ color: '#8a8f99', roughness: 0.9 });
    const hoodieDark = new THREE.MeshStandardMaterial({ color: '#6e737d', roughness: 0.9 });
    const pants = new THREE.MeshStandardMaterial({ color: '#2b3140', roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.7 });
    const cap = new THREE.MeshStandardMaterial({ color: '#1f4e8c', roughness: 0.7 }); // matches the helicopter

    const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };

    this.group = new THREE.Group();
    this.figure = new THREE.Group();       // bobs with the walk cycle
    this.group.add(this.figure);

    // legs pivot at the hip (y = 0.85), feet at y = 0
    const legGeo = new THREE.BoxGeometry(0.26, 0.85, 0.3);
    legGeo.translate(0, -0.425, 0);
    const shoeGeo = new THREE.BoxGeometry(0.28, 0.14, 0.42);
    shoeGeo.translate(0, -0.85 + 0.07, 0.05);
    this.legL = new THREE.Group(); this.legL.position.set(-0.17, 0.85, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.17, 0.85, 0);
    this.legL.add(new THREE.Mesh(legGeo, pants), new THREE.Mesh(shoeGeo, shoe));
    this.legR.add(new THREE.Mesh(legGeo, pants), new THREE.Mesh(shoeGeo, shoe));

    // torso + hood
    const torso = box(0.62, 0.72, 0.38, hoodie, 0, 0.85 + 0.36, 0);
    const hood = box(0.5, 0.18, 0.3, hoodieDark, 0, 1.6, -0.1);
    const pocket = box(0.4, 0.16, 0.04, hoodieDark, 0, 1.05, 0.2);

    // arms pivot at the shoulder (y = 1.52)
    const armGeo = new THREE.BoxGeometry(0.18, 0.66, 0.2);
    armGeo.translate(0, -0.33, 0);
    const handGeo = new THREE.BoxGeometry(0.16, 0.14, 0.16);
    handGeo.translate(0, -0.72, 0);
    this.armL = new THREE.Group(); this.armL.position.set(-0.41, 1.52, 0);
    this.armR = new THREE.Group(); this.armR.position.set(0.41, 1.52, 0);
    this.armL.add(new THREE.Mesh(armGeo, hoodie), new THREE.Mesh(handGeo, skin));
    this.armR.add(new THREE.Mesh(armGeo, hoodie), new THREE.Mesh(handGeo, skin));

    // head + cap (cap peak points forward, +z)
    const head = box(0.38, 0.4, 0.38, skin, 0, 1.6 + 0.2, 0);
    const capTop = box(0.42, 0.12, 0.42, cap, 0, 1.6 + 0.4, 0);
    const peak = box(0.4, 0.05, 0.22, cap, 0, 1.6 + 0.36, 0.3);

    this.figure.add(this.legL, this.legR, torso, hood, pocket, this.armL, this.armR, head, capTop, peak);
    this.figure.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.group);
  }

  /** Register helipads so the pilot knows where the raised ground is. [{ x, z, radius, top }] */
  setPads(pads) { this.pads = pads; }
  setPlatforms(platforms) { this.platforms = platforms; }

  /** Height of whatever the pilot would stand on at (x, z). */
  groundAt(x, z) {
    let h = this.terrain.heightAt(x, z);
    for (const p of this.pads) if (Math.hypot(x - p.x, z - p.z) < p.radius) h = Math.max(h, p.top);
    for (const q of this.platforms) {
      const c = Math.cos(q.yaw), s = Math.sin(q.yaw), dx = x - q.x, dz = z - q.z;
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      if (Math.abs(lx) < q.hw && Math.abs(lz) < q.hl) h = Math.max(h, q.top);
    }
    return h;
  }

  /** Put the pilot in the world, standing at `feet` (world position of the soles). */
  activate(feet, yaw = this.yaw) {
    this.body.position.set(feet.x, feet.y + this.tuning.radius, feet.z);
    this.body.velocity.setZero();
    this.body.force.setZero();
    this.yaw = yaw;
    this.speed = 0;
    if (!this.active) this.world.addBody(this.body);
    this.active = true;
    this.group.visible = true;
    this.group.position.copy(feet);
    this.group.rotation.y = yaw;
  }

  /** Take the pilot out of the simulation (sitting in the cockpit, or mid-animation). */
  deactivate() {
    if (this.active) this.world.removeBody(this.body);
    this.active = false;
  }

  /** Teleport while active (reset). */
  teleport(feet) {
    this.body.position.set(feet.x, feet.y + this.tuning.radius, feet.z);
    this.body.velocity.setZero();
    this.group.position.copy(feet);
  }

  /**
   * @param input { forward, backward, left, right, up } booleans (screen-relative)
   * @param dt fixed physics step
   */
  drive(input, dt) {
    if (!this.active) return;
    const t = this.tuning;
    const b = this.body;

    const feetY = b.position.y - t.radius;
    const ground = this.groundAt(b.position.x, b.position.z);
    this.grounded = feetY - ground < 0.3 && b.velocity.y < 2;

    this._dir.set(0, 0, 0)
      .addScaledVector(this.screenUp, (input.forward ? 1 : 0) - (input.backward ? 1 : 0) + (input.axisY || 0))
      .addScaledVector(this.screenRight, (input.right ? 1 : 0) - (input.left ? 1 : 0) + (input.axisX || 0));
    const moving = this._dir.lengthSq() > 0.0001;
    let throttle = 1; // the joystick lets you jog: speed scales with how far you push
    if (moving) { throttle = Math.min(1, this._dir.length()); this._dir.normalize(); }

    // horizontal velocity eases toward the target; less grip in the air
    const control = this.grounded ? 1 : 0.35;
    const tx = this._dir.x * t.runSpeed * throttle, tz = this._dir.z * t.runSpeed * throttle;
    const k = Math.min(1, t.accel * control * dt / t.runSpeed);
    b.velocity.x += (tx - b.velocity.x) * k;
    b.velocity.z += (tz - b.velocity.z) * k;

    // step assist: a knee-high ledge ahead (the helipad rim) gets a little hop instead of a wall
    if (moving && this.grounded) {
      const ahead = this.groundAt(b.position.x + this._dir.x * 1.1, b.position.z + this._dir.z * 1.1);
      const stepH = ahead - feetY;
      if (stepH > 0.25 && stepH < 1.1) b.velocity.y = Math.max(b.velocity.y, Math.sqrt(2 * -this.world.gravity.y * (stepH + 0.3)));
    }
    if (input.up && this.grounded) {
      b.velocity.y = t.jumpSpeed;
      this.grounded = false;
    }
    // keep the sphere from sinking into steep terrain / sliding downhill when idle
    if (this.grounded && !moving) { b.velocity.x *= 0.6; b.velocity.z *= 0.6; }
    if (this.grounded && !moving && Math.hypot(b.velocity.x, b.velocity.z) < 0.15) { b.velocity.x = 0; b.velocity.z = 0; }

    if (moving) {
      const target = Math.atan2(this._dir.x, this._dir.z);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, t.turnSpeed * dt);
    }
    this.speed = Math.hypot(b.velocity.x, b.velocity.z);
  }

  /** Copy physics → visuals and animate the walk cycle. */
  sync(dt) {
    if (!this.active) return;
    const b = this.body;
    this.group.position.set(b.position.x, b.position.y - this.tuning.radius, b.position.z);
    this.group.rotation.y = this.yaw;
    this.animate(dt, this.speed / this.tuning.runSpeed, this.grounded);
  }

  /**
   * Walk-cycle pose. `run` is 0..1 (how fast we're going); call with run = 0 for a standing pose.
   * Exposed so the exit/board animations can reuse it while the body is inactive.
   */
  animate(dt, run, grounded = true) {
    const t = this.tuning;
    this.phase += run * t.runSpeed * t.stride * dt;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const swing = run * 0.9;
    if (grounded) {
      this.legL.rotation.x = s * swing;
      this.legR.rotation.x = -s * swing;
      this.armL.rotation.x = -s * swing * 0.8;
      this.armR.rotation.x = s * swing * 0.8;
      this.armL.rotation.z = 0.12; this.armR.rotation.z = -0.12;
      this.figure.position.y = Math.abs(c) * run * 0.08;
      this.figure.rotation.x = run * 0.12;                      // lean into the run
    } else {
      // airborne: knees tucked, arms up
      this.legL.rotation.x = THREE.MathUtils.damp(this.legL.rotation.x, 0.6, 10, dt);
      this.legR.rotation.x = THREE.MathUtils.damp(this.legR.rotation.x, 0.3, 10, dt);
      this.armL.rotation.x = THREE.MathUtils.damp(this.armL.rotation.x, -2.6, 10, dt);
      this.armR.rotation.x = THREE.MathUtils.damp(this.armR.rotation.x, -2.6, 10, dt);
      this.armL.rotation.z = 0.5; this.armR.rotation.z = -0.5;
      this.figure.rotation.x = 0;
    }
  }

  get position() { return this.group.position; }
  get speedKmh() { return this.speed * 3.6; }
}
