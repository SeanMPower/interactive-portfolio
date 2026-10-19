/**
 * Procedural engine sounds (Web Audio, no sample files):
 *   helicopter — just the rotor "whop": low-passed noise chopped at the blade-pass rate,
 *                both scaled by how fast the rotors are spinning; the whop slows as the rotors wind down
 *   jet        — layered noise: a pink-noise roar, soft-clipped brown rumble, a narrow-band turbine whistle that
 *                climbs with RPM, high-passed air rush at speed, and a fluttering crackle under afterburner
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
    h.src.start(); h.lfo.start();

    // ---------------- jet: layered noise, no raw oscillators (those buzz rather than roar)
    const pink = this.#pinkBuffer(3), brown = this.#brownBuffer(3);
    const j = (this.jet = {});
    j.out = ctx.createGain(); j.out.gain.value = 0; j.out.connect(this.master);
    // 1. core roar: pink noise with a mid-range emphasis, the body of the sound
    j.roarSrc = ctx.createBufferSource(); j.roarSrc.buffer = pink; j.roarSrc.loop = true;
    j.roarEq = ctx.createBiquadFilter(); j.roarEq.type = 'peaking'; j.roarEq.frequency.value = 420; j.roarEq.Q.value = 0.8; j.roarEq.gain.value = 7;
    j.roarLp = ctx.createBiquadFilter(); j.roarLp.type = 'lowpass'; j.roarLp.frequency.value = 2500; j.roarLp.Q.value = 0.5;
    j.roar = ctx.createGain(); j.roar.gain.value = 0;
    j.roarSrc.connect(j.roarEq).connect(j.roarLp).connect(j.roar).connect(j.out);
    // 2. rumble: brown noise, soft-clipped for grit, swells with throttle / afterburner
    j.rumSrc = ctx.createBufferSource(); j.rumSrc.buffer = brown; j.rumSrc.loop = true;
    j.rumLp = ctx.createBiquadFilter(); j.rumLp.type = 'lowpass'; j.rumLp.frequency.value = 140;
    j.rumShape = ctx.createWaveShaper(); j.rumShape.curve = this.#softClip(2.5);
    j.rumble = ctx.createGain(); j.rumble.gain.value = 0;
    j.rumSrc.connect(j.rumLp).connect(j.rumShape).connect(j.rumble).connect(j.out);
    // 3. turbine whistle: white noise through two very narrow band-passes (airy, not buzzy) that climb with RPM
    j.whSrc = ctx.createBufferSource(); j.whSrc.buffer = noise; j.whSrc.loop = true;
    j.wh1 = ctx.createBiquadFilter(); j.wh1.type = 'bandpass'; j.wh1.frequency.value = 2400; j.wh1.Q.value = 28;
    j.wh2 = ctx.createBiquadFilter(); j.wh2.type = 'bandpass'; j.wh2.frequency.value = 3600; j.wh2.Q.value = 32;
    j.whistle = ctx.createGain(); j.whistle.gain.value = 0;
    j.whSrc.connect(j.wh1).connect(j.whistle); j.whSrc.connect(j.wh2).connect(j.whistle); j.whistle.connect(j.out);
    // 4. air rush: high-passed white noise, the sound of speed
    j.rushSrc = ctx.createBufferSource(); j.rushSrc.buffer = noise; j.rushSrc.loop = true;
    j.rushHp = ctx.createBiquadFilter(); j.rushHp.type = 'highpass'; j.rushHp.frequency.value = 1800; j.rushHp.Q.value = 0.4;
    j.rush = ctx.createGain(); j.rush.gain.value = 0;
    j.rushSrc.connect(j.rushHp).connect(j.rush).connect(j.out);
    // 5. afterburner crackle: the rumble modulated by a fast random flutter
    j.flutter = ctx.createBufferSource(); j.flutter.buffer = this.#flutterBuffer(2); j.flutter.loop = true;
    j.flutterGain = ctx.createGain(); j.flutterGain.gain.value = 0;
    j.flutter.connect(j.flutterGain).connect(j.rumble.gain);
    j.roarSrc.start(); j.rumSrc.start(); j.whSrc.start(); j.rushSrc.start(); j.flutter.start();
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
    // jet
    const j = this.jet;
    const s = jet.on ? Math.min(1, jet.speed / 80) : 0;                 // airspeed 0..1
    const thr = jet.on ? Math.max(0, jet.throttle) : 0;                  // throttle 0..1
    const rpm = jet.on ? 0.35 + s * 0.45 + thr * 0.2 : 0;                // what the engine is doing, 0..1
    const jv = (jet.on ? 0.3 + rpm * 0.7 : 0) * falloff(jet.distance);
    j.out.gain.setTargetAtTime(jv, t, 0.12);
    j.roar.gain.setTargetAtTime(0.35 + rpm * 0.55, t, k);
    j.roarLp.frequency.setTargetAtTime(1400 + rpm * 3200, t, k);
    j.roarEq.frequency.setTargetAtTime(300 + rpm * 300, t, k);
    j.rumble.gain.setTargetAtTime(0.25 + thr * 0.9, t, k);
    j.rumLp.frequency.setTargetAtTime(110 + thr * 70, t, k);
    j.flutterGain.gain.setTargetAtTime(thr * (jet.airborne ? 0.5 : 0.25), t, k);
    j.whistle.gain.setTargetAtTime(0.25 + rpm * 0.9, t, k);
    j.wh1.frequency.setTargetAtTime(1500 + rpm * 2200, t, 0.15);
    j.wh2.frequency.setTargetAtTime(2300 + rpm * 3100, t, 0.15);
    j.rush.gain.setTargetAtTime(s * s * 0.35, t, k);
    j.rushHp.frequency.setTargetAtTime(2600 - s * 1200, t, k);
  }

  #noiseBuffer(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  /** Pink noise (−3 dB/oct): Paul Kellet's filter on white noise. */
  #pinkBuffer(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }
  /** Brown noise (−6 dB/oct): integrated white noise, leaky. */
  #brownBuffer(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    return buf;
  }
  /** Slow-ish random flutter (0..1, ~40–120 Hz content) for afterburner crackle, as a control signal. */
  #flutterBuffer(seconds) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    let v = 0, target = 0, hold = 0;
    for (let i = 0; i < n; i++) {
      if (hold-- <= 0) { target = Math.random(); hold = Math.floor(sr / (40 + Math.random() * 80)); }
      v += (target - v) * 0.02;
      d[i] = v;
    }
    return buf;
  }
  /** Gentle soft-clip curve for the rumble. */
  #softClip(drive) {
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
    return c;
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
