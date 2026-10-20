import * as THREE from 'three';

/**
 * Balloon Burst: a jet mini-game. Nothing exists until start() — then a set of tethered balloons
 * appears around the map; fly through them to pop them. The clock runs from the first pop to the
 * last. Pops in quick succession build a combo, and a barrel roll right after a pop is a "style"
 * bonus; both take seconds off the final time.
 *
 * Positions are [x, z, altitude above the terrain]; keep them clear of the hangar roof.
 */
const LAYOUT = [
  [110, -186, 20], [40, -186, 30],                  // down the runway, climbing
  [-40, -100, 40], [-130, 20, 26],                   // sweeping west to the big lake
  [-100, 150, 44], [40, 170, 24],                    // the south
  [150, 100, 30], [120, -60, 36],                    // the east, back up past the small lake
  [0, 60, 58], [-60, -236, 56],                      // one high, one tucked against Mt. Mansfield
];
const COLORS = ['#ff3d6e', '#ffb52e', '#3fb8ff', '#8ef05a', '#c56bff', '#ff7a1f', '#ff5fc8', '#5ef2ff'];

export class BalloonBurst {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.state = 'idle';            // idle | running | done
    this.balloons = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.events = [];
    this.bursts = [];
    this.reset();
  }

  get total() { return LAYOUT.length; }
  get remaining() { return this.balloons.filter((b) => !b.popped).length; }
  get popped() { return this.total - this.remaining; }

  reset() {
    this.state = 'idle';
    this.time = 0; this.started = false;
    this.combo = 0; this.bestCombo = 0; this.lastPop = -Infinity;
    this.bonus = 0;                 // seconds taken off for combos and style
    this.styleRolls = 0;
    this.lastResult = null;
  }

  /** Spawn the balloons and arm the clock (it starts on the first pop). */
  start() {
    this.clear();
    this.reset();
    this.state = 'running';
    const sphereGeo = new THREE.SphereGeometry(2.3, 28, 20);
    const knotGeo = new THREE.ConeGeometry(0.35, 0.7, 10);
    for (let i = 0; i < LAYOUT.length; i++) {
      const [x, z, alt] = LAYOUT[i];
      const ground = this.terrain.heightAt(x, z);
      const y = Math.max(ground, this.terrain.waterLevel) + alt;
      const color = new THREE.Color(COLORS[i % COLORS.length]);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.05, emissive: color, emissiveIntensity: 0.18 });
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const body = new THREE.Mesh(sphereGeo, mat); body.scale.set(1, 1.12, 1); body.castShadow = true;
      const knot = new THREE.Mesh(knotGeo, mat); knot.position.y = -2.75; knot.rotation.x = Math.PI;
      const tether = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -3.1, 0), new THREE.Vector3(0, ground - y, 0)]),
        new THREE.LineBasicMaterial({ color: '#dde3ea', transparent: true, opacity: 0.55 }),
      );
      g.add(body, knot, tether);
      this.group.add(g);
      this.balloons.push({ group: g, body, mat, popped: false, phase: Math.random() * 6, base: y, color });
    }
    this.events.push('armed');
  }

  /** Remove everything (give up / left the jet / crashed). */
  clear() {
    for (const b of this.balloons) this.group.remove(b.group);
    this.balloons = [];
    for (const bu of this.bursts) this.group.remove(bu.group);
    this.bursts = [];
  }
  abort() { this.clear(); this.reset(); }

  /** Called when the jet barrel-rolls: style bonus if it's right after a pop. */
  noteRoll(elapsed) {
    if (this.state !== 'running' || !this.started) return false;
    if (elapsed - this.lastPop < 1.8) { this.styleRolls++; this.bonus += 2; this.events.push('style'); return true; }
    return false;
  }

  /** @returns one-shot events: 'armed' | 'start' | 'pop' | 'combo' | 'style' | 'finish' */
  update(jetPos, dt, elapsed, reach = 5.2) {
    if (this.state === 'running' && this.started) this.time += dt;
    for (const b of this.balloons) {
      if (b.popped) continue;
      b.group.position.y = b.base + Math.sin(elapsed * 0.9 + b.phase) * 0.6;
      b.group.rotation.z = Math.sin(elapsed * 0.7 + b.phase) * 0.05;
      if (this.state === 'running' && jetPos.distanceTo(b.group.position) < reach) this.#pop(b, elapsed);
    }
    // burst shards fly out and fade
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const bu = this.bursts[i];
      bu.t += dt;
      const u = bu.t / 0.7;
      for (const sh of bu.shards) { sh.mesh.position.addScaledVector(sh.vel, dt); sh.vel.y -= 14 * dt; sh.mesh.scale.setScalar(Math.max(0.01, 1 - u)); }
      if (u >= 1) { this.group.remove(bu.group); this.bursts.splice(i, 1); }
    }
    return this.events.shift() || null;
  }

  #pop(b, elapsed) {
    b.popped = true;
    this.group.remove(b.group);
    // shards
    const g = new THREE.Group(); g.position.copy(b.group.position);
    const shards = [];
    const geo = new THREE.TetrahedronGeometry(0.45, 0);
    const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.4, emissive: b.color, emissiveIntensity: 0.4 });
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(geo, mat);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      shards.push({ mesh: m, vel: dir.multiplyScalar(9 + Math.random() * 7) });
      g.add(m);
    }
    this.group.add(g);
    this.bursts.push({ group: g, shards, t: 0 });
    // timing, combo
    if (!this.started) { this.started = true; this.time = 0; this.events.push('start'); }
    if (elapsed - this.lastPop < 4) { this.combo++; this.bonus += 1; this.bestCombo = Math.max(this.bestCombo, this.combo); this.events.push('combo'); }
    else { this.combo = 1; this.events.push('pop'); }
    this.lastPop = elapsed;
    if (this.remaining === 0) {
      this.state = 'done';
      this.lastResult = Math.max(5, this.time - this.bonus);
      this.events.push('finish');
    }
  }

  /** Bearing/distance to the nearest balloon left (for the HUD chevron). */
  nearest(pos) {
    let best = null, bd = Infinity;
    for (const b of this.balloons) {
      if (b.popped) continue;
      const d = pos.distanceTo(b.group.position);
      if (d < bd) { bd = d; best = b; }
    }
    return best ? { distance: bd, angle: Math.atan2(best.group.position.x - pos.x, best.group.position.z - pos.z), altitude: best.group.position.y - pos.y } : null;
  }
}
