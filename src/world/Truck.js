import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * RC monster truck: a cannon-es RaycastVehicle (chassis body + 4 raycast wheels)
 * with a chunky low-poly visual built from primitives. All the "feel" numbers live
 * in `tuning` so you can tweak them live from the debug panel (?debug).
 */
export class Truck {
  constructor(world, scene, { spawn = new THREE.Vector3(0, 6, 0), color = '#ff4d6d' } = {}) {
    this.world = world;
    this.scene = scene;
    this.spawn = spawn.clone();

    this.tuning = {
      mass: 450,
      engineForce: 2600,
      boostMultiplier: 1.6,
      brakeForce: 55,
      maxSteer: 0.55,
      steerSpeed: 4.5,         // how fast steering reaches target
      wheelRadius: 0.95,
      suspensionStiffness: 28,
      suspensionRestLength: 0.75,
      suspensionTravel: 0.6,
      dampingRelaxation: 2.6,
      dampingCompression: 4.4,
      frictionSlip: 3.2,
      rollInfluence: 0.02,
      maxSpeedKmh: 95,
    };

    this.steer = 0;
    this.speedKmh = 0;
    this.upDot = 1;            // 1 = upright, -1 = upside down
    this.flippedTime = 0;

    this.#buildPhysics();
    this.#buildVisual(color);
    this.reset();
  }

