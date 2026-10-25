import * as THREE from 'three';

/**
 * Procedural landmark builders. Each is called with (color, project) and returns
 * { group, colliders } where colliders is a list of { size:[w,h,d], offset:[x,y,z] } boxes
 * (local to the group) used for physics. A builder may also return `door: [x, y, z]`, a local
 * point just outside its entrance: standing there on foot lets you go inside (see Gallery.js).
 * Local +z faces the helipad. Replace any of these with a GLTF model later — just keep the
 * same return shape.
 */

/** A glowing text sign painted on a canvas (used for the office's rooftop lettering). */
function textSign(text, color, { w = 1024, h = 256, font = 'bold 150px system-ui, Helvetica, Arial, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#12151c';
  ctx.fillRect(0, 0, w, h);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text.toUpperCase(), w / 2, h / 2 + 6, w * 0.92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });

const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
};
const cyl = (rt, rb, h, seg, m, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y, z);
  return mesh;
};
const cone = (r, h, seg, m, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m);
  mesh.position.set(x, y, z);
  return mesh;
};

function finish(group) {
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

/**
 * Office-window texture: a grid of panes (sky reflections, a scattering of lit rooms) with
 * dark mullions between them. One canvas per face so the panes stay roughly square.
 */
function windowTexture(cols, rows, seed = 1) {
  const cw = 96, ch = 96;
  const c = document.createElement('canvas');
  c.width = cols * cw; c.height = rows * ch;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1d2330';
  ctx.fillRect(0, 0, c.width, c.height);
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
    const x = i * cw, y = r * ch;
    const lit = rnd() < 0.28;
    const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
    if (lit) { g.addColorStop(0, '#ffe3a3'); g.addColorStop(1, '#ffc96b'); }
    else { g.addColorStop(0, '#a9ddf4'); g.addColorStop(1, '#4f98c9'); }
    ctx.fillStyle = g;
    ctx.fillRect(x + 7, y + 7, cw - 14, ch - 14);
    if (lit) { // a hint of furniture: a dark desk line and a lamp dot
      ctx.fillStyle = 'rgba(40,30,20,0.35)';
      ctx.fillRect(x + 14, y + ch * 0.62, cw - 28, 6);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; // glint
    ctx.fillRect(x + 7, y + 7, (cw - 14) * 0.35, ch - 14);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export const landmarkShapes = {
  /**
   * Mid-rise office block: a glass tower on concrete slabs over a recessed, warmly lit lobby,
   * with the project title in lights on the roof. The front doors (local +z, toward the pad)
   * are the way into the gallery inside — `door` is the spot on the plaza just outside them.
   */
  office(color, project = {}) {
    const g = new THREE.Group();
    const W = 16, D = 12;                // footprint
    const LOBBY = 4.2, FLOORS = 4, FH = 3.2; // ground floor height, then four office floors
    const TOP = LOBBY + FLOORS * FH;     // 17 m to the roof slab
    const concrete = mat('#e1e4e9', { flatShading: false });
    const concreteDark = mat('#9aa1ad', { flatShading: false });
    const dark = mat('#242933', { flatShading: false, roughness: 0.6 });
    const pavers = mat('#c9c3b8', { flatShading: false });
    const lobbyGlass = new THREE.MeshStandardMaterial({ color: '#bfe6ff', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45, emissive: '#ffd9a0', emissiveIntensity: 0.12 });
    const warmFloor = mat('#b98a5d', { flatShading: false });
    const accent = mat(color, { flatShading: false, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 });
    const accentDeep = mat(new THREE.Color(color).multiplyScalar(0.55), { flatShading: false });
    const leaf = mat('#4f9a3c');

    // ---------- plaza + planters (thin so the pilot can walk straight over it)
    g.add(box(W + 4, 0.15, 5, pavers, 0, 0.075, D / 2 + 1.0));
    for (const x of [-5, 5]) {
      g.add(box(1.6, 0.9, 1.6, concreteDark, x, 0.45, D / 2 + 1.4));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.85, 9, 7), leaf).translateX(x).translateY(1.5).translateZ(D / 2 + 1.4));
    }

    // ---------- lobby: recessed by a metre, glass all round, warm floor, a reception desk you can see through the glass
    const LW = W - 2, LD = D - 2;
    g.add(box(LW, 0.25, LD, warmFloor, 0, 0.125, 0));
    g.add(box(LW, LOBBY, LD, lobbyGlass, 0, LOBBY / 2, 0));
    g.add(box(LW + 0.4, 0.3, LD + 0.4, dark, 0, LOBBY - 0.15, 0)); // ceiling band
    for (const x of [-LW / 2 + 0.4, LW / 2 - 0.4]) for (const z of [-LD / 2 + 0.4, LD / 2 - 0.4]) g.add(cyl(0.28, 0.28, LOBBY, 10, concreteDark, x, LOBBY / 2, z));
    g.add(box(4.2, 1.1, 1.2, accentDeep, 0, 0.8, -1.5));     // reception desk
    g.add(box(4.4, 0.08, 1.4, concrete, 0, 1.38, -1.5));
    // front doors in the project colour under a canopy
    g.add(box(4.6, 3.6, 0.3, dark, 0, 1.8 + 0.25, LD / 2));
    for (const x of [-1.05, 1.05]) g.add(box(1.9, 3.2, 0.14, accent, x, 1.6 + 0.25, LD / 2 + 0.12));
    g.add(box(0.1, 3.2, 0.2, dark, 0, 1.6 + 0.25, LD / 2 + 0.15));
    g.add(box(7.5, 0.3, 3.2, concreteDark, 0, LOBBY - 0.4, LD / 2 + 1.2));
    for (const x of [-3.2, 3.2]) g.add(cyl(0.08, 0.08, 1.3, 6, dark, x, LOBBY - 0.4 + 0.6, LD / 2 + 2.2).rotateX(-0.6));

    // ---------- the tower: floor slabs with glass between, corner piers
    const winX = windowTexture(6, FLOORS, 3), winZ = windowTexture(8, FLOORS, 7);
    const winMat = (t) => new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.22, roughness: 0.25, metalness: 0.15 });
    const roofMat = mat('#8c929c', { flatShading: false });
    const glassTower = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, FLOORS * FH, D - 0.5), [winMat(winX), winMat(winX), roofMat, roofMat, winMat(winZ), winMat(winZ)]);
    glassTower.position.set(0, LOBBY + (FLOORS * FH) / 2, 0);
    g.add(glassTower);
    for (let i = 0; i <= FLOORS; i++) g.add(box(W, 0.4, D, concrete, 0, LOBBY + i * FH, 0));
    for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) for (const z of [-D / 2 + 0.3, D / 2 - 0.3]) g.add(box(0.6, TOP - LOBBY, 0.6, concreteDark, x, LOBBY + (TOP - LOBBY) / 2, z));

    // ---------- roof: parapet, plant room, and the sign
    g.add(box(W, 0.6, 0.3, concreteDark, 0, TOP + 0.3, D / 2 - 0.15));
    g.add(box(W, 0.6, 0.3, concreteDark, 0, TOP + 0.3, -D / 2 + 0.15));
    g.add(box(0.3, 0.6, D, concreteDark, W / 2 - 0.15, TOP + 0.3, 0));
    g.add(box(0.3, 0.6, D, concreteDark, -W / 2 + 0.15, TOP + 0.3, 0));
    g.add(box(3.2, 1.6, 2.4, concreteDark, -4.5, TOP + 1.0, -2.5));
    g.add(cyl(0.9, 0.9, 0.3, 12, dark, -4.5, TOP + 1.95, -2.5));
    const signTex = textSign(project.title || 'Projects', color);
    const signW = 12, signH = 3;
    g.add(box(signW + 0.3, signH + 0.3, 0.3, dark, 0, TOP + 2.3, 0));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: '#ffffff', emissiveIntensity: 1.1, roughness: 0.6 }));
    sign.position.set(0, TOP + 2.3, 0.17);
    g.add(sign);
    for (const x of [-signW / 2 + 0.3, signW / 2 - 0.3]) g.add(cyl(0.1, 0.1, 1.1, 6, dark, x, TOP + 0.55, 0));
    g.add(cyl(0.06, 0.06, 4, 6, dark, 6, TOP + 2.2, 3));    // aerial
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat('#ff4d4d', { emissive: '#ff2222', emissiveIntensity: 1.5 })).translateX(6).translateY(TOP + 4.3).translateZ(3));

    return {
      group: finish(g),
      colliders: [
        { size: [LW + 0.4, LOBBY, LD + 0.4], offset: [0, LOBBY / 2, 0] },                         // the lobby (recessed: you can walk under the overhang)
        { size: [W, TOP - LOBBY + 1.2, D], offset: [0, LOBBY + (TOP - LOBBY + 1.2) / 2, 0] },   // the tower above it
      ],
      door: [0, 0.15, LD / 2 + 1.0],
    };
  },

  /** Dark-wood restaurant with a glowing sign and a chimney. */
  restaurant(color) {
    const g = new THREE.Group();
    const wood = mat('#5a3f35');
    const roof = mat('#3a2822');
    const accent = mat(color, { emissive: color, emissiveIntensity: 0.6 });
    const warm = mat('#ffd38a', { emissive: '#ffb547', emissiveIntensity: 1.1 });

    g.add(box(10, 5, 8, wood, 0, 2.5, 0));
    g.add(box(11, 0.6, 9, roof, 0, 5.3, 0));
    const roofTop = cone(7.5, 3.5, 4, roof, 0, 7.3, 0); roofTop.rotation.y = Math.PI / 4; g.add(roofTop);
    g.add(box(1.2, 3, 1.2, wood, 3, 8, -2));                    // chimney
    g.add(box(9, 1.3, 0.3, accent, 0, 4.2, 4.1));               // sign
    for (const x of [-3, 0, 3]) g.add(box(1.6, 1.6, 0.2, warm, x, 2.4, 4.05)); // lit windows
    g.add(box(2.2, 2.8, 0.2, mat('#5a3d33'), 0, 1.4, 4.05));    // door (under sign, centered)
    g.add(box(12, 0.4, 3, mat('#4b3730'), 0, 0.2, 5.5));        // porch
    for (const x of [-5, 5]) g.add(cyl(0.2, 0.2, 3.5, 6, wood, x, 2, 6.5)); // porch posts
    g.add(box(12, 0.3, 3, roof, 0, 3.9, 6.5));                  // porch roof
    return { group: finish(g), colliders: [{ size: [10, 7, 8], offset: [0, 3.5, 0] }] };
  },

  /** Outdoor professional kitchen under a pergola + a long banquet table set for dinner. */
  kitchen(color) {
    const g = new THREE.Group();
    const steel = mat('#c9ced6', { roughness: 0.35, metalness: 0.7 });
    const steelDark = mat('#8a919c', { roughness: 0.4, metalness: 0.6 });
    const black = mat('#1f2128', { roughness: 0.8 });
    const wood = mat('#6b4a36');
    const darkWood = mat('#4a3328');
    const stone = mat('#9a948c');
    const brick = mat('#b5573a');
    const white = mat('#f4f2ec', { roughness: 0.5 });
    const glass = mat('#dff3ff', { roughness: 0.1, transparent: true, opacity: 0.7 });
    const linen = mat('#efe9dc', { roughness: 0.9 });
    const accent = mat(color, { emissive: color, emissiveIntensity: 0.25 });
    const flame = mat('#ffb547', { emissive: '#ff8a1f', emissiveIntensity: 1.4 });
    const colliders = [];

    // ---------- stone patio
    g.add(box(26, 0.3, 20, mat('#b9b2a6'), 0, 0.15, -2));

    // ---------- pergola over the kitchen line
    const PZ = -8; // kitchen line z
    for (const x of [-11, 11]) for (const z of [PZ - 3.5, PZ + 3.5]) {
      g.add(box(0.5, 7, 0.5, darkWood, x, 3.5, z));
    }
    g.add(box(23, 0.4, 0.5, darkWood, 0, 7.0, PZ - 3.5));
    g.add(box(23, 0.4, 0.5, darkWood, 0, 7.0, PZ + 3.5));
    for (let i = 0; i <= 14; i++) {
      g.add(box(0.25, 0.3, 8.4, darkWood, -11 + i * (22 / 14), 7.35, PZ));
    }
    colliders.push({ size: [23.5, 1, 9], offset: [0, 7.2, PZ] });

    // ---------- back splash wall + shelf with pots
    g.add(box(22, 3.2, 0.4, stone, 0, 1.6 + 0.3, PZ - 2.9));
    g.add(box(18, 0.12, 0.9, steelDark, 0, 3.2, PZ - 2.4));
    const potCols = ['#d8dde4', '#c0442e', '#2e3a4a', '#d8dde4', '#7b8794'];
    for (let i = 0; i < 9; i++) {
      const pot = cyl(0.35, 0.3, 0.45, 10, mat(potCols[i % potCols.length], { roughness: 0.4, metalness: 0.4 }), -8 + i * 2, 3.5, PZ - 2.4);
      g.add(pot);
    }

    // ---------- counter run (stainless), with a range, grill, sink and pizza oven
    const CH = 1.3; // counter height
    g.add(box(22, CH, 2.6, steel, 0, 0.3 + CH / 2, PZ));
    g.add(box(22.2, 0.08, 2.8, steelDark, 0, 0.3 + CH + 0.04, PZ)); // worktop lip
    colliders.push({ size: [22.2, CH + 0.4, 3], offset: [0, 0.3 + (CH + 0.4) / 2, PZ] });
    // door seams
    for (let i = -4; i <= 4; i++) g.add(box(0.04, CH - 0.3, 0.05, black, i * 2.4, 0.3 + CH / 2, PZ + 1.33));

    // range: 6 burners + two oven doors + hood
    const RX = -5.5;
    g.add(box(5, 0.1, 2.4, black, RX, 0.3 + CH + 0.1, PZ));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      g.add(cyl(0.38, 0.38, 0.08, 10, steelDark, RX - 1.5 + i * 1.5, 0.3 + CH + 0.19, PZ - 0.5 + j * 1.0));
      g.add(cyl(0.16, 0.16, 0.06, 8, i === 1 && j === 0 ? flame : black, RX - 1.5 + i * 1.5, 0.3 + CH + 0.25, PZ - 0.5 + j * 1.0));
    }
    g.add(box(2.3, 0.8, 0.06, glass, RX - 1.25, 0.3 + CH * 0.55, PZ + 1.34));
    g.add(box(2.3, 0.8, 0.06, glass, RX + 1.25, 0.3 + CH * 0.55, PZ + 1.34));
    g.add(box(5.4, 0.5, 2.6, steel, RX, 4.0, PZ));      // hood canopy
    g.add(box(4.2, 0.6, 2.0, steel, RX, 4.55, PZ));     // stepped upper
    g.add(box(1.0, 2.2, 1.0, steelDark, RX, 6.0, PZ));  // duct up to the pergola

    // grill with hinged lid
    const GX = 1.5;
    g.add(box(3.6, 0.5, 2.2, black, GX, 0.3 + CH + 0.3, PZ));
    for (let i = 0; i < 7; i++) g.add(box(0.06, 0.06, 2.0, steelDark, GX - 1.5 + i * 0.5, 0.3 + CH + 0.58, PZ));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.6, 12, 1, false, 0, Math.PI), black);
    lid.rotation.z = Math.PI / 2; lid.rotation.y = Math.PI / 2; lid.position.set(GX, 0.3 + CH + 0.6, PZ - 1.1); g.add(lid);

    // sink + faucet
    const SX = 6;
    g.add(box(2.4, 0.3, 1.6, steelDark, SX, 0.3 + CH - 0.05, PZ));
    g.add(box(2.1, 0.25, 1.3, mat('#5d6773', { metalness: 0.5, roughness: 0.3 }), SX, 0.3 + CH - 0.03, PZ));
    g.add(cyl(0.07, 0.07, 1.1, 6, steel, SX, 0.3 + CH + 0.6, PZ - 0.7));
    const spout = cyl(0.06, 0.06, 0.8, 6, steel, SX, 0.3 + CH + 1.15, PZ - 0.35); spout.rotation.x = Math.PI / 2; g.add(spout);

    // pizza oven at the end of the run
    const OX = 10.2;
    g.add(box(2.8, CH + 0.4, 2.8, stone, OX, 0.3 + (CH + 0.4) / 2, PZ));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), brick);
    dome.position.set(OX, 0.3 + CH + 0.4, PZ); g.add(dome);
    g.add(box(0.9, 0.6, 0.2, flame, OX, 0.3 + CH + 0.7, PZ + 1.25));
    g.add(cyl(0.25, 0.25, 1.6, 8, black, OX, 0.3 + CH + 2.2, PZ - 0.3));
    colliders.push({ size: [3, 3.6, 3], offset: [OX, 2.1, PZ] });

    // ---------- banquet table (runs along x, in front of the kitchen)
    const TZ = 3, TL = 20, TW = 2.6, TH = 1.3;
    g.add(box(TL, 0.16, TW, wood, 0, TH, TZ));
    g.add(box(TL - 1, 0.03, 0.9, accent, 0, TH + 0.1, TZ)); // runner in the project colour
    for (const x of [-8.5, -3, 3, 8.5]) { // trestle legs
      g.add(box(0.25, TH - 0.1, 2.0, darkWood, x, (TH - 0.1) / 2 + 0.3, TZ));
    }
    g.add(box(TL - 2, 0.12, 0.25, darkWood, 0, 0.6, TZ));
    colliders.push({ size: [TL, TH + 0.6, TW + 2.4], offset: [0, (TH + 0.6) / 2, TZ] });

    // chairs + place settings on both sides
    const seats = 8, spacing = (TL - 2.5) / (seats - 1);
    for (let i = 0; i < seats; i++) {
      const x = -(TL - 2.5) / 2 + i * spacing;
      for (const side of [-1, 1]) {
        const cz = TZ + side * (TW / 2 + 0.9);
        // chair
        g.add(box(0.9, 0.08, 0.9, darkWood, x, 0.3 + 0.7, cz));
        for (const lx of [-0.38, 0.38]) for (const lz of [-0.38, 0.38]) g.add(box(0.08, 0.7, 0.08, darkWood, x + lx, 0.3 + 0.35, cz + lz));
        g.add(box(0.9, 0.95, 0.08, darkWood, x, 0.3 + 1.25, cz + side * 0.42));
        // setting: plate, glass, napkin, cutlery
        const pz = TZ + side * (TW / 2 - 0.55);
        g.add(cyl(0.42, 0.42, 0.04, 14, white, x, TH + 0.1, pz));
        g.add(cyl(0.34, 0.34, 0.01, 14, mat('#dcd6cc'), x, TH + 0.13, pz));
        g.add(box(0.3, 0.02, 0.5, accent, x, TH + 0.15, pz));
        g.add(cyl(0.1, 0.07, 0.3, 8, glass, x + side * 0.6, TH + 0.25, pz - side * 0.3));
        g.add(box(0.05, 0.02, 0.5, steel, x - 0.55, TH + 0.1, pz));
        g.add(box(0.05, 0.02, 0.5, steel, x + 0.55, TH + 0.1, pz));
      }
    }

    // platters of food down the middle
    const dishes = [
      () => { // roast on a board
        const d = new THREE.Group();
        d.add(box(1.8, 0.06, 0.9, wood));
        const roast = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mat('#8a4a2a', { roughness: 0.7 }));
        roast.scale.set(1.6, 0.8, 1); roast.position.y = 0.36; d.add(roast);
        for (let k = 0; k < 4; k++) d.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), mat('#6fbf4a')).translateX(-0.7 + k * 0.45).translateZ(0.35).translateY(0.12));
        return d;
      },
      () => { // bowl of salad
        const d = new THREE.Group();
        d.add(cyl(0.6, 0.4, 0.3, 12, white, 0, 0.15, 0));
        for (let k = 0; k < 9; k++) d.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), mat(['#4caf50', '#8bc34a', '#e53935', '#ffeb3b'][k % 4])).translateX(Math.cos(k * 2.1) * 0.3).translateZ(Math.sin(k * 2.1) * 0.3).translateY(0.35));
        return d;
      },
      () => { // bread basket
        const d = new THREE.Group();
        d.add(box(1.2, 0.25, 0.7, mat('#a8794b'), 0, 0.12, 0));
        for (let k = 0; k < 3; k++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat('#d9a35e')); l.scale.set(1.8, 0.8, 1); l.position.set(-0.35 + k * 0.35, 0.33, 0); d.add(l); }
        return d;
      },
      () => { // platter of vegetables
        const d = new THREE.Group();
        const plate = cyl(0.75, 0.75, 0.05, 16, white, 0, 0.03, 0); plate.scale.z = 0.7; d.add(plate);
        for (let k = 0; k < 10; k++) d.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), mat(['#ff7043', '#ffa726', '#66bb6a', '#ab47bc'][k % 4])).translateX(-0.5 + (k % 5) * 0.25).translateZ(k < 5 ? -0.15 : 0.15).translateY(0.15));
        return d;
      },
      () => { // whole fish
        const d = new THREE.Group();
        const plate = cyl(0.9, 0.9, 0.05, 16, white, 0, 0.03, 0); plate.scale.z = 0.5; d.add(plate);
        const fish = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat('#c9a98a')); fish.scale.set(2.4, 0.6, 1); fish.position.y = 0.2; d.add(fish);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3), mat('#c9a98a')); tail.rotation.z = Math.PI / 2; tail.position.set(0.85, 0.2, 0); d.add(tail);
        for (let k = 0; k < 3; k++) d.add(cyl(0.12, 0.12, 0.03, 8, mat('#ffe066'), -0.4 + k * 0.4, 0.4, 0.25));
        return d;
      },
    ];
    const nDishes = 7;
    for (let i = 0; i < nDishes; i++) {
      const d = dishes[i % dishes.length]();
      d.position.set(-(TL - 4) / 2 + i * ((TL - 4) / (nDishes - 1)), TH + 0.1, TZ);
      g.add(d);
    }
    // candles between dishes
    for (let i = 0; i < nDishes - 1; i++) {
      const x = -(TL - 4) / 2 + (i + 0.5) * ((TL - 4) / (nDishes - 1));
      g.add(cyl(0.08, 0.1, 0.5, 6, white, x, TH + 0.35, TZ + 0.6));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), flame).translateX(x).translateY(TH + 0.66).translateZ(TZ + 0.6));
    }

    // string lights from the pergola to two posts past the table
    for (const x of [-10, 10]) g.add(box(0.3, 4.5, 0.3, darkWood, x, 2.55, TZ + 3.5));
    for (let k = 0; k < 2; k++) {
      const z0 = PZ + 3.5, z1 = TZ + 3.5, y0 = 7, y1 = 4.8;
      const xStart = -10 + k * 20;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), flame);
        bulb.position.set(xStart, THREE.MathUtils.lerp(y0, y1, t) - Math.sin(t * Math.PI) * 0.4, THREE.MathUtils.lerp(z0, z1, t));
        g.add(bulb);
      }
    }
    for (let i = 0; i <= 16; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), flame);
      bulb.position.set(-10 + i * 1.25, 4.8 - Math.sin((i / 16) * Math.PI) * 0.5, TZ + 3.5);
      g.add(bulb);
    }

    return { group: finish(g), colliders };
  },

  /** Server-rack style tower with blinking lights and a dish. */
  tower(color) {
    const g = new THREE.Group();
    const steel = mat('#2c3140');
    const light = mat(color, { emissive: color, emissiveIntensity: 1.0 });
    g.add(box(6, 1, 6, mat('#3a4050'), 0, 0.5, 0));
    g.add(box(4.2, 16, 4.2, steel, 0, 9, 0));
    for (let i = 0; i < 6; i++) {
      g.add(box(4.4, 0.25, 4.4, mat('#4a5060'), 0, 2.5 + i * 2.5, 0));
      g.add(box(0.5, 0.5, 0.2, light, -1.4 + (i % 3) * 1.4, 3.6 + i * 2.5, 2.2));
    }
    g.add(cyl(0.15, 0.15, 6, 6, steel, 0, 20, 0));              // mast
    const dish = cyl(1.6, 0.4, 0.8, 10, mat('#dfe3ea'), 1.8, 17.5, 1.8);
    dish.rotation.set(-0.6, 0.6, 0); g.add(dish);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), light).translateY(23));
    return { group: finish(g), colliders: [{ size: [4.4, 17, 4.4], offset: [0, 8.5, 0] }, { size: [6, 1, 6], offset: [0, 0.5, 0] }] };
  },

  /** Striped lighthouse with a lamp room. */
  lighthouse(color) {
    const g = new THREE.Group();
    const white = mat('#f6f3ee');
    const stripe = mat(color);
    const dark = mat('#2b2f3a');
    const lamp = mat('#fff4c2', { emissive: '#fff0a8', emissiveIntensity: 1.6 });
    g.add(cyl(3.6, 3.6, 1.2, 12, dark, 0, 0.6, 0));
    for (let i = 0; i < 6; i++) {
      const r = 2.6 - i * 0.22;
      g.add(cyl(r - 0.22, r, 2.4, 12, i % 2 ? stripe : white, 0, 1.2 + 1.2 + i * 2.4, 0));
    }
    g.add(cyl(2.2, 1.6, 0.6, 12, dark, 0, 16.9, 0));            // gallery
    g.add(cyl(1.3, 1.3, 2, 8, lamp, 0, 18.2, 0));               // lamp room
    g.add(cone(1.7, 1.6, 8, dark, 0, 20, 0));
    const house = box(5, 3, 4, white, 4.5, 1.5 + 1.2, -1); g.add(house);
    const hroof = cone(3.9, 2, 4, stripe, 4.5, 5.7, -1); hroof.rotation.y = Math.PI / 4; g.add(hroof);
    return { group: finish(g), colliders: [{ size: [5.2, 21, 5.2], offset: [0, 10.5, 0] }, { size: [5, 4.5, 4], offset: [4.5, 2.5, -1] }] };
  },

  /** A big arch / gateway (used for the playground). */
  arch(color) {
    const g = new THREE.Group();
    const stone = mat('#cfd3dc');
    const accent = mat(color, { emissive: color, emissiveIntensity: 0.5 });
    g.add(box(2.4, 10, 2.4, stone, -6, 5, 0));
    g.add(box(2.4, 10, 2.4, stone, 6, 5, 0));
    g.add(box(15, 2.2, 2.6, stone, 0, 11.1, 0));
    g.add(box(13, 0.6, 2.8, accent, 0, 12.5, 0));
    for (const x of [-6, 6]) g.add(box(3.2, 0.8, 3.2, stone, x, 0.4, 0));
    return { group: finish(g), colliders: [
      { size: [2.4, 10, 2.4], offset: [-6, 5, 0] },
      { size: [2.4, 10, 2.4], offset: [6, 5, 0] },
      { size: [15, 2.4, 2.6], offset: [0, 11.2, 0] },
    ] };
  },

  /** Stepped pyramid with a glowing cap. */
  pyramid(color) {
    const g = new THREE.Group();
    const sand = mat('#e2c58a');
    const cap = mat(color, { emissive: color, emissiveIntensity: 0.8 });
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const s = 14 - i * 2.6;
      g.add(box(s, 2, s, sand, 0, 1 + i * 2, 0));
    }
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(1.4), cap).translateY(steps * 2 + 1.2));
    return { group: finish(g), colliders: [{ size: [14, 2, 14], offset: [0, 1, 0] }, { size: [9, 6, 9], offset: [0, 5, 0] }, { size: [4, 4, 4], offset: [0, 10, 0] }] };
  },

  /** Windmill with rotating blades (group.userData.spin gets animated). */
  windmill(color) {
    const g = new THREE.Group();
    const body = mat('#f1e8d8');
    const wood = mat('#6b4a36');
    g.add(cyl(2.4, 3.2, 10, 8, body, 0, 5, 0));
    g.add(cone(3, 2.4, 8, mat(color), 0, 11.2, 0));
    const hub = new THREE.Group();
    hub.position.set(0, 9.5, 3.1);
    for (let i = 0; i < 4; i++) {
      const blade = box(0.5, 7, 0.15, wood, 0, 3.5, 0);
      const arm = new THREE.Group(); arm.add(blade); arm.rotation.z = (i * Math.PI) / 2; hub.add(arm);
    }
    g.add(hub);
    g.userData.spin = hub;
    return { group: finish(g), colliders: [{ size: [5, 12, 5], offset: [0, 6, 0] }] };
  },

  /** Observatory dome with a telescope slit. */
  observatory(color) {
    const g = new THREE.Group();
    const wall = mat('#e9edf5');
    const dome = mat(color, { roughness: 0.5 });
    g.add(cyl(5, 5.4, 6, 14, wall, 0, 3, 0));
    const d = new THREE.Mesh(new THREE.SphereGeometry(5.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), dome);
    d.position.y = 6; g.add(d);
    g.add(box(1.6, 5, 0.6, mat('#1a1d28'), 0, 8.5, 4.5));      // slit
    const scope = cyl(0.5, 0.7, 7, 8, mat('#2c3140'), 0, 9, 1.5); scope.rotation.x = -0.9; g.add(scope);
    g.add(box(4, 2.5, 3, wall, 6, 1.25, 0));
    return { group: finish(g), colliders: [{ size: [10.4, 11, 10.4], offset: [0, 5.5, 0] }, { size: [4, 2.5, 3], offset: [6, 1.25, 0] }] };
  },
};
