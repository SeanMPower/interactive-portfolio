import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, seededRandom } from '../world/noise.js';

/**
 * An open, sunlit reef: a rolling sandy seabed under bright turquoise water, with kelp forests,
 * coral gardens, boulders and rock arches, schools of fish, god rays from the surface, and eight
 * pearls to find. Replaces the old cave — nothing to get lost in, everything in view.
 *
 * Collision is analytic: the seabed is a height function, the surface a ceiling, rocks are spheres,
 * and the map edge is a soft wall. `confine()` keeps a point inside all of that.
 */
export const REEF = {
  size: 260,          // square map, metres
  floorY: -30,        // mean seabed depth
  surfaceY: 0,        // the lake surface (sub must rise above this holding Space to surface)
  ceilingY: -2.2,     // the sub can't poke out of the water on its own
};
export const PEARLS = [
  [34, 18], [-48, 30], [62, -40], [-20, -62], [90, 55], [-88, -30], [10, 95], [-70, 80],
];

const SUB_REACH = 2.6 + 1.6; // sub hull radius + a little room: a pearl needs this much clear water around it

export class Reef {
  constructor(scene) {
    this.scene = scene;
    this.rocks = [];       // { x, y, z, r } collision spheres
    this.pois = [];        // { x, z, kind, label } for the map
    this.rnd = seededRandom(99);
    this.half = REEF.size / 2;
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._e = new THREE.Euler();
    this.#buildSeabed();
    this.#buildSurface();
    this.#buildRocks();
    this.#buildKelp();
    this.#buildCoral();
    this.#buildWreck();
    this.#buildPearls();   // after everything with a collider, so pearls can be kept clear of them
    this.#buildFish();
  }

  // ---------------------------------------------------------------- terrain
  /** Seabed height at (x, z): rolling dunes, a few big mounds and a deep trench across one corner. */
  heightAt(x, z) {
    const h = this.half;
    let y = REEF.floorY;
    y += (fbm(x * 0.012 + 3, z * 0.012 + 7, { octaves: 4, seed: 21 }) - 0.5) * 16;   // broad rolling
    y += (fbm(x * 0.05, z * 0.05, { octaves: 2, seed: 22 }) - 0.5) * 2.5;            // ripples
    const mounds = [[60, 40, 34, 11], [-70, -50, 40, 14], [-40, 70, 26, 7], [95, -70, 30, 9]];
    for (const [mx, mz, mr, ma] of mounds) {
      const d = Math.hypot(x - mx, z - mz);
      if (d < mr) y += ma * (0.5 + 0.5 * Math.cos((d / mr) * Math.PI));
    }
    // a shallow shelf near the spawn so you start with something to look at
    const d0 = Math.hypot(x, z);
    if (d0 < 30) y += 6 * (0.5 + 0.5 * Math.cos((d0 / 30) * Math.PI));
    // the map edge rises into a rim
    const edge = Math.max(Math.abs(x), Math.abs(z)) / h;
    if (edge > 0.82) y += ((edge - 0.82) / 0.18) ** 2 * 26;
    return y;
  }

  #buildSeabed() {
    const seg = 150;
    const geo = new THREE.PlaneGeometry(REEF.size, REEF.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color('#dcb96c'), sandDeep = new THREE.Color('#2f7a9c'), algae = new THREE.Color('#5a9e6a'), rock = new THREE.Color('#5b7d8f');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      const depth = THREE.MathUtils.clamp((-22 - y) / 10, 0, 1); // sand on the high ground, teal in the deeps
      const patch = fbm(x * 0.03 + 9, z * 0.03 + 4, { octaves: 2, seed: 31 });
      c.copy(sand).lerp(sandDeep, depth * 0.85);
      if (patch > 0.58) c.lerp(algae, Math.min(1, (patch - 0.58) * 6));
      const edge = Math.max(Math.abs(x), Math.abs(z)) / this.half;
      if (edge > 0.84) c.lerp(rock, Math.min(1, (edge - 0.84) * 7));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.seabed = new THREE.Mesh(geo, mat);
    this.seabed.receiveShadow = true;
    this.scene.add(this.seabed);
  }

