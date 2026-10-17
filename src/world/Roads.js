import * as THREE from 'three';
import { seededRandom } from './noise.js';

/**
 * Winding dirt roads that loop through every landmark pad. Built as a closed Catmull-Rom
 * spline through the pads (with a couple of jittered waypoints between each pair so it
 * wanders), draped onto the terrain as a ribbon mesh. `samples` is exposed so trees can
 * keep off the road.
 */
export class Roads {
  constructor(terrain, scene, stops, { width = 6, seed = 11 } = {}) {
    this.width = width;
    const rand = seededRandom(seed);

    // waypoints: pad → wiggle → wiggle → next pad …
    const pts = [];
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i], b = stops[(i + 1) % stops.length];
      pts.push(new THREE.Vector3(a.x, 0, a.z));
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      const nx = -dz / len, nz = dx / len; // perpendicular
      const n = len > 120 ? 3 : 2;
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const off = (rand() * 2 - 1) * Math.min(45, len * 0.25);
        pts.push(new THREE.Vector3(a.x + dx * t + nx * off, 0, a.z + dz * t + nz * off));
      }
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);

    // sample + drape
    const N = Math.max(400, Math.round(this.curve.getLength() / 2.5));
    this.samples = [];
    const positions = [], colors = [], indices = [];
    const col = new THREE.Color();
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = this.curve.getPoint(t);
      const tan = this.curve.getTangent(t);
      const nx = -tan.z, nz = tan.x;
      const nl = Math.hypot(nx, nz) || 1;
      const hw = width / 2;
      // slightly uneven edges
      const wl = hw * (0.85 + 0.15 * Math.sin(i * 0.7)), wr = hw * (0.85 + 0.15 * Math.cos(i * 0.9));
      const lx = p.x + (nx / nl) * wl, lz = p.z + (nz / nl) * wl;
      const rx = p.x - (nx / nl) * wr, rz = p.z - (nz / nl) * wr;
      // a little above the ground to avoid z-fighting; ribbon follows the terrain
      positions.push(lx, terrain.heightAt(lx, lz) + 0.12, lz, rx, terrain.heightAt(rx, rz) + 0.12, rz);
      // dirt colour with faint wheel ruts (darker at 1/3 and 2/3 across) and random speckle
      const shade = 0.92 + ((i * 7919) % 100) / 100 * 0.1;
      col.set('#b89d78').multiplyScalar(shade);
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
      if (i % 2 === 0) this.samples.push({ x: p.x, z: p.z });
      if (i < N) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // centre ruts as two thin darker strips
    const rutGeo = new THREE.BufferGeometry();
    const rp = [], ri = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = this.curve.getPoint(t);
      const tan = this.curve.getTangent(t);
      const nx = -tan.z, nz = tan.x;
      const nl = Math.hypot(nx, nz) || 1;
      for (const side of [-1, 1]) {
        const cx = p.x + (nx / nl) * side * width * 0.22, cz = p.z + (nz / nl) * side * width * 0.22;
        const ex = (nx / nl) * 0.35, ez = (nz / nl) * 0.35;
        rp.push(cx + ex, terrain.heightAt(cx + ex, cz + ez) + 0.16, cz + ez, cx - ex, terrain.heightAt(cx - ex, cz - ez) + 0.16, cz - ez);
      }
      if (i < N) {
        const a = i * 4;
        ri.push(a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 2, a + 6, a + 3, a + 3, a + 6, a + 7);
      }
    }
    rutGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rutGeo.setIndex(ri);
    rutGeo.computeVertexNormals();
    const ruts = new THREE.Mesh(rutGeo, new THREE.MeshStandardMaterial({ color: '#8f775a', roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    ruts.receiveShadow = true;
    scene.add(ruts);
  }
}
