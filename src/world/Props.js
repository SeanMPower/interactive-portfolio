import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { seededRandom } from './noise.js';

const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 1, ...opts });

/**
 * World dressing: pines, round trees, bushes, flowers, rocks (instanced, static colliders
 * on the big ones), drifting clouds, and knockable crates at the playground.
 */
export class Props {
  constructor(terrain, world, scene, { avoid = [], roads = null, crateCenter = null, seed = 3 } = {}) {
    this.dynamic = [];
    this.clouds = [];
    const rand = seededRandom(seed);
    const half = terrain.half * 0.8;
    const K = (terrain.half * terrain.half) / (130 * 130); // area relative to the original map
    const roadPts = roads ? roads.samples : [];
    const roadHalf = roads ? roads.width / 2 + 2.5 : 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const UP = new THREE.Vector3(0, 1, 0);

    const tooClose = (x, z, r) => avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.radius + r)
      || roadPts.some((q) => Math.abs(q.x - x) < roadHalf + r && Math.abs(q.z - z) < roadHalf + r && Math.hypot(q.x - x, q.z - z) < roadHalf + r);
    const slopeAt = (x, z) => {
      const e = 1.5;
      const dx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
      const dz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
      return Math.hypot(dx, dz) / (2 * e);
    };
    /** Try to find a spot on land that is not too steep, not near landmarks. */
    const pick = (margin, maxSlope, maxH, minFromCenter = 0, range = half) => {
      for (let tries = 0; tries < 40; tries++) {
        const x = (rand() * 2 - 1) * range, z = (rand() * 2 - 1) * range;
        const y = terrain.heightAt(x, z);
        if (y < terrain.waterLevel + 0.6 || y > maxH) continue;
        if (tooClose(x, z, margin) || slopeAt(x, z) > maxSlope || Math.hypot(x, z) < minFromCenter) continue;
        return { x, y, z };
      }
      return null;
    };
    const addInstanced = (geo, mat, count, place) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.castShadow = true; mesh.receiveShadow = true;
      let n = 0;
      for (let i = 0; i < count; i++) if (place(mesh, n)) n++;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      return mesh;
    };
    const staticCylinder = (x, y, z, r, h) => {
      const body = new CANNON.Body({ mass: 0 });
      body.addShape(new CANNON.Cylinder(r, r * 1.2, h, 6));
      body.position.set(x, y + h / 2, z);
      world.addBody(body);
    };

    // ---------- Pines (tall, dark green, three-tier crowns)
    const pines = Math.round(150 * K); // most of these end up on the mountain slopes
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 2.4, 7);
    const pineGeo = new THREE.ConeGeometry(2.0, 5.0, 7);
    const pineMidGeo = new THREE.ConeGeometry(1.5, 4.0, 7);
    const pineTopGeo = new THREE.ConeGeometry(1.0, 3.0, 7);
    const trunkMat = std({ color: '#5a4a3f' });
    const pineMat = std({});
    const pinePalette = ['#1f6b3a', '#24754a', '#2d8a4e', '#1b5e38', '#2f7d3f'];
    const pineSpots = [];
    for (let i = 0; i < pines; i++) {
      const p = pick(4, 1.2, 26, 16, terrain.half * 0.97);
      if (p && (p.y > 9 || rand() < 0.35)) pineSpots.push({ ...p, s: 1.3 + rand() * 1.0, rot: rand() * Math.PI, c: pinePalette[Math.floor(rand() * pinePalette.length)] });
    }
    addInstanced(trunkGeo, trunkMat, pineSpots.length, (mesh, n) => {
      const p = pineSpots[n]; m.compose(new THREE.Vector3(p.x, p.y + 1.2 * p.s, p.z), q.identity(), new THREE.Vector3(p.s, p.s, p.s)); mesh.setMatrixAt(n, m); return true;
    });
    addInstanced(pineGeo, pineMat, pineSpots.length, (mesh, n) => {
      const p = pineSpots[n]; m.compose(new THREE.Vector3(p.x, p.y + 4.4 * p.s, p.z), q.setFromAxisAngle(UP, p.rot), new THREE.Vector3(p.s, p.s, p.s)); mesh.setMatrixAt(n, m); mesh.setColorAt(n, col.set(p.c)); return true;
    });
    addInstanced(pineMidGeo, pineMat, pineSpots.length, (mesh, n) => {
      const p = pineSpots[n]; m.compose(new THREE.Vector3(p.x, p.y + 7.2 * p.s, p.z), q.setFromAxisAngle(UP, p.rot + 0.4), new THREE.Vector3(p.s, p.s, p.s)); mesh.setMatrixAt(n, m); mesh.setColorAt(n, col.set(p.c).offsetHSL(0, 0, 0.04)); return true;
    });
    addInstanced(pineTopGeo, pineMat, pineSpots.length, (mesh, n) => {
      const p = pineSpots[n]; m.compose(new THREE.Vector3(p.x, p.y + 9.6 * p.s, p.z), q.setFromAxisAngle(UP, p.rot + 0.8), new THREE.Vector3(p.s, p.s, p.s)); mesh.setMatrixAt(n, m); mesh.setColorAt(n, col.set(p.c).offsetHSL(0, 0, 0.08)); return true;
    });
    for (const p of pineSpots) staticCylinder(p.x, p.y, p.z, 0.55 * p.s, 11 * p.s);

    // ---------- Maples (tall trunks, full two-tier crowns in Vermont fall colours)
    const maples = Math.round(140 * K);
    const mapleTrunkGeo = new THREE.CylinderGeometry(0.26, 0.5, 5.0, 7);
    const crownGeo = new THREE.IcosahedronGeometry(2.6, 1);
    const crownTopGeo = new THREE.IcosahedronGeometry(1.9, 1);
    const crownMat = std({ flatShading: true });
    // sugar maple reds, oranges, golds, with a few still-green and lime trees mixed in
    const fallPalette = ['#d7341f', '#e2431f', '#e8601c', '#ef7d1a', '#f2a51c', '#f5c42a', '#f5d13a', '#dbb52a', '#b8c22c', '#8fb43b', '#c9532a', '#f08c2c'];
    const mapleSpots = [];
    for (let i = 0; i < maples; i++) {
      const p = pick(4, 0.5, 7.5, 16);
      if (!p) continue;
      const c = new THREE.Color(fallPalette[Math.floor(rand() * fallPalette.length)]);
      // top of the crown is usually a step warmer/brighter than the body, like sun-hit leaves
      const top = c.clone().offsetHSL(-0.015 + rand() * 0.03, 0.05, 0.08);
      mapleSpots.push({ ...p, s: 1.2 + rand() * 1.0, rot: rand() * 3, c, top });
    }
    addInstanced(mapleTrunkGeo, trunkMat, mapleSpots.length, (mesh, n) => {
      const p = mapleSpots[n]; m.compose(new THREE.Vector3(p.x, p.y + 2.5 * p.s, p.z), q.identity(), new THREE.Vector3(p.s, p.s, p.s)); mesh.setMatrixAt(n, m); return true;
    });
    addInstanced(crownGeo, crownMat, mapleSpots.length, (mesh, n) => {
      const p = mapleSpots[n]; m.compose(new THREE.Vector3(p.x, p.y + 6.2 * p.s, p.z), q.setFromEuler(new THREE.Euler(p.rot, p.rot * 2, 0)), new THREE.Vector3(p.s * 1.05, p.s * 0.95, p.s)); mesh.setMatrixAt(n, m); mesh.setColorAt(n, p.c); return true;
    });
    addInstanced(crownTopGeo, crownMat, mapleSpots.length, (mesh, n) => {
      const p = mapleSpots[n]; m.compose(new THREE.Vector3(p.x + (rand() - 0.5) * 0.8, p.y + 8.6 * p.s, p.z + (rand() - 0.5) * 0.8), q.setFromEuler(new THREE.Euler(p.rot * 1.3, p.rot, 0)), new THREE.Vector3(p.s, p.s * 0.9, p.s)); mesh.setMatrixAt(n, m); mesh.setColorAt(n, p.top); return true;
    });
    for (const p of mapleSpots) staticCylinder(p.x, p.y, p.z, 0.55 * p.s, 9 * p.s);

    // ---------- Fallen leaves under the maples
    const leafGeo = new THREE.CircleGeometry(0.22, 5);
    leafGeo.rotateX(-Math.PI / 2);
    addInstanced(leafGeo, std({ side: THREE.DoubleSide }), Math.round(2400 * K), (mesh, n) => {
      const t = mapleSpots[n % mapleSpots.length];
      if (!t) return false;
      const a = rand() * Math.PI * 2, r = rand() * 4.5 * t.s;
      const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
      const y = terrain.heightAt(x, z);
      if (y < terrain.waterLevel + 0.6) return false;
      m.compose(new THREE.Vector3(x, y + 0.06, z), q.setFromAxisAngle(UP, rand() * Math.PI), new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, col.copy(t.c).offsetHSL(0, -0.1, -0.08 + rand() * 0.1));
      return true;
    });

    // keep the round-tree palette name for bushes below
    const roundPalette = ['#3f8f3a', '#4c9a3c', '#6aa84a', '#c9532a', '#e8a94a', '#b8c22c'];
    // ---------- Bushes (no colliders)
    const bushGeo = new THREE.IcosahedronGeometry(0.9, 1);
    addInstanced(bushGeo, std({ flatShading: true }), Math.round(180 * K), (mesh, n) => {
      const p = pick(2, 0.6, 8, 12);
      if (!p) return false;
      const s = 0.6 + rand() * 0.9;
      m.compose(new THREE.Vector3(p.x, p.y + 0.5 * s, p.z), q.setFromEuler(new THREE.Euler(rand(), rand() * 3, 0)), new THREE.Vector3(s * 1.2, s * 0.8, s));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, col.set(roundPalette[Math.floor(rand() * roundPalette.length)]).offsetHSL(0, 0, -0.05));
      return true;
    });

    // ---------- Flowers (tiny colored blobs in clusters)
    const flowerGeo = new THREE.SphereGeometry(0.22, 6, 5);
    const flowerMat = std({ roughness: 0.7 });
    const flowerPalette = ['#ff5d8f', '#ffd166', '#ffffff', '#8ecbff', '#ff8c42', '#c77dff'];
    addInstanced(flowerGeo, flowerMat, Math.round(700 * K), (mesh, n) => {
      // clusters: every 10th flower picks a new centre
      if (n % 10 === 0 || !this._fc) { this._fc = pick(1, 0.4, 5, 10); if (!this._fc) return false; this._fcol = flowerPalette[Math.floor(rand() * flowerPalette.length)]; }
      const x = this._fc.x + (rand() - 0.5) * 7, z = this._fc.z + (rand() - 0.5) * 7;
      const y = terrain.heightAt(x, z);
      if (y < terrain.waterLevel + 0.6) return false;
      m.compose(new THREE.Vector3(x, y + 0.25, z), q.identity(), new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, col.set(this._fcol));
      return true;
    });

    // ---------- Rocks
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = std({ color: '#8f8a93', flatShading: true });
    const rockSpots = [];
    addInstanced(rockGeo, rockMat, Math.round(70 * K), (mesh, n) => {
      const p = pick(3, 1, 20, 12);
      if (!p) return false;
      const s = 0.6 + rand() * 1.8;
      m.compose(new THREE.Vector3(p.x, p.y + s * 0.35, p.z), q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)), new THREE.Vector3(s, s * 0.7, s));
      mesh.setMatrixAt(n, m);
      rockSpots.push({ ...p, s });
      return true;
    });
    for (const r of rockSpots) {
      const body = new CANNON.Body({ mass: 0 });
      body.addShape(new CANNON.Sphere(r.s * 0.75));
      body.position.set(r.x, r.y + r.s * 0.3, r.z);
      world.addBody(body);
    }

    // ---------- Clouds (drift slowly; no physics)
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.92, flatShading: true });
    for (let i = 0; i < Math.round(22 * K); i++) {
      const g = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < puffs; k++) {
        const r = 2.5 + rand() * 3.5;
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
        puff.position.set((k - puffs / 2) * 3.2 + rand() * 2, rand() * 1.5, (rand() - 0.5) * 3);
        puff.scale.y = 0.6;
        puff.castShadow = true;
        g.add(puff);
      }
      g.position.set((rand() * 2 - 1) * terrain.half * 1.1, 38 + rand() * 22, (rand() * 2 - 1) * terrain.half * 1.1);
      g.userData.speed = 0.6 + rand() * 1.2;
      scene.add(g);
      this.clouds.push(g);
    }
    this._cloudLimit = terrain.half * 1.2;

    // ---------- Crates (dynamic) at the playground
    if (crateCenter) {
      const crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
      const colors = ['#ffb547', '#ff7a45', '#4cc9f0', '#b388ff', '#7ee787'];
      const h = 0.8;
      const baseY = terrain.heightAt(crateCenter.x, crateCenter.z);
      let i = 0;
      for (let row = 0; row < 4; row++) {
        const n = 4 - row;
        for (let k = 0; k < n; k++) {
          this.#crate(crateGeo, colors[i++ % colors.length], crateCenter.x + (k - (n - 1) / 2) * 1.7, baseY + h + row * 1.6 + 0.05, crateCenter.z, h, world, scene);
        }
      }
      for (let k = 0; k < 6; k++) {
        const a = rand() * Math.PI * 2, r = 6 + rand() * 6;
        const x = crateCenter.x + Math.cos(a) * r, z = crateCenter.z + Math.sin(a) * r;
        this.#crate(crateGeo, colors[i++ % colors.length], x, terrain.heightAt(x, z) + h + 0.1, z, h, world, scene);
      }
    }
  }

  #crate(geo, color, x, y, z, half, world, scene) {
    const mesh = new THREE.Mesh(geo, std({ color, roughness: 0.8, flatShading: true }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const body = new CANNON.Body({ mass: 12, shape: new CANNON.Box(new CANNON.Vec3(half, half, half)) });
    body.position.set(x, y, z);
    body.sleepSpeedLimit = 0.3;
    body.allowSleep = true;
    world.addBody(body);
    this.dynamic.push({ mesh, body });
  }

  update(dt) {
    for (const d of this.dynamic) {
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
    }
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > this._cloudLimit) c.position.x = -this._cloudLimit;
    }
  }
}