  #buildPhysics() {
    const t = this.tuning;
    this.chassisHalf = new CANNON.Vec3(1.25, 0.5, 2.3);
    const chassisShape = new CANNON.Box(this.chassisHalf);
    this.chassisBody = new CANNON.Body({ mass: t.mass, material: new CANNON.Material('chassis') });
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.35, 0));
    this.chassisBody.angularDamping = 0.35;
    this.chassisBody.linearDamping = 0.02;

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    const wheelOptions = {
      radius: t.wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: t.suspensionStiffness,
      suspensionRestLength: t.suspensionRestLength,
      frictionSlip: t.frictionSlip,
      dampingRelaxation: t.dampingRelaxation,
      dampingCompression: t.dampingCompression,
      maxSuspensionForce: 100000,
      rollInfluence: t.rollInfluence,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(),
      maxSuspensionTravel: t.suspensionTravel,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    const w = 1.45, h = 0.1, f = 1.55, r = -1.65;
    const connections = [
      new CANNON.Vec3(-w, h, f), // front left
      new CANNON.Vec3(w, h, f),  // front right
      new CANNON.Vec3(-w, h, r), // rear left
      new CANNON.Vec3(w, h, r),  // rear right
    ];
    for (const c of connections) {
      wheelOptions.chassisConnectionPointLocal.copy(c);
      this.vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: c.clone() });
    }
    this.vehicle.addToWorld(this.world);
  }

  #buildVisual(color) {
    const t = this.tuning;
    this.group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1d26', roughness: 0.9, flatShading: true });
    const glassMat = new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.2, metalness: 0.2, flatShading: true });
    const lightMat = new THREE.MeshStandardMaterial({ color: '#fff6c8', emissive: '#ffe9a0', emissiveIntensity: 1.2 });

    // Chassis frame (low) + cab (raised) → monster-truck silhouette
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 4.6), darkMat);
    frame.position.y = 0.35;
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 3.9), bodyMat);
    body.position.set(0, 1.0, -0.1);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 1.7), bodyMat);
    cab.position.set(0, 1.8, -0.45);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.12), glassMat);
    windshield.position.set(0, 1.9, 0.44);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 1.4), bodyMat);
    hood.position.set(0, 1.5, 1.1);
    const roofBar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.18), darkMat);
    roofBar.position.set(0, 2.33, -0.1);
    const lights = [-0.6, 0.6].map((x) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.12), lightMat);
      l.position.set(x, 2.33, 0.0);
      return l;
    });
    const headlights = [-0.75, 0.75].map((x) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), lightMat);
      l.position.set(x, 1.1, 1.9);
      return l;
    });
    const exhaust = [-0.9, 0.9].map((x) => {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), darkMat);
      e.position.set(x, 1.8, -1.55);
      return e;
    });

    this.chassisMesh = new THREE.Group();
    this.chassisMesh.add(frame, body, cab, windshield, hood, roofBar, ...lights, ...headlights, ...exhaust);
    this.chassisMesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // Wheels
    const tireGeo = new THREE.CylinderGeometry(t.wheelRadius, t.wheelRadius, 0.75, 14);
    tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(t.wheelRadius * 0.55, t.wheelRadius * 0.55, 0.78, 8);
    rimGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: '#23242b', roughness: 1, flatShading: true });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.4, flatShading: true });

    this.wheelMeshes = this.vehicle.wheelInfos.map(() => {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      tire.castShadow = true;
      g.add(tire, rim);
      this.scene.add(g);
      return g;
    });

    this.group.add(this.chassisMesh);
    this.scene.add(this.group);
  }

  /** Apply the current tuning object to the live vehicle (used by the debug panel). */
  applyTuning() {
    const t = this.tuning;
    this.chassisBody.mass = t.mass;
    this.chassisBody.updateMassProperties();
    for (const w of this.vehicle.wheelInfos) {
      w.suspensionStiffness = t.suspensionStiffness;
      w.suspensionRestLength = t.suspensionRestLength;
      w.maxSuspensionTravel = t.suspensionTravel;
      w.dampingRelaxation = t.dampingRelaxation;
      w.dampingCompression = t.dampingCompression;
      w.frictionSlip = t.frictionSlip;
      w.rollInfluence = t.rollInfluence;
    }
  }

  reset(position = this.spawn, yaw = 0) {
    const b = this.chassisBody;
    b.position.set(position.x, position.y, position.z);
    b.quaternion.setFromEuler(0, yaw, 0);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.force.setZero();
    b.torque.setZero();
    this.steer = 0;
    this.flippedTime = 0;
    for (let i = 0; i < 4; i++) { this.vehicle.applyEngineForce(0, i); this.vehicle.setBrake(0, i); }
  }

  /**
   * @param input { forward, backward, left, right, boost, brake } booleans
   * @param dt seconds
   */
  drive(input, dt) {
    const t = this.tuning;
    const v = this.vehicle;

    // Steering (front wheels), eased toward target
    const target = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.steer = THREE.MathUtils.damp(this.steer, target * t.maxSteer, t.steerSpeed, dt);
    // Less steer at speed to avoid instant rollovers
    const speedFactor = THREE.MathUtils.clamp(1 - this.speedKmh / 160, 0.45, 1);
    v.setSteeringValue(this.steer * speedFactor, 0);
    v.setSteeringValue(this.steer * speedFactor, 1);

    // Engine (all four wheels — it's a monster truck)
    const forwardSpeed = this.#forwardSpeed();
    let force = 0;
    if (input.forward) force = -t.engineForce;
    else if (input.backward) force = t.engineForce * 0.7;
    if (input.boost && input.forward) force *= t.boostMultiplier;
    if (Math.abs(this.speedKmh) > t.maxSpeedKmh && Math.sign(-force) === Math.sign(forwardSpeed)) force = 0;

    // Brake when: explicit brake, or reversing direction, or idle (gentle)
    let brake = 0;
    if (input.brake) brake = t.brakeForce;
    else if (input.backward && forwardSpeed > 2) brake = t.brakeForce * 0.6;
    else if (input.forward && forwardSpeed < -2) brake = t.brakeForce * 0.6;
    else if (!input.forward && !input.backward) brake = Math.abs(forwardSpeed) < 0.5 ? t.brakeForce * 0.5 : 2.5;

    for (let i = 0; i < 4; i++) {
      v.applyEngineForce(brake > 3 ? 0 : force, i);
      v.setBrake(brake, i);
    }
  }

  #forwardSpeed() {
    // Chassis front is local +z (cannon's positive engine force pushes toward -z, hence the
    // negative engineForce for "forward" in drive()).
    const fwd = this.chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
    return this.chassisBody.velocity.dot(fwd);
  }

  /** Copy physics → visuals. Call after each physics step. */
  sync(dt) {
    const b = this.chassisBody;
    this.group.position.copy(b.position);
    this.group.quaternion.copy(b.quaternion);

    for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
      this.vehicle.updateWheelTransform(i);
      const tr = this.vehicle.wheelInfos[i].worldTransform;
      this.wheelMeshes[i].position.copy(tr.position);
      this.wheelMeshes[i].quaternion.copy(tr.quaternion);
    }

    this.speedKmh = b.velocity.length() * 3.6;
    const up = b.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    this.upDot = up.y;
    this.flippedTime = this.upDot < 0.1 ? this.flippedTime + dt : 0;
  }

  get position() { return this.group.position; }

  /** Is any wheel touching the ground? */
  get grounded() {
    return this.vehicle.wheelInfos.some((w) => w.isInContact);
  }

  /** World-space positions of the rear wheels (for dust). */
  rearWheelPositions() {
    return [this.wheelMeshes[2].position, this.wheelMeshes[3].position];
  }
}
