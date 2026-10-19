import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { fbm } from './noise.js';

const COLOR_STOPS = [
  [-4.0, '#3d7fb8'], // lake bed
  [-0.6, '#6fb3d9'], // shallows
  [0.2, '#d9c98f'],  // shore sand
  [1.0, '#3f8a38'],  // deep meadow green
  [3.2, '#4c9a3c'],  // grass
  [5.5, '#7a9a3a'],  // olive upland
  [9.0, '#3f7a3c'],  // lower mountain forest
  [16, '#2f6334'],   // dark spruce slopes
  [24, '#5c6b55'],   // krummholz / scrub
  [30, '#8d8a80'],   // alpine rock
  [36, '#eeebe4'],   // summit snow dusting
];

/**
 * Named peaks on the rim, as elongated Gaussian bumps: { x, z, a: height, sx, sz: half-widths }.
 * Mt. Mansfield's summit ridge reads as a face in profile — Forehead, Nose, Lips, Chin (the summit),
 * Adam's Apple — laid out west→east along the north edge. Camel's Hump is a sharp summit with a
 * lower rounded shoulder to its south, on the west edge.
 */
const PEAK_DEFS = [
  // Mt. Mansfield (north edge)
  { name: 'Forehead',      u: -0.45, v: -0.93, a: 13, su: 14, sv: 11 },
  { name: 'Nose',          u: -0.17, v: -0.93, a: 21, su: 6.5, sv: 9 },
  { name: 'Lips',          u: -0.03, v: -0.93, a: 12, su: 6, sv: 9 },
  { name: 'Mt. Mansfield', u: 0.17,  v: -0.93, a: 25, su: 13, sv: 11, label: true },
  { name: "Adam's Apple",  u: 0.38,  v: -0.93, a: 12, su: 9, sv: 9 },
  // Camel's Hump (west edge)
  { name: "Camel's Hump",  u: -0.93, v: 0.09,  a: 27, su: 7, sv: 8, label: true },
  { name: 'Hump shoulder', u: -0.93, v: -0.09, a: 16, su: 12, sv: 13 },
  { name: 'South shoulder',u: -0.93, v: 0.26,  a: 9,  su: 10, sv: 10 },
];
/** Peaks for a map of the given half-size: positions are fractions of the half-size, widths scale with it. */
export function peaksFor(half) {
  const k = half / 130;
  return PEAK_DEFS.map((d) => ({ name: d.name, label: d.label, x: d.u * half, z: d.v * half, a: d.a * (0.7 + 0.3 * k), sx: d.su * k, sz: d.sv * k }));
}

/**
 * Procedural terrain: one height function drives both the visible mesh and the cannon-es
 * Heightfield. Smooth-shaded with a continuous height/slope color gradient, plateaus around
 * landmarks, and carved lakes with a water plane.
 */
export class Terrain {
  constructor({ size = 260, segments = 160, maxHeight = 8, flatSpots = [], lakes = [], seed = 7 } = {}) {
    this.size = size;
    this.segments = segments;
    this.maxHeight = maxHeight;
    this.flatSpots = flatSpots; // [{ x, z, radius, height?, pairWith? }]
    this.lakes = lakes;         // [{ x, z, radius, depth }]
    this.seed = seed;
    this.elementSize = size / segments;
    this.half = size / 2;
    this.waterLevel = -0.5;
    this.peaks = peaksFor(this.half);

    for (const s of this.flatSpots) {
      if (s.height != null) continue;
      if (s.pairWith) {
        const h = this.#rawHeight((s.x + s.pairWith.x) / 2, (s.z + s.pairWith.z) / 2);
        s.height = h; s.pairWith.height = h;
      } else {
        s.height = this.#rawHeight(s.x, s.z);
      }
    }

    this.matrix = this.#buildMatrix();
    this.mesh = this.#buildMesh();
    this.water = this.#buildWater();
    this.body = this.#buildBody();
  }

