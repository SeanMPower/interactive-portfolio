import * as THREE from 'three';
import { Reef, REEF } from './Reef.js';

/**
 * The underwater level: its own scene (sunlit turquoise water, the reef, bubbles) that the main
 * loop renders instead of the overworld while the player is in the submarine down here.
 * Call `step(input, dt)` from the fixed loop and `update(dt, elapsed)` once per frame.
 */
export class Underwater {
  constructor(sub, camera) {
    this.sub = sub;
    this.camera = camera;
    this.active = false;
    this.water = '#1478b8';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.water);
    this.scene.fog = new THREE.FogExp2(this.water, 0.0028);
    this.scene.add(new THREE.AmbientLight('#8fd0ff', 0.45));
    this.scene.add(new THREE.HemisphereLight('#c6ecff', '#145a88', 0.9));
    // the sun, filtered through the surface; shadows follow the sub
    this.sun = new THREE.DirectionalLight('#fff6dc', 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 220;
    const S = 70;
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S; this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this.reef = new Reef(this.scene);
    this.tuning = { bubbleRate: 18 };

    // bubbles from the prop
    const N = 160;
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshStandardMaterial({ color: '#eaf8ff', transparent: true, opacity: 0.6, roughness: 0.2 }), N);
    this.bubbles.frustumCulled = false;
    this.scene.add(this.bubbles);
    this.bub = Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 1 }));
    this.bubNext = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this.events = [];
  }

  /** Drop the sub in just below the surface at the middle of the reef. */
  enter() {
    this.active = true;
    this.scene.add(this.sub.group);
    this.sub.place(new THREE.Vector3(0, -7, -6), 0);
    this.sub.setLights(false); // plenty of daylight down here
    this.events.length = 0;
  }
  exit() {
    this.active = false;
    this.scene.remove(this.sub.group);
  }

  /** Fixed-step: drive, confine, collect. Pushes 'pearl' | 'allpearls' | 'surface' | 'bump' events. */
  step(input, dt) {
    const sub = this.sub;
    sub.drive(input, dt);
    const surfacing = input.up && sub.position.y > REEF.ceilingY - 0.6;
    const push = this.reef.confine(sub.position, sub.tuning.radius, sub.velocity, surfacing); // the ceiling opens while you hold Space
    if (surfacing && sub.position.y > REEF.surfaceY - 0.6) this.events.push('surface');
    if (push > 0.05 && sub.bumped <= 0 && sub.velocity.lengthSq() > 1) { sub.bumped = 0.6; this.events.push('bump'); }
    const got = this.reef.collect(sub.position);
    if (got) this.events.push(this.reef.found === this.reef.total ? 'allpearls' : 'pearl');
  }

  takeEvent() { return this.events.shift() || null; }

  update(dt, elapsed) {
    const sub = this.sub;
    sub.sync(dt);
    this.sun.position.set(sub.position.x + 30, 40, sub.position.z + 10);
    this.sun.target.position.copy(sub.position);
    this.sun.target.updateMatrixWorld();

    // bubbles: a stream from the prop while thrusting, a few stray ones always
    const rate = (Math.abs(sub.in.pitch) * this.tuning.bubbleRate + 2 + (sub.bumped > 0 ? 25 : 0)) * dt;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    const fx = Math.sin(sub.yaw), fz = Math.cos(sub.yaw);
    while (n-- > 0) {
      const b = this.bub[this.bubNext]; this.bubNext = (this.bubNext + 1) % this.bub.length;
      b.life = 1; b.s = 0.5 + Math.random();
      b.p.set(sub.position.x - fx * 4.2, sub.position.y + 0.2, sub.position.z - fz * 4.2).add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)));
      b.v.set((Math.random() - 0.5) * 1.5 - fx * 2 * sub.in.pitch, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5 - fz * 2 * sub.in.pitch);
    }
    for (let i = 0; i < this.bub.length; i++) {
      const b = this.bub[i];
      if (b.life > 0) {
        b.life -= dt * 0.45;
        b.v.y += 2 * dt;
        b.p.addScaledVector(b.v, dt);
        b.p.x += Math.sin(elapsed * 5 + i) * dt * 0.6;
        this._s.setScalar(b.s * (0.6 + (1 - b.life) * 0.8));
      } else this._s.setScalar(0);
      this._m.compose(b.p, this._q, this._s);
      this.bubbles.setMatrixAt(i, this._m);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;

    this.reef.update(dt, elapsed);
  }

  /** Metres below the lake surface (for the HUD). */
  get depth() { return Math.max(0, REEF.surfaceY - this.sub.position.y); }
  /** Kept for the HUD: pearls found / total, plus a bearing to the nearest one. */
  get cave() { return this.reef; }
}
