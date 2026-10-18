import * as THREE from 'three';

/**
 * Bruno-Simon-style fixed-angle follow camera: always looks from the same direction,
 * lerps toward the truck, zooms with the wheel / pinch. A fixed angle keeps the world
 * readable like a diorama and never clips through geometry.
 */
export class FollowCamera {
  constructor(camera, domElement) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.zoom = 1.3;              // 0.5 (close) .. 2.6 (far)
    this.offsetDir = new THREE.Vector3(1, 0.95, 1).normalize(); // isometric-ish from +x,+z
    this.baseDistance = 50;
    this.lookAhead = 2.5;
    this.smooth = 3;              // higher = snappier
    this.scale = 1;               // extra distance multiplier (eased toward targetScale); < 1 when on foot
    this.targetScale = 1;

    this._lookAt = new THREE.Vector3();
    this._desired = new THREE.Vector3();

    domElement.addEventListener('wheel', (e) => {
      this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.0012, 0.5, 2.6);
    }, { passive: true });

    // Pinch zoom
    let lastDist = null;
    domElement.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (lastDist) this.zoom = THREE.MathUtils.clamp(this.zoom - (d - lastDist) * 0.004, 0.5, 2.6);
        lastDist = d;
      }
    }, { passive: true });
    domElement.addEventListener('touchend', () => { lastDist = null; });
  }

  /** Snap instantly (on spawn/reset). */
  snapTo(position) {
    this.target.copy(position);
    this.scale = this.targetScale;
    this._desired.copy(this.target).addScaledVector(this.offsetDir, this.baseDistance * this.zoom * this.scale);
    this.camera.position.copy(this._desired);
    this.camera.lookAt(this.target);
  }

  /**
   * @param focus optional world position (e.g. the landmark you're parked at) to frame
   *              together with the truck.
   */
  update(truckPosition, truckVelocity, dt, focus = null) {
    // Look slightly ahead of where the truck is going
    this._lookAt.copy(truckPosition).addScaledVector(truckVelocity, this.lookAhead * 0.06);
    if (focus) this._lookAt.lerp(focus, 0.4);
    this.target.x = THREE.MathUtils.damp(this.target.x, this._lookAt.x, this.smooth, dt);
    this.target.y = THREE.MathUtils.damp(this.target.y, this._lookAt.y, this.smooth, dt);
    this.target.z = THREE.MathUtils.damp(this.target.z, this._lookAt.z, this.smooth, dt);

    this.scale = THREE.MathUtils.damp(this.scale, this.targetScale, 2, dt);
    this._desired.copy(this.target).addScaledVector(this.offsetDir, this.baseDistance * this.zoom * this.scale);
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this._desired.x, this.smooth * 1.5, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this._desired.y, this.smooth * 1.5, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this._desired.z, this.smooth * 1.5, dt);
    this.camera.lookAt(this.target);
  }
}
