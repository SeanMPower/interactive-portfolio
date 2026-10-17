/**
 * Keyboard + touch input. `state` is read every frame by the truck.
 * `enabled = false` releases all keys (used while the project overlay is open so
 * typing inside an embedded project doesn't drive the truck).
 */
export class Controls {
  constructor() {
    this.state = { forward: false, backward: false, left: false, right: false, up: false, down: false };
    this.enabled = true;
    this.onAction = null; // E / tap "OPEN"
    this.onReset = null;  // R
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
      if (map[e.code]) { this.state[map[e.code]] = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'Enter') this.onAction?.();
      if (e.code === 'KeyR') this.onReset?.();
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
    document.getElementById('touch-action')?.addEventListener('click', () => this.onAction?.());
    document.getElementById('reset-btn')?.addEventListener('click', () => this.onReset?.());
  }

  releaseAll() {
    for (const k of Object.keys(this.state)) this.state[k] = false;
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.releaseAll();
  }
}
