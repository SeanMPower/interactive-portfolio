import * as THREE from 'three';

/** Course layout: [x, z, altitude above terrain, yaw of the ring's opening]. */
export const RING_LAYOUT = [
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

/**
 * Ring Run: a course of floating rings around the map. Fly through the glowing start ring to
 * begin, then through each ring in order; the next ring is lit, a chevron in the HUD points at
 * it, and a boxy translucent arrow floats above the helicopter aiming at it in 3D.
 * The run is timed; best time is kept in localStorage.
 */
export class RingRun {
  /**
   * @param {{ radius?: number, obstacles?: {x:number,z:number,top:number}[], clearance?: number }} opts
   *   obstacles: canopy tops (Props.trees). A ring whose bottom would sit inside a tree is lifted
   *   so its lowest point clears the tallest nearby canopy by `clearance` metres.
   */
  constructor(scene, terrain, { radius = 6, obstacles = [], clearance = 2.5, arrowReach = () => 18, camera = null } = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.radius = radius;
    this.arrowReach = arrowReach; // max metres from the heli for a far-away ring's arrow
    this.camera = camera;         // used to keep the arrow inside the viewport on narrow (phone) screens

    const layout = RING_LAYOUT;
    const minCenterY = (x, z) => {
      let top = -Infinity;
      for (const o of obstacles) if (Math.hypot(o.x - x, o.z - z) < radius + 4) top = Math.max(top, o.top);
      return top === -Infinity ? -Infinity : top + clearance + radius;
    };


    const ringGeo = new THREE.TorusGeometry(radius, 0.45, 10, 40);
    this.rings = layout.map(([x, z, alt, yaw], i) => {
      const mat = new THREE.MeshStandardMaterial({ color: '#ffb547', emissive: '#ffb547', emissiveIntensity: 0.2, roughness: 0.4 });
      const mesh = new THREE.Mesh(ringGeo, mat);
      const y = Math.max(terrain.heightAt(x, z) + alt, minCenterY(x, z));
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      scene.add(mesh);
      // number badge: small sphere cluster isn't needed — a flat label on the ring is enough
      const badge = new THREE.Mesh(new THREE.CircleGeometry(1.1, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3, side: THREE.DoubleSide }));
      badge.position.set(0, radius + 1.2, 0);
      mesh.add(badge);
      return { mesh, mat, badge, index: i, normal: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)) };
    });

    // Guide arrow: one solid, beveled slab (shaft + head extruded from a single outline) so the head
    // can never separate from the shaft. Built pointing along +Z so lookAt() aims it. Shown while running.
    const outline = new THREE.Shape();
    const L = 2.6, W = 0.62, HW = 1.55, HL = 1.9; // half-length, half shaft width, half head width, head length
    outline.moveTo(-W, -L);
    outline.lineTo(W, -L);
    outline.lineTo(W, L - HL);
    outline.lineTo(HW, L - HL);
    outline.lineTo(0, L);
    outline.lineTo(-HW, L - HL);
    outline.lineTo(-W, L - HL);
    outline.closePath();
    const thickness = 0.9;
    const arrowGeo = new THREE.ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 3 });
    arrowGeo.rotateX(Math.PI / 2);          // shape +Y (tip) → +Z, extrusion → -Y
    arrowGeo.translate(0, thickness / 2, 0); // centre the slab vertically
    const arrowMat = new THREE.MeshPhysicalMaterial({
      color: '#d8232a', emissive: '#7a0a10', emissiveIntensity: 0.35,
      roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15,
      transparent: true, opacity: 0.62, depthWrite: false,
    });
    this.arrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.arrow.visible = false;
    this.arrow.renderOrder = 10;
    scene.add(this.arrow);
    this._arrowTarget = new THREE.Vector3();
    this._arrowPos = new THREE.Vector3();
    this._ndc = new THREE.Vector3();

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

    // Guide arrow: sits on the line from the helicopter to the next ring. Far ring → pushed out toward
    // the screen edge; as the ring gets closer the arrow slides in beside the helicopter. Aims in 3D.
    this.arrow.visible = this.state === 'running';
    if (this.arrow.visible) {
      const tp = target.mesh.position;
      const dx = tp.x - heliPos.x, dz = tp.z - heliPos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const far = Math.min(1, dist / 90);                  // 0 = on top of the ring, 1 = ≥90 m away
      const reach = Math.min(this.arrowReach(), dist * 0.5); // never past the halfway point to the ring
      let offset = 4 + (reach - 4) * far;
      const ay = heliPos.y + 3 + Math.sin(elapsed * 2.5) * 0.3;
      this._arrowPos.set(heliPos.x + (dx / dist) * offset, ay, heliPos.z + (dz / dist) * offset);
      // Keep it on screen: pull the arrow in until its projected position sits inside the viewport
      // with a margin (portrait phones have a much narrower horizontal field than desktops).
      if (this.camera) {
        const LX = 0.62, LY = 0.66; // NDC limits (1 = screen edge); leaves room for the arrow's size and the HUD
        for (let i = 0; i < 8 && offset > 4; i++) {
          this._ndc.copy(this._arrowPos).project(this.camera);
          if (Math.abs(this._ndc.x) <= LX && Math.abs(this._ndc.y) <= LY) break;
          offset = Math.max(4, offset * 0.8);
          this._arrowPos.set(heliPos.x + (dx / dist) * offset, ay, heliPos.z + (dz / dist) * offset);
        }
      }
      this.arrow.position.copy(this._arrowPos);
      this.arrow.lookAt(tp);
      this.arrow.scale.setScalar(1.1 + 0.5 * far);         // a little bigger when it's out at the edge
    }

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
