import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * The gallery inside the Projects building: its own scene and its own little physics world
 * that the main loop renders and steps instead of the overworld while the pilot is indoors.
 *
 * It is a dollhouse cutaway, because the camera is fixed at +x,+z: the two far walls (-x and -z)
 * are solid and hung with the paintings; the two near walls are knee-high glass so nothing
 * stands between the camera and the room. (Physics still has four full-height walls.)
 *
 * Each entry in `project.gallery` becomes one large painting: a screenshot if the entry has an
 * `image`, otherwise a poster painted from its title, tech line and colour. `nearest(pos)` says
 * which painting the pilot is standing in front of; the main loop opens it with the overlay.
 */
export class Gallery {
  constructor(project) {
    this.project = project;
    this.items = project.gallery || [];
    this.active = false;
    this.focus = null;              // world position of the painting the pilot is in front of (camera framing)
    this.outsideWorld = null;       // the overworld's cannon world, remembered on enter()
    this.HW = 14; this.HD = 14; this.H = 7; // half width (x), half depth (z), wall height

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0f1218');
    this.scene.add(new THREE.AmbientLight('#fff1e0', 0.35));
    this.scene.add(new THREE.HemisphereLight('#fff6ea', '#6b5a48', 0.9));
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.4); // "skylight": soft shadows across the floor
    this.sun.position.set(18, 30, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 5; this.sun.shadow.camera.far = 90;
    const S = 26;
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S; this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.4;
    this.world.defaultContactMaterial.restitution = 0.05;

    this.paintings = [];
    this.spawn = new THREE.Vector3(0, 0, this.HD - 4);   // just inside the doors, facing the room
    this.door = new THREE.Vector3(0, 0, this.HD - 1.2);  // stand here to leave
    this.#buildRoom();
    this.#hangPaintings();
  }

