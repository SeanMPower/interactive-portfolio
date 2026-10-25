import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { landmarkShapes } from './landmarkShapes.js';

export const PAD_RADIUS = 8;
export const PAD_DISTANCE = 17; // from landmark center (pad edge clears porches/steps)

/**
 * Where a project's pad sits: in front of the landmark on the camera-facing side
 * (the camera always looks from +x,+z), so the landmark never hides the vehicle.
 */
export function padPositionFor(project) {
  const [x, z] = project.position;
  const dir = { x: Math.SQRT1_2, z: Math.SQRT1_2 };
  return { x: x + dir.x * PAD_DISTANCE, z: z + dir.z * PAD_DISTANCE, yaw: Math.atan2(-dir.x, -dir.z) };
}

/**
 * Builds every landmark + its pad, registers colliders, keeps DOM labels in sync and
 * tells you which pad the truck is on.
 */
export class Landmarks {
  constructor(projects, terrain, world, scene, camera) {
    this.projects = projects;
    this.terrain = terrain;
    this.world = world;
    this.scene = scene;
    this.camera = camera;
    this.items = [];
    this.activeId = null;
    this.visited = new Set(JSON.parse(localStorage.getItem('visited') || '[]'));

    const labelRoot = document.getElementById('labels');
    // Helipad pieces (shared geometry + one painted surface texture)
    const baseGeo = new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.3, 1.1, 64);
    const topGeo = new THREE.CircleGeometry(PAD_RADIUS, 64);
    const lightGeo = new THREE.SphereGeometry(0.18, 8, 6);
    const baseMat = new THREE.MeshStandardMaterial({ color: '#4a4f58', roughness: 0.95 });
    const defaultPadTexture = makeHelipadTexture();

    for (const p of projects) {
      const [x, z] = p.position;
      const y = terrain.heightAt(x, z);
      const pad = padPositionFor(p);
      const padY = terrain.heightAt(pad.x, pad.z);

      // --- visual
      const builder = landmarkShapes[p.landmark] || landmarkShapes.tower;
      const { group, colliders, door: doorLocal } = builder(p.color, p);
      group.position.set(x, y - 0.1, z);
      group.rotation.y = pad.yaw + Math.PI; // face the pad
      scene.add(group);
      group.updateMatrixWorld(true);
      // an enterable landmark: the world-space spot outside its door, and which way "out" faces
      const door = doorLocal ? group.localToWorld(new THREE.Vector3(...doorLocal)) : null;
      const doorYaw = group.rotation.y; // local +z (toward the pad) in world yaw

      // --- physics (static boxes, rotated with the landmark)
      const body = new CANNON.Body({ mass: 0 });
      for (const c of colliders) {
        body.addShape(new CANNON.Box(new CANNON.Vec3(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2)), new CANNON.Vec3(...c.offset));
      }
      body.position.set(x, y - 0.1, z);
      body.quaternion.setFromEuler(0, group.rotation.y, 0);
      world.addBody(body);

      // --- helipad: raised asphalt disc with painted markings and perimeter lights
      const padGroup = new THREE.Group();
      padGroup.position.set(pad.x, padY - 0.3, pad.z);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.55;
      base.receiveShadow = true;
      base.castShadow = true;
      // painted top surface — markings are also the emissive map so they can glow
      const padTexture = p.padLogo ? makeHelipadTexture({ logoUrl: p.padLogo, showH: p.padH !== false }) : defaultPadTexture;
      const topMat = new THREE.MeshStandardMaterial({
        map: padTexture, emissiveMap: padTexture, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
        roughness: 0.9, metalness: 0,
      });
      const ring = new THREE.Mesh(topGeo, topMat); // kept as `ring` for the glow code below
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1.105;
      ring.receiveShadow = true;
      // perimeter lights set into the rim of the pad
      const lightMat = new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 1.6 });
      const disc = new THREE.Group(); // perimeter lights (kept as `disc` for the glow code)
      disc.material = lightMat;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const l = new THREE.Mesh(lightGeo, lightMat);
        l.position.set(Math.cos(a) * (PAD_RADIUS - 0.35), 1.15, Math.sin(a) * (PAD_RADIUS - 0.35));
        disc.add(l);
      }
      padGroup.add(base, ring, disc);
      padGroup.rotation.y = pad.yaw; // H reads the right way up from the camera
      scene.add(padGroup);

      // the pad is solid: you can land on it
      const padBody = new CANNON.Body({ mass: 0 });
      padBody.addShape(new CANNON.Cylinder(PAD_RADIUS, PAD_RADIUS + 0.3, 1.1, 16));
      padBody.position.set(pad.x, padY + 0.25, pad.z);
      world.addBody(padBody);

      // --- floating marker above the landmark (arrow) so you can spot it from afar
      const marker = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 4), new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.8 }));
      marker.rotation.x = Math.PI;
      const top = colliders.reduce((m, c) => Math.max(m, c.offset[1] + c.size[1] / 2), 6);
      marker.position.set(x, y + top + 3, z);
      scene.add(marker);

      // --- DOM label
      const label = document.createElement('div');
      label.className = 'label' + (this.visited.has(p.id) ? ' visited' : '');
      label.textContent = p.title;
      label.style.borderColor = p.color;
      labelRoot.appendChild(label);

      this.items.push({ project: p, group, body, ring, disc, marker, label, pad: { ...pad, y: padY }, padTop: padY + 0.8, baseY: y + top + 3, door, doorYaw });
    }
  }

  /**
   * Returns the project whose pad the vehicle is over, or null. Updates visuals.
   * @param maxAbove how high above the pad still counts (so a helicopter has to come down)
   */
  update(pos, dt, elapsed, maxAbove = Infinity) {
    let active = null;
    const v = new THREE.Vector3();
    const w = window.innerWidth, h = window.innerHeight;

    for (const it of this.items) {
      const d = Math.hypot(pos.x - it.pad.x, pos.z - it.pad.z);
      const inside = d < PAD_RADIUS && pos.y - it.pad.y < maxAbove;
      if (inside) active = it.project;

      // markings glow when hovering over the pad; perimeter lights pulse otherwise
      it.ring.material.emissiveIntensity = inside ? 0.45 + Math.sin(elapsed * 6) * 0.2 : 0;
      it.disc.material.emissiveIntensity = inside ? 2.5 : 1.2 + Math.sin(elapsed * 2 + it.pad.x) * 0.5;

      // marker bob + spin
      it.marker.position.y = it.baseY + Math.sin(elapsed * 2 + it.pad.z) * 0.4;
      it.marker.rotation.y += dt * 1.5;
      if (it.group.userData.spin) it.group.userData.spin.rotation.z += dt * 0.8;

      // label projection
      v.set(it.marker.position.x, it.marker.position.y + 1.6, it.marker.position.z).project(this.camera);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      it.label.style.opacity = onScreen ? (inside ? 1 : 0.85) : 0;
      if (onScreen) {
        it.label.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
        it.label.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
      }
    }

    this.activeId = active?.id ?? null;
    return active;
  }

  markVisited(id) {
    this.visited.add(id);
    localStorage.setItem('visited', JSON.stringify([...this.visited]));
    this.items.find((i) => i.project.id === id)?.label.classList.add('visited');
  }

  get(id) { return this.items.find((i) => i.project.id === id); }
}

