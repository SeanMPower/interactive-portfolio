import * as THREE from 'three';

/** Cheap wheel-dust: a pool of instanced puffs that scale up and fade out. */
export class Dust {
  constructor(scene, count = 120) {
    this.count = count;
    this.mesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.35, 0),
      new THREE.MeshStandardMaterial({ color: '#d9c7a3', roughness: 1, transparent: true, opacity: 0.75, flatShading: true }),
      count
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.particles = Array.from({ length: count }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1 }));
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  emit(position, baseVelocity, strength = 1) {
    const p = this.particles[this.next];
    this.next = (this.next + 1) % this.count;
    p.life = 1;
    p.size = (0.6 + Math.random() * 0.8) * strength;
    p.pos.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.6));
    p.vel.set((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2).addScaledVector(baseVelocity, -0.15);
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      if (p.life > 0) {
        p.life -= dt * 1.6;
        p.pos.addScaledVector(p.vel, dt);
        p.vel.y -= dt * 2;
        const s = p.size * (1.2 - p.life) * Math.max(p.life, 0) * 6;
        this._s.setScalar(Math.max(s, 0.0001));
        this._m.compose(p.pos, this._q, this._s);
      } else {
        this._s.setScalar(0.0001);
        this._m.compose(p.pos, this._q, this._s);
      }
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
