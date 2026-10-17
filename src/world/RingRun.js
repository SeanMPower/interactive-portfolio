import * as THREE from 'three';

/**
 * Ring Run: a course of floating rings around the map. Fly through the glowing start ring to
 * begin, then through each ring in order; the next ring is lit and a chevron above the HUD
 * points at it. The run is timed; best time is kept in localStorage.
 */
export class RingRun {
  constructor(scene, terrain, { radius = 6 } = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.radius = radius;

    // [x, z, altitude above terrain, yaw of the ring's opening]
    const layout = [
      [0, -60, 10, 0],
      [60, -120, 16, 0.6],
      [120, -30, 22, 1.6],
      [90, 60, 18, 2.4],
      [10, 110, 26, 3.0],
      [-70, 120, 20, 3.6],
      [-140, 40, 30, 4.3],
      [-110, -60, 16, 5.0],
      [-40, -150, 22, 5.6],
      [28, -16, 12, 0.9],
    ];


    const ringGeo = new THREE.TorusGeometry(radius, 0.45, 10, 40);
    this.rings = layout.map(([x, z, alt, yaw], i) => {
      const mat = new THREE.MeshStandardMaterial({ color: '#ffb547', emissive: '#ffb547', emissiveIntensity: 0.2, roughness: 0.4 });
      const mesh = new THREE.Mesh(ringGeo, mat);
      const y = terrain.heightAt(x, z) + alt;
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      scene.add(mesh);
      // number badge: small sphere cluster isn't needed — a flat label on the ring is enough
      const badge = new THREE.Mesh(new THREE.CircleGeometry(1.1, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3, side: THREE.DoubleSide }));
      badge.position.set(0, radius + 1.2, 0);
      mesh.add(badge);
      return { mesh, mat, badge, index: i, normal: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)) };
    });

    this.state = 'idle'; // idle | running | done
    this.next = 0;
    this.time = 0;
    this.best = parseFloat(localStorage.getItem('ringrun-best') || '0') || null;
    this.lastResult = null;
    this.events = [];
    this._prevSide = new Map();
  }

  get total() { return this.rings.length; }

  reset() {
    this.state = 'idle';
    this.next = 0;
    this.time = 0;
    this._prevSide.clear();
  }

  /** @returns one-shot events for the HUD: 'start' | 'ring' | 'finish' */
  update(heliPos, dt, elapsed) {
    if (this.state === 'running') this.time += dt;

    const ready = this.state === 'idle' || this.state === 'done';
    const target = ready ? this.rings[0] : this.rings[this.next];

    for (const r of this.rings) {
      const isNext = r === target;
      const isStart = ready && r.index === 0;
      // visuals: next ring pulses bright, passed rings dim green, others soft
      if (isNext) {
        r.mat.emissiveIntensity = 1.2 + Math.sin(elapsed * 6) * 0.5;
        r.mat.color.set(isStart ? '#7ee787' : '#ffb547');
        r.mat.emissive.set(isStart ? '#7ee787' : '#ffb547');
        r.mesh.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.03);
      } else if (this.state === 'running' && r.index < this.next) {
        r.mat.emissiveIntensity = 0.15;
        r.mat.color.set('#5fa86f');
        r.mat.emissive.set('#5fa86f');
        r.mesh.scale.setScalar(1);
      } else {
        r.mat.emissiveIntensity = 0.2;
        r.mat.color.set('#ffb547');
        r.mat.emissive.set('#ffb547');
        r.mesh.scale.setScalar(1);
      }
      r.badge.lookAt(heliPos.x, r.badge.getWorldPosition(new THREE.Vector3()).y, heliPos.z);
    }

    if (!target) return null;

    // Pass detection: helicopter inside the ring's radius and crossed its plane since last frame
    const rel = new THREE.Vector3().subVectors(heliPos, target.mesh.position);
    const side = rel.dot(target.normal);
    const prev = this._prevSide.get(target.index);
    this._prevSide.set(target.index, side);
    const inPlane = rel.clone().addScaledVector(target.normal, -side).length();
    const crossed = prev !== undefined && Math.sign(prev) !== Math.sign(side) && Math.abs(side) < 8;
    if (crossed && inPlane < this.radius - 0.6) {
      if (ready) {
        this.state = 'running';
        this.time = 0;
        this.next = 1;
        return 'start';
      }
      this.next++;
      if (this.next >= this.rings.length) {
        this.state = 'done';
        this.lastResult = this.time;
        if (!this.best || this.time < this.best) {
          this.best = this.time;
          localStorage.setItem('ringrun-best', String(this.time));
          return 'record';
        }
        return 'finish';
      }
      return 'ring';
    }
    return null;
  }

  /** Direction (xz) from the helicopter to the next ring, for the HUD chevron; null when done. */
  bearingTo(heliPos) {
    const target = this.state === 'running' ? this.rings[this.next] : this.rings[0];
    const dx = target.mesh.position.x - heliPos.x, dz = target.mesh.position.z - heliPos.z;
    return { angle: Math.atan2(dx, dz), distance: Math.hypot(dx, dz), altitude: target.mesh.position.y - heliPos.y };
  }
}

export const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