  #rawHeight(x, z) {
    const n = fbm(x * 0.011 + 100, z * 0.011 + 100, { octaves: 5, seed: this.seed });
    const detail = fbm(x * 0.05, z * 0.05, { octaves: 3, seed: this.seed + 5 }) * 0.9;
    let h = Math.pow(n, 1.7) * this.maxHeight + detail;
    // The Green Mountains ring the map: a forested ridge all the way round, with the real
    // profiles of Mt. Mansfield (north edge, facing the camera) and Camel's Hump (west edge).
    const d = Math.max(Math.abs(x), Math.abs(z)) / this.half;
    const rim = THREE.MathUtils.smoothstep(d, 0.74, 0.97);
    if (rim > 0) {
      const along = fbm(x * 0.03 + 7, z * 0.03 + 7, { octaves: 3, seed: this.seed + 11 });
      h += rim * (9 + along * 9);
    }
    for (const pk of this.peaks) {
      const dx = (x - pk.x) / pk.sx, dz = (z - pk.z) / pk.sz;
      h += pk.a * Math.exp(-(dx * dx + dz * dz));
    }
    return h;
  }

  heightAt(x, z) {
    let h = this.#rawHeight(x, z);
    for (const l of this.lakes) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < l.radius * 1.5) {
        const t = 1 - THREE.MathUtils.smoothstep(d, l.radius * 0.55, l.radius * 1.5);
        h = THREE.MathUtils.lerp(h, -l.depth, t);
      }
    }
    for (const s of this.flatSpots) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.radius * 1.8) {
        const t = 1 - THREE.MathUtils.smoothstep(d, s.radius, s.radius * 1.8);
        h = THREE.MathUtils.lerp(h, s.height, t);
      }
    }
    return h;
  }

  isWater(x, z) { return this.heightAt(x, z) < this.waterLevel; }

  #buildMatrix() {
    const n = this.segments + 1;
    const m = [];
    for (let i = 0; i < n; i++) {
      const col = [];
      for (let j = 0; j < n; j++) {
        col.push(this.heightAt(-this.half + i * this.elementSize, this.half - j * this.elementSize));
      }
      m.push(col);
    }
    return m;
  }

  /** Ground colour for a known height/slope, as [r, g, b] 0..255 (the map samples heights on a grid first). */
  colorFor(h, slope, x, z) {
    const c = this.#colorFor(h, slope, x, z);
    return [c.r * 255, c.g * 255, c.b * 255];
  }

  #colorFor(h, slope, x, z) {
    const c = new THREE.Color();
    let i = 0;
    while (i < COLOR_STOPS.length - 2 && h > COLOR_STOPS[i + 1][0]) i++;
    const [h0, c0] = COLOR_STOPS[i], [h1, c1] = COLOR_STOPS[i + 1];
    const t = THREE.MathUtils.clamp((h - h0) / (h1 - h0), 0, 1);
    c.set(c0).lerp(new THREE.Color(c1), THREE.MathUtils.smoothstep(t, 0, 1));
    // steep faces go rocky
    if (slope > 0.5 && h > 0.5) c.lerp(new THREE.Color('#8d7f74'), THREE.MathUtils.clamp((slope - 0.5) * 2.0, 0, 0.55));
    // subtle large-scale patchiness so grass isn't uniform
    const patch = fbm(x * 0.03 + 50, z * 0.03 + 50, { octaves: 2, seed: 99 }) - 0.5;
    c.offsetHSL(patch * 0.04, patch * 0.1, patch * 0.05);
    return c;
  }

  #buildMesh() {
    const n = this.segments + 1;
    const positions = new Float32Array(n * n * 3);
    const indices = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = (i * n + j) * 3;
        positions[k] = -this.half + i * this.elementSize;
        positions[k + 1] = this.matrix[i][j];
        positions[k + 2] = this.half - j * this.elementSize;
      }
    }
    for (let i = 0; i < this.segments; i++) {
      for (let j = 0; j < this.segments; j++) {
        const a = i * n + j, b = (i + 1) * n + j, c = i * n + j + 1, d = (i + 1) * n + j + 1;
        if ((i + j) % 2 === 0) indices.push(a, b, c, b, d, c);
        else indices.push(a, b, d, a, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const colors = new Float32Array(n * n * 3);
    const nor = geo.attributes.normal;
    for (let v = 0; v < n * n; v++) {
      const col = this.#colorFor(positions[v * 3 + 1], 1 - nor.getY(v), positions[v * 3], positions[v * 3 + 2]);
      colors[v * 3] = col.r; colors[v * 3 + 1] = col.g; colors[v * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  #buildWater() {
    const geo = new THREE.PlaneGeometry(this.size, this.size);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#58b6e8', transparent: true, opacity: 0.72, roughness: 0.25, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = this.waterLevel;
    mesh.receiveShadow = true;
    return mesh;
  }

  #buildBody() {
    const shape = new CANNON.Heightfield(this.matrix, { elementSize: this.elementSize });
    const body = new CANNON.Body({ mass: 0, material: new CANNON.Material('ground') });
    body.addShape(shape);
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    body.position.set(-this.half, 0, this.half);
    return body;
  }
}
