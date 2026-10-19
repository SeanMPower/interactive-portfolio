import * as THREE from 'three';
import { seededRandom } from './noise.js';

/**
 * Winding dirt roads. `routes` is a list of { stops: [{x,z}...], closed } — typically one ring
 * road through all the landmark pads plus a spur from the spawn clearing. Each route becomes a
 * Catmull-Rom spline with gently jittered waypoints between stops (jitter is capped relative to
 * the leg length so the road never bends tighter than its own width), draped onto the terrain
 * as a ribbon mesh. `samples` is exposed so trees keep off the roads.
 */
export class Roads {
  constructor(terrain, scene, routes, { width = 6, seed = 11 } = {}) {
    this.width = width;
    this.samples = [];
    this.paths = [];      // one polyline per route, for the map
    const rand = seededRandom(seed);
    const positions = [], colors = [], indices = [];
    const col = new THREE.Color();
    let vert = 0;

    for (const route of routes) {
      const stops = route.stops;
      const pts = [];
      const nLegs = route.closed ? stops.length : stops.length - 1;
      for (let i = 0; i < nLegs; i++) {
        const a = stops[i], b = stops[(i + 1) % stops.length];
        pts.push(new THREE.Vector3(a.x, 0, a.z));
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        const nx = -dz / len, nz = dx / len;
        const n = len > 160 ? 3 : len > 80 ? 2 : 1;
        // alternate the side of the wiggle so legs read as S-curves, not zig-zags
        let side = rand() < 0.5 ? 1 : -1;
        for (let k = 1; k <= n; k++) {
          const t = k / (n + 1);
          const off = side * (0.4 + rand() * 0.6) * Math.min(28, len * 0.12);
          pts.push(new THREE.Vector3(a.x + dx * t + nx * off, 0, a.z + dz * t + nz * off));
          side = -side;
        }
      }
      if (!route.closed) pts.push(new THREE.Vector3(stops[stops.length - 1].x, 0, stops[stops.length - 1].z));
      const curve = new THREE.CatmullRomCurve3(pts, !!route.closed, 'centripetal', 0.5);

      this.paths.push(curve.getSpacedPoints(120).map((p) => ({ x: p.x, z: p.z })));
      const N = Math.max(200, Math.round(curve.getLength() / 2.5));
      const hw = width / 2;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = curve.getPoint(t);
        const tan = curve.getTangent(t);
        const nl = Math.hypot(tan.x, tan.z) || 1;
        const nx = -tan.z / nl, nz = tan.x / nl;
        const wl = hw * (0.88 + 0.12 * Math.sin(i * 0.7)), wr = hw * (0.88 + 0.12 * Math.cos(i * 0.9));
        const lx = p.x + nx * wl, lz = p.z + nz * wl;
        const rx = p.x - nx * wr, rz = p.z - nz * wr;
        positions.push(lx, terrain.heightAt(lx, lz) + 0.12, lz, rx, terrain.heightAt(rx, rz) + 0.12, rz);
        const shade = 0.93 + ((i * 7919) % 100) / 100 * 0.08;
        col.set('#b89d78').multiplyScalar(shade);
        colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
        if (i % 2 === 0) this.samples.push({ x: p.x, z: p.z });
        if (i < N) {
          const a = vert + i * 2, b = a + 1, c = a + 2, d = a + 3;
          indices.push(a, c, b, b, c, d);
        }
      }
      vert += (N + 1) * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }
}
