/**
 * Full-screen map modal. Draws a shaded top-down map of the current zone (overworld or reef),
 * rotated 45° so "up" on the map is "up" on screen (the camera looks from +x,+z), overlays
 * clickable landmark markers, and reports where the player wants to go.
 *
 * Zone descriptor: {
 *   id, title, subtitle, half,                     // square world half-size shown
 *   heightAt(x, z), colorFor(h, slope, x, z) -> [r, g, b] 0..255,   // ground height and colour
 *   paths?: [[{x, z}...]],                         // roads, drawn as sandy lines
 *   markers: [{ x, z, kind, label?, color?, dim?, travel? }],   // travel: { x, z } overrides the marker's own spot
 *   player: { x, z, yaw, kind: 'heli' | 'foot' | 'sub' },
 *   allowFreeTravel: boolean,                      // clicking open ground travels there
 * }
 */
const SQ = Math.SQRT1_2;
const ICONS = { project: '', pad: 'H', dock: '⚓', spawn: '⌂', peak: '▲', ring: '◎', pearl: '●', arch: '∩', wreck: '⛵', kelp: '🌿', coral: '🪸' };

export class MapView {
  constructor({ onOpen, onClose, onTravel }) {
    this.el = document.getElementById('map');
    this.card = document.getElementById('map-card');
    this.canvas = document.getElementById('map-canvas');
    this.layer = document.getElementById('map-markers');
    this.titleEl = document.getElementById('map-title');
    this.subEl = document.getElementById('map-sub');
    this.hintEl = document.getElementById('map-hint');
    this.onOpen = onOpen; this.onClose = onClose; this.onTravel = onTravel;
    this.isOpen = false;
    this.zone = null;
    this.cache = new Map();   // zone id → rendered base image
    this._zone = null;        // zone being rendered (prerender may run while another is open)
    document.getElementById('map-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.canvas.addEventListener('click', (e) => {
      if (!this.zone?.allowFreeTravel) return;
      const w = this.#toWorld(e.clientX, e.clientY);
      if (w) this.#travel(w.x, w.z);
    });
    window.addEventListener('resize', () => { if (this.isOpen) this.#layout(); });
  }

  open(zone) {
    this.zone = zone;
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.titleEl.textContent = zone.title;
    this.subEl.textContent = zone.subtitle || '';
    this.hintEl.textContent = zone.allowFreeTravel ? 'Tap a landmark — or anywhere on the map — to travel there' : 'Tap a landmark to travel there';
    this.onOpen?.();
    this.#layout();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.onClose?.();
  }
  toggle(zoneFactory) { if (this.isOpen) this.close(); else this.open(zoneFactory()); }
  /** Render a zone's base image ahead of time (call during idle time so the first open is instant). */
  prerender(zone) { if (!this.cache.has(zone.id)) this.cache.set(zone.id, this.#renderZone(zone)); }

  // ---------------------------------------------------------------- geometry
  /** world (x, z) → canvas px (rotated 45° so screen-up is world (-1,-1)) */
  #toPx(x, z) {
    const u = (x - z) * SQ, v = (x + z) * SQ;
    return { px: this.cx + u * this.scale, py: this.cy + v * this.scale };
  }
  #toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const u = (clientX - r.left - this.cx) / this.scale, v = (clientY - r.top - this.cy) / this.scale;
    const x = (u + v) * SQ, z = (v - u) * SQ;
    const h = this.zone.half;
    if (Math.abs(x) > h || Math.abs(z) > h) return null;
    return { x, z };
  }
  #layout() {
    const size = Math.min(this.card.clientWidth - 24, this.card.clientHeight - 110);
    this.size = size;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.layer.style.width = this.layer.style.height = `${size}px`;
    this.cx = this.cy = size / 2;
    this.scale = (size / 2 - 8) / (this.zone.half * Math.SQRT2);
    this.#drawBase();
    this.#drawMarkers();
  }

