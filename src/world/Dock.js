import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * A wooden dock reaching out from a lake shore, with a mooring for the submarine at its end.
 * Exposes `platform` (for the pilot's ground test), `moor` (where the sub floats) and
 * `boardSpot` (where the pilot stands to climb aboard).
 */
export class Dock {
  constructor(terrain, world, scene, lake, { toward = { x: 0, z: 0 }, length = 18, width = 3.2, top = 0.45 } = {}) {
    // direction from the lake centre toward `toward` (the shore we build on)
    const dx = toward.x - lake.x, dz = toward.z - lake.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    // walk outward from the centre until the bank climbs above the water
    let r = lake.radius * 0.5;
    while (terrain.heightAt(lake.x + ux * r, lake.z + uz * r) < terrain.waterLevel + 0.35 && r < lake.radius * 1.6) r += 0.5;
    const shoreR = r + 1.5;
    const yaw = Math.atan2(-ux, -uz);                  // dock points from shore toward the lake centre
    const cx = lake.x + ux * (shoreR - length / 2), cz = lake.z + uz * (shoreR - length / 2);
    this.yaw = yaw;
    this.center = new THREE.Vector3(cx, top, cz);
    this.platform = { x: cx, z: cz, yaw, hw: width / 2, hl: length / 2, top };
    const endR = shoreR - length;
    this.end = new THREE.Vector3(lake.x + ux * endR, top, lake.z + uz * endR);
    // sub moors alongside the dock's end (to its right-hand side when walking out)
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    this.moor = new THREE.Vector3(this.end.x + rx * 4.6 + ux * 1.5, terrain.waterLevel - 0.6, this.end.z + rz * 4.6 + uz * 1.5);
    this.moorYaw = yaw;
    this.boardSpot = new THREE.Vector3(this.end.x + rx * 0.9 + ux * 1.5, top, this.end.z + rz * 0.9 + uz * 1.5);

    this.#build(terrain, world, scene, length, width, top);
  }

  #build(terrain, world, scene, length, width, top) {
    const wood = new THREE.MeshStandardMaterial({ color: '#8c6a3f', roughness: 0.9 });
    const woodDark = new THREE.MeshStandardMaterial({ color: '#6b4f2d', roughness: 0.95 });
    const rope = new THREE.MeshStandardMaterial({ color: '#d9c7a3', roughness: 1 });
    const g = new THREE.Group();
    g.position.copy(this.center);
    g.rotation.y = this.yaw;

    // planks across the walkway
    const plankGeo = new THREE.BoxGeometry(width, 0.12, 0.42);
    const n = Math.floor(length / 0.5);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(plankGeo, i % 7 === 3 ? woodDark : wood);
      p.position.set(0, -0.06, -length / 2 + 0.25 + i * 0.5);
      p.rotation.y = (Math.sin(i * 12.9) * 0.01);
      p.castShadow = p.receiveShadow = true;
      g.add(p);
    }
    // stringers under the planks
    for (const x of [-width / 2 + 0.2, width / 2 - 0.2]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, length), woodDark);
      s.position.set(x, -0.25, 0);
      g.add(s);
    }
    // piles down to the lake bed, with mooring posts at the end
    const pileGeo = new THREE.CylinderGeometry(0.16, 0.2, 1, 8);
    for (let i = 0; i <= Math.floor(length / 3); i++) {
      const z = -length / 2 + 0.6 + i * 3;
      for (const x of [-width / 2 + 0.25, width / 2 - 0.25]) {
        const wx = this.center.x + Math.cos(this.yaw) * x + Math.sin(this.yaw) * z;
        const wz = this.center.z - Math.sin(this.yaw) * x + Math.cos(this.yaw) * z;
        const bed = terrain.heightAt(wx, wz) - 0.5;
        const h = top - bed + (i === Math.floor(length / 3) ? 1.0 : 0.25);
        const pile = new THREE.Mesh(pileGeo, woodDark);
        pile.scale.y = h;
        pile.position.set(x, -(top - bed) + h / 2, z);
        pile.castShadow = true;
        g.add(pile);
      }
    }
    // rope rail along the left side
    const railGeo = new THREE.CylinderGeometry(0.04, 0.04, 3, 6);
    railGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < Math.floor(length / 3); i++) {
      const r = new THREE.Mesh(railGeo, rope);
      r.position.set(-width / 2 + 0.25, 0.75, -length / 2 + 2.1 + i * 3);
      r.rotation.x = 0.08;
      g.add(r);
    }
    // a lifebuoy on the last post
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.13, 8, 20), new THREE.MeshStandardMaterial({ color: '#ff5a3c', roughness: 0.6 }));
    buoy.position.set(width / 2 - 0.25 - 0.22, 1.0, length / 2 - 0.6);
    buoy.rotation.y = Math.PI / 2;
    g.add(buoy);
    // sign at the shore end
    const sign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), woodDark); post.position.y = 0.8;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.06), wood); board.position.y = 1.45;
    sign.add(post, board);
    sign.position.set(width / 2 + 0.5, 0, -length / 2 + 0.5);
    g.add(sign);
    scene.add(g);
    this.group = g;

    // walkable collider
    const body = new CANNON.Body({ mass: 0, material: world.defaultMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(width / 2, 0.3, length / 2)));
    body.position.set(this.center.x, top - 0.3, this.center.z);
    body.quaternion.setFromEuler(0, this.yaw, 0);
    world.addBody(body);
  }
}