  // ------------------------------------------------------------------ building it
  #buildRoom() {
    const { HW, HD, H } = this;
    const scene = this.scene;
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
    const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
    const wall = mat('#f1ede6');
    const trim = mat('#2a2d36', { roughness: 0.6 });
    const walnut = mat('#4a3324', { roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: '#bfe6ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 });
    const accent = new THREE.Color(this.project.color || '#4cc9f0');

    // floor: oak planks (canvas), with a rug in the middle
    const floorTex = plankTexture();
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(HW / 2, HD / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 1, HD * 2 + 1), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(11, 7.5), mat('#3f4f6e', { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(1.5, 0.02, 1.5); rug.receiveShadow = true; scene.add(rug);
    const rugBorder = new THREE.Mesh(new THREE.PlaneGeometry(10, 6.5), mat('#56688a', { roughness: 1 }));
    rugBorder.rotation.x = -Math.PI / 2; rugBorder.position.set(1.5, 0.03, 1.5); scene.add(rugBorder);

    // the two far walls carry the paintings; baseboards and a cornice along the top
    box(HW * 2 + 1, H, 0.5, wall, 0, H / 2, -HD - 0.25);
    box(0.5, H, HD * 2 + 1, wall, -HW - 0.25, H / 2, 0);
    box(HW * 2 + 1, 0.3, 0.1, trim, 0, 0.15, -HD + 0.05);
    box(0.1, 0.3, HD * 2 + 1, trim, -HW + 0.05, 0.15, 0);
    box(HW * 2 + 1.2, 0.25, 0.7, trim, 0, H + 0.1, -HD - 0.15);
    box(0.7, 0.25, HD * 2 + 1.2, trim, -HW - 0.15, H + 0.1, 0);

    // the two near walls are knee-high glass on a dark sill, open to the camera
    const sillR = box(0.3, 0.9, HD * 2 + 0.6, trim, HW + 0.15, 0.45, 0);
    const glassR = box(0.08, 0.9, HD * 2 + 0.6, glass, HW + 0.15, 1.35, 0); glassR.castShadow = false;
    sillR.castShadow = false;
    for (const side of [-1, 1]) { // front wall, split either side of the doorway
      const len = HW - 2.3, cx = side * (2.3 + len / 2);
      box(len, 0.9, 0.3, trim, cx, 0.45, HD + 0.15).castShadow = false;
      box(len, 0.9, 0.08, glass, cx, 1.35, HD + 0.15).castShadow = false;
    }
    // doorway: frame, two glass doors in the building's colour, a mat, and an exit sign
    box(0.3, 3.4, 0.4, trim, -2.3, 1.7, HD + 0.15);
    box(0.3, 3.4, 0.4, trim, 2.3, 1.7, HD + 0.15);
    box(4.9, 0.35, 0.4, trim, 0, 3.4, HD + 0.15);
    const doorMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.25, roughness: 0.4, transparent: true, opacity: 0.75 });
    for (const x of [-1.1, 1.1]) box(2.0, 3.1, 0.12, doorMat, x, 1.6, HD + 0.15);
    const matTex = labelTexture('EXIT', '', '#ffffff', '#1f6f3f');
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.45), new THREE.MeshStandardMaterial({ map: matTex, emissiveMap: matTex, emissive: '#ffffff', emissiveIntensity: 0.9 }));
    exitSign.position.set(0, 3.85, HD - 0.1); exitSign.rotation.y = Math.PI; scene.add(exitSign);
    const doormat = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), mat('#6b5b4a', { roughness: 1 }));
    doormat.rotation.x = -Math.PI / 2; doormat.position.set(0, 0.025, HD - 1.3); scene.add(doormat);

    // furniture: a bench in the middle, a reception desk by the door, plants in the corners
    const bench = box(5, 0.3, 1.3, walnut, 1.5, 0.6, 1.5);
    for (const x of [-2, 2]) box(0.3, 0.45, 1.1, trim, 1.5 + x, 0.23, 1.5);
    const deskColor = accent.clone().multiplyScalar(0.55);
    const desk = box(4.6, 1.05, 1.3, mat(deskColor, { roughness: 0.6 }), 7, 0.525, HD - 4);
    box(4.9, 0.08, 1.5, mat('#e8e2d8', { roughness: 0.5 }), 7, 1.09, HD - 4);
    const plaqueTex = labelTexture(this.project.title || 'Projects', 'gallery', '#ffffff', '#1d2230');
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.5 }));
    plaque.position.set(7, 0.62, HD - 4 + 0.66); scene.add(plaque);
    const plant = (x, z) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.9, 10), mat('#8d6e52')); pot.position.set(x, 0.45, z); pot.castShadow = true; scene.add(pot);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.5 - i * 0.05, 7, 6), mat(i % 2 ? '#3e8a35' : '#5aa84a'));
        leaf.position.set(x + Math.cos(i * 2.3) * 0.35, 1.2 + i * 0.28, z + Math.sin(i * 2.3) * 0.35); leaf.castShadow = true; scene.add(leaf);
      }
    };
    plant(HW - 1.2, -HD + 1.2); plant(-HW + 1.2, HD - 1.2); plant(HW - 1.2, HD - 1.2);

    // physics: floor, four full-height walls, the bench and the desk
    const floorBody = new CANNON.Body({ mass: 0, material: this.world.defaultMaterial });
    floorBody.addShape(new CANNON.Plane());
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floorBody);
    const solid = (w, h, d, x, y, z) => {
      const b = new CANNON.Body({ mass: 0, material: this.world.defaultMaterial });
      b.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
      b.position.set(x, y, z);
      this.world.addBody(b);
    };
    solid(HW * 2 + 2, H, 1, 0, H / 2, -HD - 0.5);
    solid(HW * 2 + 2, H, 1, 0, H / 2, HD + 0.5);
    solid(1, H, HD * 2 + 2, -HW - 0.5, H / 2, 0);
    solid(1, H, HD * 2 + 2, HW + 0.5, H / 2, 0);
    solid(5, 0.75, 1.3, bench.position.x, 0.4, bench.position.z);
    solid(4.6, 1.1, 1.3, desk.position.x, 0.55, desk.position.z);
  }

  /** Four big framed paintings: two on the left wall (nearest the door first), two on the back wall. */
  #hangPaintings() {
    const { HW, HD } = this;
    const PW = 8.8, PH = 5.5, CY = 3.9;  // painting size and centre height
    const slots = [
      { pos: [-HW + 0.02, CY, 5.5], rotY: Math.PI / 2 },   // left wall, near the door
      { pos: [-HW + 0.02, CY, -5.5], rotY: Math.PI / 2 },  // left wall, far corner
      { pos: [-5.5, CY, -HD + 0.02], rotY: 0 },            // back wall, left
      { pos: [5.5, CY, -HD + 0.02], rotY: 0 },             // back wall, right
    ];
    const walnut = new THREE.MeshStandardMaterial({ color: '#3b2a1e', roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: '#c9a35a', roughness: 0.4, metalness: 0.6 });
    const matte = new THREE.MeshStandardMaterial({ color: '#f7f4ee', roughness: 0.95 });
    const lampMat = new THREE.MeshStandardMaterial({ color: '#2a2d36', roughness: 0.5 });

    this.items.forEach((item, i) => {
      const slot = slots[i % slots.length];
      const g = new THREE.Group();
      g.position.set(...slot.pos);
      g.rotation.y = slot.rotY;
      const add = (mesh) => { mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
      // frame: walnut with a gold inner lip, white mat, then the canvas
      add(new THREE.Mesh(new THREE.BoxGeometry(PW + 0.7, PH + 0.7, 0.22), walnut)).position.z = 0.11;
      add(new THREE.Mesh(new THREE.BoxGeometry(PW + 0.25, PH + 0.25, 0.26), gold)).position.z = 0.13;
      add(new THREE.Mesh(new THREE.BoxGeometry(PW + 0.05, PH + 0.05, 0.28), matte)).position.z = 0.14;
      const tex = posterTexture(item);
      const canvasMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.7 });
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(PW - 0.5, PH - 0.5), canvasMat);
      canvas.position.z = 0.29;
      g.add(canvas);
      // brass nameplate under the frame
      const plaqueTex = labelTexture(item.title, item.tech || '', '#2a1d08', '#d9b96a');
      // sits clear of the floor and proud of the baseboard (which stands 0.1 m off the wall) so the two never z-fight
      const plaque = add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.8, 0.08), [gold, gold, gold, gold, new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.35, metalness: 0.4 }), gold]));
      plaque.position.set(0, -PH / 2 - 0.6, 0.16);
      // a track lamp on an arm above it, and the light it throws
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), lampMat);
      arm.rotation.x = Math.PI / 2; arm.position.set(0, PH / 2 + 1.0, 0.8); g.add(arm);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.45, 10), lampMat);
      lamp.rotation.x = 0.5; lamp.position.set(0, PH / 2 + 0.85, 1.55); g.add(lamp);
      const spot = new THREE.SpotLight('#fff3dc', 160, 18, 0.62, 0.55, 1.6);
      spot.position.set(0, PH / 2 + 0.8, 1.55);
      spot.target.position.set(0, 0, 0.3);
      g.add(spot, spot.target);
      this.scene.add(g);

      // where to stand: a metre and a half out from the wall, straight in front of the painting
      const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotY);
      const stand = new THREE.Vector3(slot.pos[0], 0, slot.pos[2]).addScaledVector(n, 1.5);
      this.paintings.push({ item, group: g, canvasMat, stand, center: new THREE.Vector3(...slot.pos) });
    });
  }

  // ------------------------------------------------------------------ going in and out
  /** Bring the pilot indoors: into this scene and this physics world, standing just inside the doors. */
  enter(pilot) {
    this.active = true;
    this.outsideWorld = pilot.world;
    pilot.deactivate();
    pilot.setWorld(this.world);
    pilot.setFloor(() => 0);
    this.scene.add(pilot.group);
    pilot.activate(this.spawn, Math.PI);
    this.focus = null;
  }

  /** Back outside: the caller places the pilot in the overworld afterwards. */
  exit(pilot, overworldScene) {
    this.active = false;
    pilot.deactivate();
    if (this.outsideWorld) pilot.setWorld(this.outsideWorld);
    pilot.setFloor(null);
    overworldScene.add(pilot.group);
    this.focus = null;
  }

  atDoor(pos) { return Math.hypot(pos.x - this.door.x, pos.z - this.door.z) < 3.2; }

  /** The gallery item the pilot is standing in front of (within reach), or null. Also sets `focus`. */
  nearest(pos) {
    let best = null, bd = 5.5;
    for (const p of this.paintings) {
      const d = Math.hypot(pos.x - p.stand.x, pos.z - p.stand.z);
      if (d < bd) { bd = d; best = p; }
    }
    this.focus = best ? best.center : null;
    return best ? best.item : null;
  }

  update(dt, elapsed) {
    for (const p of this.paintings) {
      const near = this.focus === p.center;
      p.canvasMat.emissiveIntensity = THREE.MathUtils.damp(p.canvasMat.emissiveIntensity, near ? 0.3 + Math.sin(elapsed * 4) * 0.05 : 0.12, 6, dt);
    }
  }
}

