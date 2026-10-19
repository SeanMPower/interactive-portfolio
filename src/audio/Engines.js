/**
 * Procedural engine sounds (Web Audio, no sample files):
 *   helicopter — a rotor "whop" (low-passed noise chopped at the blade-pass rate) plus a faint turbine hiss,
 *                both scaled by how fast the rotors are spinning; the whop slows as the rotors wind down
 *   jet        — turbine whine + broadband rush that rise with speed, and a low afterburner rumble under throttle
 * Everything is attenuated by distance from the player and muted underwater. The context is created on
 * the first user gesture (browsers require it), and the mute state is remembered in localStorage.
 */
export class Engines {
  constructor({ volume = 0.35 } = {}) {
    this.ctx = null;
    this.volume = volume;
    this.enabled = localStorage.getItem('sound') !== 'off';
    this._state = { heli: 0, jet: 0 };
  }

  /** Call from a user gesture (start button / first key). Safe to call repeatedly. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);
    const noise = this.#noiseBuffer(2);

    // ---------------- helicopter
    const h = (this.heli = {});
    h.out = ctx.createGain(); h.out.gain.value = 0; h.out.connect(this.master);
    // whop: noise → lowpass → chop gain (driven by an LFO) → out
    h.src = ctx.createBufferSource(); h.src.buffer = noise; h.src.loop = true;
    h.lp = ctx.createBiquadFilter(); h.lp.type = 'lowpass'; h.lp.frequency.value = 260; h.lp.Q.value = 0.8;
    h.chop = ctx.createGain(); h.chop.gain.value = 0;
    h.lfo = ctx.createOscillator(); h.lfo.type = 'sine'; h.lfo.frequency.value = 1;
    h.lfoShape = ctx.createWaveShaper(); h.lfoShape.curve = this.#pulseCurve(0.35);   // sine → short pulses
    h.lfoGain = ctx.createGain(); h.lfoGain.gain.value = 1;
    h.lfo.connect(h.lfoShape).connect(h.lfoGain).connect(h.chop.gain);
    h.src.connect(h.lp).connect(h.chop).connect(h.out);
    // turbine hiss: a quiet band of noise rather than a tone (a steady tone reads as a hum)
    h.src2 = ctx.createBufferSource(); h.src2.buffer = noise; h.src2.loop = true;
    h.hissBp = ctx.createBiquadFilter(); h.hissBp.type = 'bandpass'; h.hissBp.frequency.value = 1800; h.hissBp.Q.value = 0.9;
    h.hiss = ctx.createGain(); h.hiss.gain.value = 0;
    h.src2.connect(h.hissBp).connect(h.hiss).connect(h.out);
    h.src.start(); h.lfo.start(); h.src2.start();

    // ---------------- jet
    const j = (this.jet = {});
    j.out = ctx.createGain(); j.out.gain.value = 0; j.out.connect(this.master);
    j.src = ctx.createBufferSource(); j.src.buffer = noise; j.src.loop = true;
    j.bp = ctx.createBiquadFilter(); j.bp.type = 'bandpass'; j.bp.frequency.value = 900; j.bp.Q.value = 0.6;
    j.rush = ctx.createGain(); j.rush.gain.value = 0;
    j.src.connect(j.bp).connect(j.rush).connect(j.out);
    j.osc = ctx.createOscillator(); j.osc.type = 'sawtooth'; j.osc.frequency.value = 90;
    j.oscLp = ctx.createBiquadFilter(); j.oscLp.type = 'lowpass'; j.oscLp.frequency.value = 900;
    j.whine = ctx.createGain(); j.whine.gain.value = 0;
    j.osc.connect(j.oscLp).connect(j.whine).connect(j.out);
    j.src2 = ctx.createBufferSource(); j.src2.buffer = noise; j.src2.loop = true;
    j.rumbleLp = ctx.createBiquadFilter(); j.rumbleLp.type = 'lowpass'; j.rumbleLp.frequency.value = 110;
    j.rumble = ctx.createGain(); j.rumble.gain.value = 0;
    j.src2.connect(j.rumbleLp).connect(j.rumble).connect(j.out);
    j.src.start(); j.osc.start(); j.src2.start();
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('sound', on ? 'on' : 'off');
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  /**
   * @param heli  { spool 0..1, lift 0..1 (collective), distance m from the player, audible bool }
   * @param jet   { on bool, speed m/s, throttle -1..1, airborne bool, distance m }
   */
  update(heli, jet) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, k = 0.08;
    const falloff = (d) => Math.max(0, 1 - d / 160) ** 1.5;
    // helicopter
    const h = this.heli;
    const sp = heli.audible ? heli.spool : 0;
    const hv = Math.min(1, sp * sp * 1.1) * falloff(heli.distance);
    h.out.gain.setTargetAtTime(hv * 0.9, t, k);
    h.lfo.frequency.setTargetAtTime(2 + sp * 17, t, k);                 // blade-pass rate: slow thud → fast whop
    h.lp.frequency.setTargetAtTime(200 + sp * 160 + heli.lift * 120, t, k);
    h.chop.gain.setTargetAtTime(0.0, t, k);                              // base level, LFO adds the pulses
    h.lfoGain.gain.setTargetAtTime(0.7 + heli.lift * 0.3, t, k);
    h.hiss.gain.setTargetAtTime(sp * 0.05, t, k);
    h.hissBp.frequency.setTargetAtTime(1400 + sp * 900 + heli.lift * 300, t, k);
    // jet
    const j = this.jet;
    const s = jet.on ? Math.min(1, jet.speed / 80) : 0;
    const thr = jet.on ? Math.max(0, jet.throttle) : 0;
    const jv = (jet.on ? 0.25 + s * 0.75 : 0) * falloff(jet.distance);
    j.out.gain.setTargetAtTime(jv, t, k);
    j.rush.gain.setTargetAtTime(0.15 + s * 0.55, t, k);
    j.bp.frequency.setTargetAtTime(600 + s * 1600, t, k);
    j.whine.gain.setTargetAtTime(0.06 + s * 0.08 + thr * 0.05, t, k);
    j.osc.frequency.setTargetAtTime(70 + s * 110 + thr * 30, t, k);
    j.oscLp.frequency.setTargetAtTime(500 + s * 1800, t, k);
    j.rumble.gain.setTargetAtTime(thr * (jet.airborne ? 0.9 : 0.5), t, k);
  }

  #noiseBuffer(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  /** WaveShaper curve turning a sine LFO (-1..1) into narrow positive pulses of the given duty. */
  #pulseCurve(duty) {
    const c = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;                 // sine value
      const edge = 1 - duty * 2;                   // only the top of the sine counts
      c[i] = x > edge ? (x - edge) / (1 - edge) : 0;
    }
    return c;
  }
}
