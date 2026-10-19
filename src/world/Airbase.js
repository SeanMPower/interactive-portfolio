import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * The VTANG air base in the east corner: a hangar with "VTANG" painted across its roof, an apron,
 * and a runway that runs west toward the playground. The ground under all of it is flattened by
 * `flatSpots` (feed these to the Terrain before it's built) at AIRBASE.elevation.
 *
 * Runway axis is world -x (take off toward the playground); the hangar's open front faces -x.
 */
export const AIRBASE = {
  elevation: 3.2,
  hangar: { x: 214, z: -186, width: 38, depth: 42, height: 15 },   // centre; width across the runway axis, depth along it
  runway: { x1: 188, x2: 46, z: -186, width: 18 },                  // from the apron (x1) west to the threshold (x2)
  apronRadius: 30,
};

/** Flat spots that carve the base into the terrain (same elevation everywhere, so the runway is level). */
export function airbaseFlatSpots() {
  const { elevation: h, hangar, runway } = AIRBASE;
  const spots = [{ x: hangar.x, z: hangar.z, radius: 34, height: h }];
  for (let x = runway.x1 + 4; x >= runway.x2 - 6; x -= 14) spots.push({ x, z: runway.z, radius: 16, height: h });
  return spots;
}
/** Keep-out circles for the trees. */
export function airbaseAvoid() {
  return airbaseFlatSpots().map((s) => ({ x: s.x, z: s.z, radius: s.radius + 8 }));
}

export class Airbase {
  constructor(terrain, world, scene) {
    this.terrain = terrain;
    const { elevation: y, hangar, runway } = AIRBASE;
    this.y = y;
    // where the jet sits inside the hangar, nose out (toward -x), and where the pilot stands to climb in
    this.park = { x: hangar.x - 6, z: hangar.z, yaw: -Math.PI / 2 };       // heading (sin yaw, cos yaw) = (-1, 0)
    this.boardSpot = new THREE.Vector3(this.park.x + 1, y, this.park.z + 5.5);
    this.#buildRunway(scene, runway, y);
    this.#buildHangar(scene, world, hangar, y);
  }

  /** Is (x, z) on the paved strip (runway + apron)? Used for landing. */
  onRunway(x, z) {
    const { runway, hangar, apronRadius } = AIRBASE;
    if (Math.abs(z - runway.z) < runway.width / 2 + 2 && x > runway.x2 - 4 && x < runway.x1 + 4) return true;
    return Math.hypot(x - (hangar.x - 28), z - hangar.z) < apronRadius;
  }

  #buildRunway(scene, rw, y) {
    const asphalt = new THREE.MeshStandardMaterial({ color: '#3d4046', roughness: 0.95 });
    const concrete = new THREE.MeshStandardMaterial({ color: '#8f8d86', roughness: 0.95 });
    const paint = new THREE.MeshStandardMaterial({ color: '#f2f0e6', roughness: 0.8 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#e8c35e', roughness: 0.8 });
    const g = new THREE.Group();
    const len = rw.x1 - rw.x2, cx = (rw.x1 + rw.x2) / 2;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, rw.width), asphalt);
    strip.rotation.x = -Math.PI / 2; strip.position.set(cx, y + 0.06, rw.z); strip.receiveShadow = true;
    g.add(strip);
    // apron in front of the hangar
    const apron = new THREE.Mesh(new THREE.CircleGeometry(AIRBASE.apronRadius, 32), concrete);
    apron.rotation.x = -Math.PI / 2; apron.position.set(AIRBASE.hangar.x - 28, y + 0.05, AIRBASE.hangar.z); apron.receiveShadow = true;
    g.add(apron);
    // centreline dashes
    for (let x = rw.x2 + 14; x < rw.x1 - 10; x += 9) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.6), paint);
      d.rotation.x = -Math.PI / 2; d.position.set(x, y + 0.08, rw.z); g.add(d);
    }
    // threshold stripes at each end
    for (const [x, dir] of [[rw.x2 + 5, 1], [rw.x1 - 5, -1]]) {
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.0), paint);
        s.rotation.x = -Math.PI / 2; s.position.set(x + dir * 1, y + 0.08, rw.z + k * 2.2); g.add(s);
      }
    }
    // edge lights
    const lightGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const lightMat = new THREE.MeshStandardMaterial({ color: '#fff6c8', emissive: '#ffe28a', emissiveIntensity: 2 });
    for (let x = rw.x2; x <= rw.x1; x += 12) for (const s of [-1, 1]) {
      const l = new THREE.Mesh(lightGeo, lightMat);
      l.position.set(x, y + 0.3, rw.z + s * (rw.width / 2 + 0.8)); g.add(l);
    }
    // taxi line from the runway onto the apron
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.5), yellow);
    taxi.rotation.x = -Math.PI / 2; taxi.position.set(rw.x1 + 10, y + 0.09, rw.z); g.add(taxi);
    // windsock
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 6), new THREE.MeshStandardMaterial({ color: '#cfd3d8' }));
    pole.position.set(rw.x2 + 20, y + 3.5, rw.z - rw.width / 2 - 8); g.add(pole);
    this.sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 8, 1, true), new THREE.MeshStandardMaterial({ color: '#ff7a1f', side: THREE.DoubleSide }));
    this.sock.rotation.z = -Math.PI / 2; this.sock.position.set(rw.x2 + 18.4, y + 6.8, rw.z - rw.width / 2 - 8); g.add(this.sock);
    scene.add(g);
  }

  #buildHangar(scene, world, hg, y) {
    // shell materials are transparent so the building can go see-through while you're inside it (see update)
    const wall = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.85, metalness: 0.15, transparent: true });
    const wallDark = new THREE.MeshStandardMaterial({ color: '#737b85', roughness: 0.85, metalness: 0.15, transparent: true });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.8, metalness: 0.2, transparent: true });
    this.shellMats = [wall, wallDark, roofMat];
    const inside = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 1 });
    const trim = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: 0.7 });
    const g = new THREE.Group();
    g.position.set(hg.x, y, hg.z);
    g.rotation.y = Math.PI / 2;           // local -z (the open front) faces world -x, toward the runway
    const W = hg.width, D = hg.depth, H = hg.height, T = 0.6;
    const box = (w, h, d, m, x, yy, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, yy, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    box(W, 0.3, D, inside, 0, 0.15, 0);                           // floor slab
    box(W, H, T, wall, 0, H / 2, D / 2);                          // back wall
    box(T, H, D, wall, -W / 2, H / 2, 0);                         // side walls
    box(T, H, D, wall, W / 2, H / 2, 0);
    box(W, 3, T, wallDark, 0, H - 1.5, -D / 2);                   // header over the door opening
    for (const sx of [-1, 1]) box(5, H - 3, T, wallDark, sx * (W / 2 - 2.5), (H - 3) / 2, -D / 2); // door jambs
    // slid-open door leaves, parked along the outside of each side wall
    for (const sx of [-1, 1]) box(T, H - 3.4, 11, trim, sx * (W / 2 + 0.7), (H - 3.4) / 2, -D / 2 + 5);
    // shallow gable roof, two slabs
    for (const sx of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(W / 2 + 1.5, 0.5, D + 2), roofMat);
      r.position.set(sx * (W / 4), H + 1.1, 0);
      r.rotation.z = -sx * 0.12;
      r.castShadow = r.receiveShadow = true;
      g.add(r);
    }
    box(1.2, 1.0, D + 2, wallDark, 0, H + 3.4, 0);                // ridge cap
    // roof lettering: a canvas texture draped over the ridge, rotated so it reads from the camera
    const tex = makeRoofText('VTANG');
    const labelMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    this.shellMats.push(labelMat);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.25, W * 0.42), labelMat);
    label.rotation.x = -Math.PI / 2;
    label.rotation.z = -Math.PI / 4; // with the group's 90° turn this puts text-up at world (-1,-1): screen-up for the camera
    label.position.set(0, H + 4.0, 0);
    g.add(label);
    // a couple of interior lights hanging from the roof
    for (const z of [-D / 4, D / 4]) {
      const lamp = new THREE.PointLight('#fff2cc', 40, 40, 1.6);
      lamp.position.set(0, H - 2, z); g.add(lamp);
    }
    scene.add(g);
    this.hangarGroup = g;

    // colliders: walls (static boxes) so the pilot and helicopter can't walk/fly through them
    const body = new CANNON.Body({ mass: 0, material: world.defaultMaterial });
    const add = (w, h, d, x, yy, z) => body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), new CANNON.Vec3(x, yy, z));
    add(W, H, T, 0, H / 2, D / 2); add(T, H, D, -W / 2, H / 2, 0); add(T, H, D, W / 2, H / 2, 0);
    add(W + 3, 0.6, D + 2, 0, H + 1.4, 0);
    body.position.set(hg.x, y, hg.z);
    body.quaternion.setFromEuler(0, Math.PI / 2, 0);
    world.addBody(body);
  }

  /** @param player world position of whoever you are; the hangar shell fades out while you're in or near it */
  update(dt, elapsed, player = null) {
    this.sock.rotation.y = Math.sin(elapsed * 0.7) * 0.25;
    this.sock.rotation.x = Math.sin(elapsed * 2.3) * 0.08;
    if (player) {
      const hg = AIRBASE.hangar;
      // hangar footprint: depth runs along x (its long axis after the 90° turn), width along z. The camera looks from
      // +x,+z, so the building also hides anything on the apron in front of it — fade for that whole strip.
      const inside = player.x > hg.x - hg.depth / 2 - 48 && player.x < hg.x + hg.depth / 2 + 4 && Math.abs(player.z - hg.z) < hg.width / 2 + 16 && player.y < this.y + hg.height + 2;
      const target = inside ? 0.14 : 1;
      for (const m of this.shellMats) {
        m.opacity = THREE.MathUtils.damp(m.opacity, target, 6, dt);
        m.depthWrite = m.opacity > 0.5;
      }
    }
  }
}

function makeRoofText(text) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 352;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = '900 250px "Inter", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 34; ctx.strokeStyle = '#1b1f26';
  ctx.strokeText(text, c.width / 2, c.height / 2 + 10);
  ctx.fillStyle = '#f4d35e';
  ctx.fillText(text, c.width / 2, c.height / 2 + 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
