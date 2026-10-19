/**
 * Keyboard + touch input. `state` is read every frame by the truck.
 * `enabled = false` releases all keys (used while the project overlay is open so
 * typing inside an embedded project doesn't drive the truck).
 */
export class Controls {
  constructor() {
    // keys are booleans; the touch joystick writes analog axes (-1..1) that the vehicles add on top
    this.state = { forward: false, backward: false, left: false, right: false, up: false, down: false, axisX: 0, axisY: 0 };
    this.enabled = true;
    this.onAction = null; // E / tap "OPEN"
    this.onReset = null;  // R
    this.onSecondary = null; // F / tap "EXIT" or "BOARD" (get out of / back into the helicopter)
    this.onMap = null;       // M
    this.onDoubleTap = null; // (dir: -1 | 1) — A/D or ◀/▶ tapped twice quickly (jet barrel roll)
    this._lastTap = { key: null, at: 0 };
    this.onEscape = null;

    const map = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'backward', ArrowDown: 'backward',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'up', KeyQ: 'up', PageUp: 'up',
      ShiftLeft: 'down', ShiftRight: 'down', KeyZ: 'down', PageDown: 'down',
    };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { this.onEscape?.(); return; }
      if (!this.enabled) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (map[e.code]) {
        const k = map[e.code];
        if ((k === 'left' || k === 'right') && !e.repeat) {
          const now = e.timeStamp; // when the key was actually pressed, not when a slow frame got round to it
          if (this._lastTap.key === k && now - this._lastTap.at < 320) { this.onDoubleTap?.(k === 'left' ? 1 : -1); this._lastTap.key = null; }
          else this._lastTap = { key: k, at: now };
        }
        this.state[k] = true; e.preventDefault();
      }
      if (e.code === 'KeyE' || e.code === 'Enter') this.onAction?.();
      if (e.code === 'KeyR') this.onReset?.();
      if (e.code === 'KeyF') this.onSecondary?.();
      if (e.code === 'KeyM') this.onMap?.();
    });
    window.addEventListener('keyup', (e) => {
      if (map[e.code]) this.state[map[e.code]] = false;
    });
    window.addEventListener('blur', () => this.releaseAll());

    // Touch buttons
    document.querySelectorAll('#touch button[data-k]').forEach((btn) => {
      const k = btn.dataset.k;
      const down = (e) => { e.preventDefault(); if (this.enabled) this.state[k] = true; };
      const up = (e) => { e.preventDefault(); this.state[k] = false; };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });
    this.#joystick();
    document.getElementById('touch-action')?.addEventListener('click', () => this.onAction?.());
    document.getElementById('touch-secondary')?.addEventListener('click', () => this.onSecondary?.());
    document.getElementById('reset-btn')?.addEventListener('click', () => this.onReset?.());
  }

  releaseAll() {
    for (const k of Object.keys(this.state)) this.state[k] = typeof this.state[k] === 'number' ? 0 : false;
    this.resetStick?.();
  }

  /** Circular thumb joystick (touch only): drag anywhere on the base; the knob follows, clamped to the ring. */
  #joystick() {
    const base = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    if (!base || !knob) return;
    const RADIUS = 46;      // px travel of the knob
    const DEAD = 0.14;      // dead zone (fraction of RADIUS)
    let pointerId = null, cx = 0, cy = 0;
    const set = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      const k = len > RADIUS ? RADIUS / len : 1;
      dx *= k; dy *= k;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const n = Math.min(1, len / RADIUS);
      const mag = n < DEAD ? 0 : (n - DEAD) / (1 - DEAD);   // dead zone, then linear to the rim
      const ang = Math.atan2(dy, dx);
      this.state.axisX = this.enabled ? Math.cos(ang) * mag : 0;
      this.state.axisY = this.enabled ? -Math.sin(ang) * mag : 0; // up on screen = forward
      base.classList.toggle('active', mag > 0);
    };
    this.resetStick = () => { pointerId = null; set(0, 0); base.classList.remove('active'); };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      base.setPointerCapture(pointerId);
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      set(e.clientX - cx, e.clientY - cy);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === pointerId) { e.preventDefault(); set(e.clientX - cx, e.clientY - cy); } });
    const end = (e) => { if (e.pointerId === pointerId) this.resetStick(); };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    base.addEventListener('lostpointercapture', end);
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.releaseAll();
  }
}