// ------------------------------------------------------------------ canvases
/** Oak floorboards. */
function plankTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = (r / rows) * size, h = size / rows;
    const shade = 150 + ((r * 37) % 25);
    ctx.fillStyle = `rgb(${shade + 20},${shade - 20},${shade - 60})`;
    ctx.fillRect(0, y, size, h);
    for (let i = 0; i < 40; i++) { // grain
      ctx.fillStyle = `rgba(60,35,15,${0.05 + Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * size, y + Math.random() * h, 60 + Math.random() * 200, 1.5);
    }
    ctx.fillStyle = 'rgba(40,25,10,0.5)';
    ctx.fillRect(0, y, size, 2);
    const seam = ((r * 211) % size);
    ctx.fillRect(seam, y, 2, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A small text plaque: title on top, a smaller line beneath. */
function labelTexture(title, sub, fg = '#ffffff', bg = '#1d2230') {
  const w = 512, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${sub ? 44 : 64}px system-ui, Helvetica, Arial, sans-serif`;
  ctx.fillText(title, w / 2, sub ? 46 : h / 2, w - 40);
  if (sub) { ctx.font = '26px system-ui, Helvetica, Arial, sans-serif'; ctx.globalAlpha = 0.75; ctx.fillText(sub, w / 2, 92, w - 40); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The painting itself. When the entry has an `image`, that is the painting (cover-fit, nothing
 * written over it — the nameplate under the frame carries the title). Without one, a poster in the
 * project's colour with its title and tech line stands in until a screenshot is added.
 */
function posterTexture(item, w = 1024, h = 640) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(item.color || '#4cc9f0');
  const hex = (k) => '#' + col.clone().multiplyScalar(k).getHexString();

  const title = () => {
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 104px system-ui, Helvetica, Arial, sans-serif';
    const words = item.title.split(' ');
    const lines = [];
    let line = '';
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(t).width > w - 160 && line) { lines.push(line); line = wd; } else line = t;
    }
    lines.push(line);
    const y0 = h - 110 - (lines.length - 1) * 112 - (item.tech ? 48 : 0);
    lines.forEach((l, i) => ctx.fillText(l, 80, y0 + i * 112));
    if (item.tech) {
      ctx.font = '38px system-ui, Helvetica, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(item.tech, 82, h - 76);
    }
  };
  const poster = () => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, hex(0.75)); g.addColorStop(1, hex(0.22));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // a big soft ring and a few bars, in lighter tints of the colour
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 70;
    ctx.beginPath(); ctx.arc(w * 0.78, h * 0.32, 230, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 5; i++) ctx.fillRect(60 + i * 44, 60, 18, 120 - i * 18);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, h - 290, w, 290);
    title();
  };
  poster();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (item.image) {
    const img = new Image();
    img.onload = () => {
      // cover-fit the screenshot, then the title band
      const s = Math.max(w / img.width, h / img.height);
      const iw = img.width * s, ih = img.height * s;
      ctx.fillStyle = hex(0.25); ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih); // the screenshot alone; the nameplate under the frame does the naming
      tex.needsUpdate = true;
    };
    img.src = item.image;
  }
  return tex;
}