/**
 * Paints a helipad surface on a canvas. Default: dark asphalt, white dashed outer ring, gold inner
 * circle and gold H. With `logoUrl`, the image is painted around the edge instead of the rings
 * (a brush-stroke ensō stands in until the image loads; if it never loads, the ensō stays).
 */
export function makeHelipadTexture({ logoUrl = null, showH = true, size = 1024 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, R = size / 2;
  const WHITE = '#e9e9e6', GOLD = '#d9a93b';

  const paintAsphalt = () => {
    ctx.fillStyle = '#3b3e45';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i++) {
      const v = 50 + Math.random() * 40;
      ctx.fillStyle = `rgba(${v},${v},${v + 6},${0.5 + Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
    const grad = ctx.createRadialGradient(cx, cx, R * 0.4, cx, cx, R);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  };
  const paintH = (k = 1) => {
    const hw = R * 0.26 * k, hh = R * 0.36 * k, t = R * 0.09 * k;
    ctx.fillStyle = GOLD;
    ctx.fillRect(cx - hw, cx - hh, t, hh * 2);
    ctx.fillRect(cx + hw - t, cx - hh, t, hh * 2);
    ctx.fillRect(cx - hw, cx - t / 2, hw * 2, t);
  };
  const paintTicks = () => {
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = R * 0.02;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.93, cx + Math.sin(a) * R * 0.93);
      ctx.lineTo(cx + Math.cos(a) * R * 0.97, cx + Math.sin(a) * R * 0.97);
      ctx.stroke();
    }
  };
  const paintStandardRings = () => {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = R * 0.055;
    for (let k = 0; k < 4; k++) {
      const a0 = k * (Math.PI / 2) + 0.22, a1 = (k + 1) * (Math.PI / 2) - 0.22;
      ctx.beginPath(); ctx.arc(cx, cx, R * 0.82, a0, a1); ctx.stroke();
    }
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = R * 0.045;
    ctx.beginPath(); ctx.arc(cx, cx, R * 0.56, 0, Math.PI * 2); ctx.stroke();
  };
  /** Brush-stroke ensō: a thick ring whose width swells and tapers, with a gap, in off-white. */
  const paintInnerCircle = (r = R * 0.56) => {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = R * 0.045;
    ctx.beginPath(); ctx.arc(cx, cx, r, 0, Math.PI * 2); ctx.stroke();
  };
  const paintEnso = () => {
    const r = R * 0.78, start = -Math.PI * 0.62, end = start + Math.PI * 1.9;
    ctx.fillStyle = '#efe9dc';
    for (let i = 0; i <= 160; i++) {
      const u = i / 160;
      const a = start + (end - start) * u;
      const w = R * (0.035 + 0.075 * Math.sin(Math.PI * Math.pow(u, 0.8)));
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, w, 0, Math.PI * 2);
      ctx.fill();
    }
    // dry-brush texture: nibble the stroke with asphalt-colored flecks
    ctx.fillStyle = 'rgba(59,62,69,0.55)';
    for (let i = 0; i < 900; i++) {
      const a = start + Math.random() * (end - start);
      const rr = r + (Math.random() - 0.5) * R * 0.18;
      ctx.fillRect(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, 3, 3);
    }
  };

  // In logo mode the gold circle + H sit smaller, inside the logo ring
  const paintLogoCenter = () => { if (showH) { paintInnerCircle(R * 0.46); paintH(0.78); } };

  paintAsphalt();
  if (logoUrl) {
    paintEnso();
    paintLogoCenter();
    const img = new Image();
    img.onload = () => {
      paintAsphalt();
      const d = R * 2 * 0.94; // logo fills the disc, leaving a thin asphalt margin at the edge
      ctx.drawImage(img, cx - d / 2, cx - d / 2, d, d);
      paintLogoCenter();
      tex.needsUpdate = true;
    };
    img.src = logoUrl;
  } else {
    paintStandardRings();
    if (showH) paintH();
    paintTicks();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