  #buildSurface() {
    // the underside of the lake surface, seen only from below (BackSide), plus god rays
    const geo = new THREE.PlaneGeometry(REEF.size * 1.6, REEF.size * 1.6, 40, 40);
    geo.rotateX(-Math.PI / 2);
    this.surface = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#d9f4ff', transparent: true, opacity: 0.55, side: THREE.BackSide, depthWrite: false }));
    this.surface.position.y = REEF.surfaceY;
    this.scene.add(this.surface);

    const rayMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.rays = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const w = 3 + this.rnd() * 9;
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(w, 70), rayMat);
      ray.position.set((this.rnd() - 0.5) * REEF.size * 0.9, -34, (this.rnd() - 0.5) * REEF.size * 0.9);
      ray.rotation.set(0.12, this.rnd() * Math.PI, 0.18 + this.rnd() * 0.1);
      ray.userData.phase = this.rnd() * 10;
      this.rays.add(ray);
    }
    this.scene.add(this.rays);
  }

  // ---------------------------------------------------------------- rocks & arches
  #buildRocks() {
    const rockMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
    const rockMat2 = new THREE.MeshStandardMaterial({ color: '#39556b', roughness: 0.9, flatShading: true });
    const geo = new THREE.DodecahedronGeometry(1, 1);
    const N = 60;
    const mesh = new THREE.InstancedMesh(geo, rockMat, N);
    const rockCols = ['#4d6f86', '#5e8094', '#3f6a8a', '#6a8a93'];
    const rc = new THREE.Color();
    mesh.castShadow = mesh.receiveShadow = true;
    for (let i = 0; i < N; i++) {
      const x = (this.rnd() - 0.5) * REEF.size * 0.85, z = (this.rnd() - 0.5) * REEF.size * 0.85;
      if (Math.hypot(x, z) < 14) { i--; continue; }
      const s = 1.4 + this.rnd() ** 2 * 5;
      const y = this.heightAt(x, z) + s * 0.25;
      this._p.set(x, y, z);
      this._e.set(this.rnd() * Math.PI, this.rnd() * Math.PI, this.rnd() * Math.PI);
      this._q.setFromEuler(this._e);
      this._s.set(s * (0.8 + this.rnd() * 0.5), s * (0.6 + this.rnd() * 0.6), s * (0.8 + this.rnd() * 0.5));
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(i, this._m);
      rc.set(rockCols[Math.floor(this.rnd() * rockCols.length)]);
      mesh.setColorAt(i, rc);
      this.rocks.push({ x, y, z, r: s * 0.9 });
    }
    this.scene.add(mesh);

    // two rock arches you can fly through
    for (const [ax, az, yaw, R] of [[40, -10, 0.6, 12], [-55, 25, -1.1, 9]]) {
      this.pois.push({ x: ax, z: az, kind: 'arch', label: 'Rock arch' });
      const g = new THREE.Group();
      const base = this.heightAt(ax, az);
      g.position.set(ax, base, az);
      g.rotation.y = yaw;
      const arch = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.22, 7, 18, Math.PI), rockMat2);
      arch.position.y = R * 0.15;
      arch.castShadow = arch.receiveShadow = true;
      g.add(arch);
      for (const sx of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.DodecahedronGeometry(R * 0.3, 1), rockMat2);
        foot.position.set(sx * R, -R * 0.1, 0); foot.scale.y = 1.6; foot.castShadow = true;
        g.add(foot);
        // pillar colliders
        const wx = ax + Math.cos(yaw) * sx * R, wz = az - Math.sin(yaw) * sx * R;
        for (let k = 0; k < 4; k++) this.rocks.push({ x: wx, y: base + k * R * 0.3, z: wz, r: R * 0.28 });
      }
      // lintel colliders along the arc
      for (let k = 1; k < 8; k++) {
        const a = (k / 8) * Math.PI;
        const lx = Math.cos(a) * R, ly = Math.sin(a) * R + R * 0.15;
        this.rocks.push({ x: ax + Math.cos(yaw) * lx, y: base + ly, z: az - Math.sin(yaw) * lx, r: R * 0.26 });
      }
      this.scene.add(g);
    }
  }

  // ---------------------------------------------------------------- kelp
  #buildKelp() {
    const N = 220;
    const geo = new THREE.CylinderGeometry(0.12, 0.42, 1, 5, 6, true);
    geo.translate(0, 0.5, 0); // base at origin, unit height — scaled per instance
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, flatShading: true, side: THREE.DoubleSide });
    this.kelp = new THREE.InstancedMesh(geo, mat, N);
    this.kelp.castShadow = true;
    const palette = ['#3fae2e', '#6fcf2f', '#1f8f55', '#b8d82a', '#2aa88f'];
    const beds = [[-30, 40], [70, 20], [-80, -70], [20, -80], [100, 90], [-100, 60]];
    for (const [bx, bz] of beds) this.pois.push({ x: bx, z: bz, kind: 'kelp', label: 'Kelp forest' });
    this.kelpData = [];
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const [bx, bz] = beds[i % beds.length];
      const x = bx + (this.rnd() - 0.5) * 36, z = bz + (this.rnd() - 0.5) * 36;
      const h = 7 + this.rnd() * 10;
      this.kelpData.push({ x, y: this.heightAt(x, z) - 0.3, z, h, phase: this.rnd() * 10, yaw: this.rnd() * Math.PI * 2 });
      col.set(palette[Math.floor(this.rnd() * palette.length)]);
      this.kelp.setColorAt(i, col);
    }
    this.scene.add(this.kelp);
  }

  // ---------------------------------------------------------------- coral
  #buildCoral() {
    const flat = (g) => g.toNonIndexed();
    // branching coral: a fan of tapered cylinders
    const branches = [];
    for (let k = 0; k < 6; k++) {
      const b = new THREE.CylinderGeometry(0.08, 0.28, 2.2 + k * 0.3, 5);
      b.translate(0, 1.1 + k * 0.15, 0);
      b.rotateZ((k - 2.5) * 0.32); b.rotateY(k * 1.1);
      branches.push(flat(b));
    }
    const branchGeo = mergeGeometries(branches);
    // brain / boulder coral: a squashed icosphere
    const brainGeo = new THREE.IcosahedronGeometry(1.3, 1); brainGeo.scale(1, 0.7, 1); brainGeo.translate(0, 0.6, 0);
    // tube coral: bunch of short upright tubes
    const tubes = [];
    for (let k = 0; k < 7; k++) {
      const t = new THREE.CylinderGeometry(0.32, 0.22, 1.2 + this.rnd() * 1.4, 6, 1, true);
      t.translate((this.rnd() - 0.5) * 1.6, 0.6, (this.rnd() - 0.5) * 1.6);
      tubes.push(flat(t));
    }
    const tubeGeo = mergeGeometries(tubes);
    // sea fan: a half disc
    const fanGeo = new THREE.CircleGeometry(1.8, 9, 0, Math.PI); fanGeo.translate(0, 0.2, 0);

    const types = [
      { geo: branchGeo, colors: ['#ff3d8f', '#ff7a1f', '#ff2d55'], n: 80, s: [0.9, 2.0] },
      { geo: brainGeo, colors: ['#a64dff', '#ff5fc8', '#ffc81e'], n: 60, s: [0.8, 2.4] },
      { geo: tubeGeo, colors: ['#ff9a1f', '#ffd400', '#ff4d7d'], n: 60, s: [0.9, 1.9] },
      { geo: fanGeo, colors: ['#9b3dff', '#ff3da6', '#1fe8ff'], n: 50, s: [1.0, 2.4] },
    ];
    const gardens = [[18, 24], [-40, -20], [55, 60], [-75, 45], [80, -60], [-25, -85], [0, 70], [-95, -5], [40, -45]];
    for (const [gx, gz] of gardens) this.pois.push({ x: gx, z: gz, kind: 'coral', label: 'Coral garden' });
    const col = new THREE.Color();
    for (const t of types) {
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, flatShading: true, side: t.geo === fanGeo ? THREE.DoubleSide : THREE.FrontSide, });
      const mesh = new THREE.InstancedMesh(t.geo, mat, t.n);
      mesh.castShadow = mesh.receiveShadow = true;
      for (let i = 0; i < t.n; i++) {
        const [gx, gz] = gardens[Math.floor(this.rnd() * gardens.length)];
        const x = gx + (this.rnd() - 0.5) * 30, z = gz + (this.rnd() - 0.5) * 30;
        const s = t.s[0] + this.rnd() * (t.s[1] - t.s[0]);
        this._p.set(x, this.heightAt(x, z) - 0.2, z);
        this._e.set(0, this.rnd() * Math.PI * 2, 0);
        this._q.setFromEuler(this._e);
        this._s.set(s, s, s);
        this._m.compose(this._p, this._q, this._s);
        mesh.setMatrixAt(i, this._m);
        col.set(t.colors[Math.floor(this.rnd() * t.colors.length)]);
        mesh.setColorAt(i, col);
      }
      this.scene.add(mesh);
    }
  }

  // ---------------------------------------------------------------- pearls
  #buildPearls() {
    const pearlMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4d6', emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1 });
    const shellMat = new THREE.MeshStandardMaterial({ color: '#f0b7d8', roughness: 0.6, flatShading: true });
    this.pearls = PEARLS.map(([px, pz], i) => {
      const [x, z] = this.#clearSpot(px, pz, SUB_REACH);
      const g = new THREE.Group();
      g.position.set(x, this.heightAt(x, z) + 0.1, z);
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 14), pearlMat);
      pearl.position.y = 1.0;
      const lower = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
      lower.rotation.x = Math.PI; lower.position.y = 0.9;
      const upper = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
      upper.position.set(0, 1.0, -1.3); upper.rotation.x = -0.9;
      const halo = new THREE.PointLight('#fff1c4', 14, 12, 2);
      halo.position.y = 1.6;
      g.add(pearl, lower, upper, halo);
      this.scene.add(g);
      return { group: g, pearl, found: false, i };
    });
  }

  /** Nearest point to (x, z) that no rock/arch/wreck collider comes within `clearance` of (so the sub can reach it). */
  #clearSpot(x, z, clearance) {
    const blocked = (qx, qz) => {
      const qy = this.heightAt(qx, qz) + 1;
      return this.rocks.some((r) => Math.hypot(qx - r.x, qy - r.y, qz - r.z) < r.r + clearance);
    };
    if (!blocked(x, z)) return [x, z];
    for (let d = 3; d < 60; d += 3) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + d * 0.3;
        const qx = x + Math.cos(a) * d, qz = z + Math.sin(a) * d;
        if (Math.abs(qx) < this.half * 0.8 && Math.abs(qz) < this.half * 0.8 && !blocked(qx, qz)) return [qx, qz];
      }
    }
    return [x, z];
  }

  // ---------------------------------------------------------------- fish
  #buildFish() {
    const geo = new THREE.ConeGeometry(0.28, 1.1, 5);
    geo.rotateX(Math.PI / 2);
    const tail = new THREE.ConeGeometry(0.22, 0.5, 4); tail.rotateX(-Math.PI / 2); tail.translate(0, 0, -0.75);
    const fishGeo = mergeGeometries([geo.toNonIndexed(), tail.toNonIndexed()]);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.1 });
    const N = 120;
    this.fishMesh = new THREE.InstancedMesh(fishGeo, mat, N);
    this.fishMesh.frustumCulled = false;
    this.fishMesh.castShadow = true;
    const schools = [
      { c: [15, -12, 20], r: 10, col: '#ffb347' }, { c: [-45, -16, 30], r: 14, col: '#5ef2ff' }, { c: [60, -20, -30], r: 12, col: '#ff6f91' },
      { c: [-70, -22, -60], r: 16, col: '#ffe066' }, { c: [30, -8, 70], r: 10, col: '#9ad6ff' }, { c: [-20, -14, -70], r: 12, col: '#c56bff' },
    ];
    this.fish = [];
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const s = schools[i % schools.length];
      this.fish.push({ s, a: this.rnd() * Math.PI * 2, rad: s.r * (0.4 + this.rnd() * 0.6), y: (this.rnd() - 0.5) * 5, w: (0.25 + this.rnd() * 0.3), bob: this.rnd() * 6, size: 0.8 + this.rnd() * 0.7 });
      col.set(s.col).offsetHSL((this.rnd() - 0.5) * 0.05, 0, (this.rnd() - 0.5) * 0.2);
      this.fishMesh.setColorAt(i, col);
    }
    this.scene.add(this.fishMesh);
  }

  // ---------------------------------------------------------------- a sunken rowboat
  #buildWreck() {
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.95, flatShading: true });
    const g = new THREE.Group();
    const x = -88, z = -32;
    this.pois.push({ x, z, kind: 'wreck', label: 'Sunken rowboat' });
    g.position.set(x, this.heightAt(x, z) + 0.4, z);
    g.rotation.set(0.25, 0.7, -0.3);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 7), wood);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.4, 4), wood); bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.z = 4.5;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 0.5), wood); seat.position.set(0, 0.6, 0);
    g.add(hull, bow, seat);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);
    this.rocks.push({ x, y: g.position.y, z, r: 3 });
  }

  /** Seabed colour for a known height, as [r, g, b] (for the map): sand on the high ground, teal in the deeps. */
  colorFor(y, slope, x, z) {
    const depth = THREE.MathUtils.clamp((-22 - y) / 10, 0, 1);
    const c = new THREE.Color('#dcb96c').lerp(new THREE.Color('#2f7a9c'), depth * 0.85);
    const patch = fbm(x * 0.03 + 9, z * 0.03 + 4, { octaves: 2, seed: 31 });
    if (patch > 0.58) c.lerp(new THREE.Color('#5a9e6a'), Math.min(1, (patch - 0.58) * 6));
    for (const r of this.rocks) if (r.r > 2.5 && Math.hypot(x - r.x, z - r.z) < r.r) c.set('#46617a');
    return [c.r * 255, c.g * 255, c.b * 255];
  }

  // ---------------------------------------------------------------- collision
  /** Keep `pos` inside the reef (seabed, ceiling, rocks, map edge). Returns the push distance. */
  confine(pos, radius, vel, allowSurface = false) {
    let push = 0;
    // seabed
    const floor = this.heightAt(pos.x, pos.z) + radius + 0.4;
    if (pos.y < floor) { push += floor - pos.y; pos.y = floor; if (vel.y < 0) vel.y *= -0.3; }
    // ceiling (the sub may only pass it while surfacing, which the level handles)
    if (!allowSurface && pos.y > REEF.ceilingY) { pos.y = REEF.ceilingY; if (vel.y > 0) vel.y = 0; }
    // map edge: soft wall
    const lim = this.half * 0.86;
    for (const k of ['x', 'z']) {
      if (pos[k] > lim) { push += pos[k] - lim; pos[k] = lim; if (vel[k] > 0) vel[k] *= -0.3; }
      if (pos[k] < -lim) { push += -lim - pos[k]; pos[k] = -lim; if (vel[k] < 0) vel[k] *= -0.3; }
    }
    // rocks
    for (const r of this.rocks) {
      const dx = pos.x - r.x, dy = pos.y - r.y, dz = pos.z - r.z;
      const d = Math.hypot(dx, dy, dz), min = r.r + radius;
      if (d < min && d > 1e-4) {
        const k = (min - d) / d;
        pos.x += dx * k; pos.y += dy * k; pos.z += dz * k;
        const vn = (vel.x * dx + vel.y * dy + vel.z * dz) / d;
        if (vn < 0) { vel.x -= (dx / d) * vn * 1.3; vel.y -= (dy / d) * vn * 1.3; vel.z -= (dz / d) * vn * 1.3; }
        push += min - d;
      }
    }
    return push;
  }

  collect(pos, reach = 5.5) {
    let n = 0;
    for (const p of this.pearls) {
      if (p.found) continue;
      // measured to the pearl itself (a metre above the shell), since the hull has to stay ~3 m off the seabed
      const dx = pos.x - p.group.position.x, dy = pos.y - (p.group.position.y + 1), dz = pos.z - p.group.position.z;
      if (Math.hypot(dx, dy, dz) < reach) { p.found = true; p.group.visible = false; n++; }
    }
    return n;
  }
  get found() { return this.pearls.filter((p) => p.found).length; }
  get total() { return this.pearls.length; }

  /** Direction/distance to the nearest unfound pearl (for the HUD hint). */
  nearestPearl(pos) {
    let best = null, bd = Infinity;
    for (const p of this.pearls) {
      if (p.found) continue;
      const d = pos.distanceTo(p.group.position);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { distance: bd, angle: Math.atan2(best.group.position.x - pos.x, best.group.position.z - pos.z) } : null;
  }

  // ---------------------------------------------------------------- animation
  update(dt, elapsed) {
    // kelp sways
    for (let i = 0; i < this.kelpData.length; i++) {
      const k = this.kelpData[i];
      const sway = Math.sin(elapsed * 0.8 + k.phase) * 0.12 + Math.sin(elapsed * 1.7 + k.phase * 2) * 0.04;
      this._p.set(k.x, k.y, k.z);
      this._e.set(sway, k.yaw, sway * 0.6);
      this._q.setFromEuler(this._e);
      this._s.set(1, k.h, 1);
      this._m.compose(this._p, this._q, this._s);
      this.kelp.setMatrixAt(i, this._m);
    }
    this.kelp.instanceMatrix.needsUpdate = true;
    // fish circle their school, bobbing
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      f.a += f.w * dt;
      const [cx, cy, cz] = f.s.c;
      this._p.set(cx + Math.cos(f.a) * f.rad, cy + f.y + Math.sin(elapsed * 1.3 + f.bob) * 0.6, cz + Math.sin(f.a) * f.rad);
      const tx = -Math.sin(f.a), tz = Math.cos(f.a);
      this._e.set(0, Math.atan2(tx, tz), Math.sin(elapsed * 7 + f.bob) * 0.12);
      this._q.setFromEuler(this._e);
      this._s.setScalar(f.size);
      this._m.compose(this._p, this._q, this._s);
      this.fishMesh.setMatrixAt(i, this._m);
    }
    this.fishMesh.instanceMatrix.needsUpdate = true;
    // pearls bob, god rays breathe
    for (const p of this.pearls) { if (!p.found) { p.pearl.position.y = 1.0 + Math.sin(elapsed * 2 + p.i) * 0.15; p.pearl.rotation.y += dt; } }
    for (const r of this.rays.children) { r.material.opacity = 0.05 + (0.5 + 0.5 * Math.sin(elapsed * 0.5 + r.userData.phase)) * 0.06; r.rotation.y += dt * 0.02; }
    this.surface.position.y = REEF.surfaceY + Math.sin(elapsed * 0.6) * 0.15;
  }
}