  // ---------------------------------------------------------------- base map
  #drawBase() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = Math.round(this.size * dpr);
    this.canvas.width = this.canvas.height = S;
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    let img = this.cache.get(this.zone.id);
    if (!img) { img = this.#renderZone(this.zone); this.cache.set(this.zone.id, img); }
    // clip to the diamond and draw the cached square, rotated 45°
    const h = this.zone.half;
    ctx.save();
    ctx.translate(this.cx * dpr, this.cy * dpr);
    ctx.rotate(Math.PI / 4);
    const side = 2 * h * this.scale * dpr;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, -side / 2, -side / 2, side, side);
    ctx.restore();
  }
  /** Shaded colour map of the square zone, sampled on a grid (cached per zone). x → right, z → down. */
  #renderZone(zone) {
    const N = 256, h = zone.half;
    const off = document.createElement('canvas');
    off.width = off.height = N;
    const ctx = off.getContext('2d');
    const data = ctx.createImageData(N, N);
    const hts = new Float32Array((N + 1) * (N + 1));
    const step = (2 * h) / N;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) hts[j * (N + 1) + i] = zone.heightAt(-h + i * step, -h + j * step);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -h + (i + 0.5) * step, z = -h + (j + 0.5) * step;
      const hl = hts[j * (N + 1) + i], hr = hts[j * (N + 1) + i + 1];
      const hu = hts[j * (N + 1) + i], hd = hts[(j + 1) * (N + 1) + i];
      const hc = (hl + hr + hu + hd) / 4;
      const slope = Math.hypot(hr - hl, hd - hu) / step;
      const [r, g, b] = zone.colorFor(hc, slope, x, z);
      // hillshade: light from the upper-left of the (unrotated) square
      const shade = 1 + Math.max(-0.45, Math.min(0.45, ((hl - hr) + (hu - hd)) / (step * 2) * 0.35));
      const k = (j * N + i) * 4;
      data.data[k] = Math.min(255, r * shade); data.data[k + 1] = Math.min(255, g * shade); data.data[k + 2] = Math.min(255, b * shade); data.data[k + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    // roads
    if (zone.paths) {
      const k = N / (2 * h);
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const [w, col] of [[3.2, 'rgba(90,70,45,0.55)'], [2, '#c9ad84']]) {
        ctx.lineWidth = w; ctx.strokeStyle = col;
        for (const path of zone.paths) {
          ctx.beginPath();
          path.forEach((p, i) => { const px = (p.x + h) * k, py = (p.z + h) * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
          ctx.stroke();
        }
      }
    }
    return off;
  }

  // ---------------------------------------------------------------- markers
  #drawMarkers() {
    this.layer.innerHTML = '';
    for (const m of this.zone.markers) {
      const { px, py } = this.#toPx(m.x, m.z);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `mk mk-${m.kind}${m.dim ? ' dim' : ''}`;
      el.style.left = `${px}px`; el.style.top = `${py}px`;
      if (m.color) el.style.setProperty('--mk', m.color);
      const icon = m.icon ?? ICONS[m.kind] ?? '';
      el.innerHTML = `<span class="mk-dot">${icon}</span>${m.label ? `<span class="mk-label">${m.label}</span>` : ''}`;
      if (m.title) el.title = m.title;
      const t = m.travel || m;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.#travel(t.x, t.z, m); });
      this.layer.appendChild(el);
    }
    const p = this.zone.player;
    if (p) {
      const { px, py } = this.#toPx(p.x, p.z);
      const el = document.createElement('div');
      el.className = `mk mk-player mk-player-${p.kind}`;
      const sx = Math.sin(p.yaw), sz = Math.cos(p.yaw);
      const ang = Math.atan2((sx + sz) * SQ, (sx - sz) * SQ); // heading in map px space
      el.style.left = `${px}px`; el.style.top = `${py}px`;
      el.innerHTML = `<span class="mk-you" style="transform: rotate(${(ang * 180) / Math.PI}deg)">➤</span><span class="mk-label">You</span>`;
      this.layer.appendChild(el);
    }
  }
  #travel(x, z, marker = null) {
    this.close();
    this.onTravel?.(x, z, marker);
  }
}
