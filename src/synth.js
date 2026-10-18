// Web Audio synthesizer. Everything is scheduled in AudioContext.currentTime seconds.

const FREQ = Array.from({ length: 128 }, (_, m) => 440 * 2 ** ((m - 69) / 12));
const freqOf = m => FREQ[m] || 440 * 2 ** ((m - 69) / 12);
const disconnectAll = function () { for (const n of this) { try { n.disconnect(); } catch {} } };

const ATTACK = 0.005, DECAY = 0.06, SUSTAIN = 0.5, RELEASE = 0.08, PEAK = 0.22;
const BUZZ = 0.13; // buzzer level: a bare square is loud, keep it near the smooth voice's sustain

// Instrument voices beyond the buzzer/smooth pair, as data for Synth._voiced(). Per voice:
//   layers  oscillators summed together: type | pulse (duty), mult (frequency ratio), gain, detune (cents)
//   a/d/s/r envelope (s is a fraction of peak), peak, lp {from, to, time} filter sweep, vib cents (onset after 0.15 s),
//   arp semitone steps and step length, fm {ratio, index, decay} (index decays so the attack rings like a bell)
const VOICE_SPECS = {
  pulse:    { layers: [{ pulse: 0.25 }], a: 0.003, d: 0.05, s: 0.6, r: 0.06, peak: 0.2 },
  triangle: { layers: [{ type: 'triangle' }], a: 0.004, d: 0.04, s: 0.8, r: 0.07, peak: 0.26 },
  arp:      { layers: [{ type: 'square' }], a: 0.003, d: 0.05, s: 0.7, r: 0.06, peak: 0.17, arp: [0, 4, 7], step: 0.04 },
  bell:     { layers: [{ type: 'sine' }], a: 0.002, d: 0.4, s: 0.15, r: 0.15, peak: 0.35, fm: { ratio: 3.5, index: 2.2, decay: 0.3 } },
  organ:    { layers: [{ type: 'sine' }, { type: 'sine', mult: 2, gain: 0.5 }, { type: 'sine', mult: 3, gain: 0.25 }], a: 0.01, d: 0.01, s: 1, r: 0.03, peak: 0.13 },
  pluck:    { layers: [{ type: 'triangle' }, { type: 'sine', mult: 2, gain: 0.3 }], a: 0.002, d: 0.25, s: 0, r: 0.05, peak: 0.3, lp: { from: 3200, to: 400, time: 0.18 } },
  saw:      { layers: [{ type: 'sawtooth' }, { type: 'sawtooth', detune: 6, gain: 0.5 }], a: 0.01, d: 0.08, s: 0.6, r: 0.08, peak: 0.13, lp: { from: 1800, to: 1800, time: 0 }, vib: 12 },
  gameboy:  { layers: [{ type: 'square' }], a: 0.002, d: 0.03, s: 0.8, r: 0.04, peak: 0.14, vib: 20 },
};
const MENU_NOTES = [84, 86, 88, 91, 93, 96, 98]; // C6 D6 E6 G6 A6 C7 D7
export const VOICES = ['buzzer', 'smooth', ...Object.keys(VOICE_SPECS)];
const ARP_SPAN = 12; // seconds of arpeggio steps scheduled ahead for a note held without a known end
const pulseWaves = new WeakMap();

export class Synth {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.focusMuted = false;
    this.voice = 'buzzer'; // one of VOICES: 'buzzer' (phone piezo) | 'smooth' (two detuned squares with a soft envelope) | VOICE_SPECS keys
  }

  // Call from a user gesture. Creates the context once, and resumes it if suspended.
  ensure() {
    if (this.ctx && this.ctx.state === 'closed') this.ctx = null; // a closed context can't be revived; build a fresh one
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
      this.lowpass = ctx.createBiquadFilter();
      this.lowpass.type = 'lowpass';
      this.lowpass.frequency.value = 4000;
      this.master = ctx.createGain();
      this.comp = ctx.createDynamicsCompressor();
      this.lowpass.connect(this.master).connect(this.comp).connect(ctx.destination);
      this.setVolume(this.volume);
      this._newBus();
      // Safari reports 'interrupted' (call, Siri, app switch); treat anything but 'running' as resumable
      ctx.onstatechange = () => { if (this.wantRunning && ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {}); };
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {} // play through the iOS silent switch
    }
    this.wantRunning = true;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Revive a context that went quiet (no-op before the first ensure()). Re-arms the auto-resume in onstatechange.
  wake() {
    if (!this.ctx) return;
    this.wantRunning = true;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this._applyGain(false);
  }

  // Silence the output while the page is unfocused without touching the volume setting. The clock keeps running.
  setFocusMuted(b) {
    b = !!b;
    if (b === this.focusMuted) return;
    this.focusMuted = b;
    this._applyGain(true);
  }

  _applyGain(ramp) {
    if (!this.master) return;
    const target = this.focusMuted ? 0 : this.volume * 0.8, g = this.master.gain;
    if (ramp && g.setTargetAtTime) { g.cancelScheduledValues(this.ctx.currentTime); g.setTargetAtTime(target, this.ctx.currentTime, 0.015); } // short ramp: no clicks
    else { if (g.cancelScheduledValues) g.cancelScheduledValues(0); g.value = target; }
  }

  getAudioClock() { return this.ctx ? this.ctx.currentTime : 0; }

  // Output latency in seconds (outputLatency if available, else baseLatency).
  getLatency() {
    const c = this.ctx;
    return c ? (c.outputLatency || c.baseLatency || 0) : 0;
  }

  // All sounds go through a per-session bus so stopAll() can silence even
  // already-scheduled sounds by disconnecting it.
  _newBus() {
    this.bus = this.ctx.createGain();
    this.bus.connect(this.lowpass);
  }

  stopAll() {
    if (!this.ctx) return;
    this.bus.disconnect();
    this._newBus();
  }

  _cleanup(osc, nodes) {
    osc.onended = disconnectAll.bind(nodes);
  }

  // Instrument voice. Auto-ends at when+duration; release() can cut it earlier (hold notes).
  // Omit duration (Infinity) to sustain until release().
  playNote(opts) {
    if (this.voice === 'buzzer') return this._buzz(opts);
    const spec = VOICE_SPECS[this.voice];
    return spec ? this._voiced(spec, opts) : this._smooth(opts);
  }

  // PeriodicWave for a pulse of the given duty cycle (Fourier series of a rectangular wave), cached per context.
  _pulseWave(duty) {
    let m = pulseWaves.get(this.ctx);
    if (!m) pulseWaves.set(this.ctx, m = new Map());
    if (!m.has(duty)) {
      const N = 48, re = new Float32Array(N), im = new Float32Array(N);
      for (let n = 1; n < N; n++) { re[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI); im[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI); }
      m.set(duty, this.ctx.createPeriodicWave(re, im));
    }
    return m.get(duty);
  }

  // Data-driven voice (see VOICE_SPECS). Same contract as _buzz/_smooth: auto-ends at when+duration, release() cuts early.
  _voiced(spec, { midi, when, duration = Infinity }) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const freq = freqOf(midi);
    const nodes = [], oscs = [];
    const add = n => (nodes.push(n), n);
    const env = add(ctx.createGain()), rel = add(ctx.createGain()); // release on its own node, like _smooth
    const mix = add(ctx.createGain());
    let tail = mix;
    if (spec.lp) {
      const lp = add(ctx.createBiquadFilter()); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(spec.lp.from, t);
      if (spec.lp.time) lp.frequency.exponentialRampToValueAtTime(spec.lp.to, t + spec.lp.time);
      tail = tail.connect(lp);
    }
    tail.connect(env).connect(rel).connect(this.bus);
    const vib = spec.vib && add(ctx.createGain());
    if (vib) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5; oscs.push(lfo); add(lfo);
      vib.gain.setValueAtTime(0, t); vib.gain.linearRampToValueAtTime(spec.vib, t + 0.2);
      lfo.connect(vib);
    }
    for (const L of spec.layers) {
      const o = add(ctx.createOscillator()); oscs.push(o);
      if (L.pulse) o.setPeriodicWave(this._pulseWave(L.pulse)); else o.type = L.type;
      o.frequency.value = freq * (L.mult || 1);
      if (L.detune) o.detune.value = L.detune;
      if (vib) vib.connect(o.detune);
      if (spec.arp) {
        const stop = t + Math.min(duration, ARP_SPAN);
        for (let i = 0, at = t; at < stop; i++, at += spec.step) o.frequency.setValueAtTime(freq * 2 ** (spec.arp[i % spec.arp.length] / 12), at);
      }
      if (spec.fm) {
        const m = add(ctx.createOscillator()); oscs.push(m); m.frequency.value = freq * spec.fm.ratio;
        const mg = add(ctx.createGain()), depth = freq * spec.fm.ratio * spec.fm.index;
        mg.gain.setValueAtTime(depth, t); mg.gain.exponentialRampToValueAtTime(depth * 0.05, t + spec.fm.decay);
        m.connect(mg).connect(o.frequency);
      }
      const g = add(ctx.createGain()); g.gain.value = L.gain ?? 1;
      o.connect(g).connect(mix);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(spec.peak, t + spec.a);
    env.gain.linearRampToValueAtTime(spec.peak * spec.s, t + spec.a + spec.d);
    for (const o of oscs) o.start(t);
    this._cleanup(oscs[0], nodes);
    let ended = false;
    const end = at => {
      at = Math.max(at, t + spec.a);
      rel.gain.cancelScheduledValues(at); rel.gain.setValueAtTime(1, at);
      rel.gain.linearRampToValueAtTime(0, at + spec.r);
      for (const o of oscs) { try { o.stop(at + spec.r + 0.02); } catch {} }
    };
    if (Number.isFinite(duration)) end(t + duration);
    return {
      release(at = ctx.currentTime) {
        if (ended) return;
        ended = true;
        if (Number.isFinite(duration)) at = Math.min(at, t + duration);
        end(at);
      },
    };
  }

  // Piezo buzzer: one square wave, hard on/off, band-limited and peaked around the piezo's resonance.
  _buzz({ midi, when, duration = Infinity }) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freqOf(midi);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 3000; pk.Q.value = 1.2; pk.gain.value = 6;
    const env = ctx.createGain();
    o.connect(hp).connect(pk).connect(env).connect(this.bus);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(BUZZ, t + 0.002);
    o.start(t);
    this._cleanup(o, [o, hp, pk, env]);
    let ended = false;
    const end = at => {
      at = Math.max(at, t + 0.004);
      env.gain.cancelScheduledValues(at);
      env.gain.setValueAtTime(BUZZ, at);
      env.gain.linearRampToValueAtTime(0, at + 0.008);
      try { o.stop(at + 0.02); } catch {}
    };
    if (Number.isFinite(duration)) end(t + Math.max(0.01, duration - 0.008)); // tiny gap so repeated notes re-articulate
    return {
      release(at = ctx.currentTime) {
        if (ended) return;
        ended = true;
        if (Number.isFinite(duration)) at = Math.min(at, t + duration);
        end(at);
      },
    };
  }

  // Juice: a quiet octave-up blip layered on perfect hits, a rising 2-note chirp at combo milestones and a falling
  // 2-step slide when a combo breaks. Same piezo square voice, below the note level so the melody stays clean.
  _beeps(steps, level) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    for (const [midi, at, d] of steps) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freqOf(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(level, t + at + 0.002);
      g.gain.setValueAtTime(level, t + at + d - 0.006);
      g.gain.linearRampToValueAtTime(0, t + at + d);
      o.connect(g).connect(this.bus);
      o.start(t + at); o.stop(t + at + d + 0.01);
      this._cleanup(o, [o, g]);
    }
  }
  ping(midi) { this._beeps([[midi + 12, 0, 0.025]], 0.04); }
  chirp() { this._beeps([[88, 0, 0.045], [95, 0.05, 0.06]], 0.05); }
  breakSlide() { this._beeps([[67, 0, 0.05], [60, 0.05, 0.07]], 0.05); }
  // Result grade stinger: S gets a 4-note run, then fewer/lower notes down to a flat two-note C.
  stinger(grade) {
    const seq = { S: [72, 76, 79, 84], A: [72, 76, 79], B: [72, 76], C: [67, 64] }[grade] || [60, 57];
    this._beeps(seq.map((m, i) => [m, i * 0.09, i === seq.length - 1 ? 0.2 : 0.08]), 0.06);
  }
  tickUp(step) { this._beeps([[72 + (step % 12), 0, 0.02]], 0.04); }

  // Favorite added: a bright rising sparkle that trails off as the heart floats away.
  favAdd() {
    this._beeps([[79, 0, 0.05], [84, 0.05, 0.05], [91, 0.1, 0.05], [96, 0.15, 0.12]], 0.045);
    this._beeps([[103, 0.1, 0.03], [108, 0.18, 0.06]], 0.02);
  }

  // Favorite removed: a small pop as the heart appears, then (as it cracks, `crackAt` seconds later) a low thud, a noise
  // crunch and two falling beeps.
  favBreak(crackAt = 0.26) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this._beeps([[84, 0, 0.04]], 0.04);
    const t = ctx.currentTime + crackAt;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.13);
    this._cleanup(o, [o, g]);
    const len = Math.ceil(ctx.sampleRate * 0.07), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.1, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(hp).connect(ng).connect(this.bus);
    n.start(t);
    this._cleanup(n, [n, hp, ng]);
    this._beeps([[64, crackAt + 0.04, 0.04], [55, crackAt + 0.09, 0.09]], 0.04);
  }

  // Menu key beep.
  keyClick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1760;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.002);
    g.gain.setValueAtTime(0.05, t + 0.025);
    g.gain.linearRampToValueAtTime(0, t + 0.03);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.04);
    this._cleanup(o, [o, g]);
  }

  // Main-menu scroll: the key beep, pitched by item on a rising pentatonic, so scrolling through plays a little run.
  menuBlip(i) { this._beeps([[MENU_NOTES[((i % MENU_NOTES.length) + MENU_NOTES.length) % MENU_NOTES.length], 0, 0.03]], 0.05); }

  // "Not available" buzz: two short low beeps.
  blocked() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    for (const at of [0, 0.07]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.05, t + at + 0.003);
      g.gain.setValueAtTime(0.05, t + at + 0.04);
      g.gain.linearRampToValueAtTime(0, t + at + 0.05);
      o.connect(g).connect(this.bus);
      o.start(t + at); o.stop(t + at + 0.06);
      this._cleanup(o, [o, g]);
    }
  }

  // Short power-on melody.
  jingle() {
    const ctx = this.ensure(), t0 = ctx.currentTime + 0.05;
    [[72, 0, 0.1], [76, 0.11, 0.1], [79, 0.22, 0.1], [84, 0.33, 0.28]].forEach(([midi, at, d]) =>
      this.playNote({ midi, when: t0 + at, duration: d }));
  }

  _smooth({ midi, when, duration = Infinity, releasable = false }) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const freq = freqOf(midi);

    const o1 = ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = freq; o2.detune.value = 7;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const env = ctx.createGain();   // attack / decay / sustain
    // Release lives on its own node so held voices can be cut/re-scheduled freely. Plain fixed-length
    // notes (long enough to reach sustain) fold the release into `env` and skip the extra node.
    const needRel = releasable || !Number.isFinite(duration) || duration < ATTACK + DECAY + 0.01;
    const rel = needRel ? ctx.createGain() : null;
    o1.connect(env); o2.connect(g2).connect(env);
    if (rel) env.connect(rel).connect(this.bus); else env.connect(this.bus);

    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(PEAK, t + ATTACK);
    env.gain.linearRampToValueAtTime(PEAK * SUSTAIN, t + ATTACK + DECAY);

    o1.start(t); o2.start(t);
    this._cleanup(o2, rel ? [o1, o2, g2, env, rel] : [o1, o2, g2, env]);

    let ended = false;
    const end = (at) => {
      at = Math.max(at, t + ATTACK);
      const p = rel ? rel.gain : env.gain;
      if (rel) { p.cancelScheduledValues(at); p.setValueAtTime(1, at); }
      else p.setValueAtTime(PEAK * SUSTAIN, at);
      p.linearRampToValueAtTime(0, at + RELEASE);
      try { o1.stop(at + RELEASE + 0.02); o2.stop(at + RELEASE + 0.02); } catch {}
    };
    if (Number.isFinite(duration)) end(t + duration); // held voices without a duration wait for release()
    return {
      // Fade out starting at audio time `at` (never later than the scheduled natural end).
      release(at = ctx.currentTime) {
        if (ended) return;
        ended = true;
        if (Number.isFinite(duration)) at = Math.min(at, t + duration);
        end(at);
      },
    };
  }

  // Quiet muted thud: pitch an octave down, slightly detuned, 60 ms, heavily lowpassed.
  playMiss(midi, when = 0) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = freqOf(midi - 12);
    o.detune.value = 35;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.005);
    g.gain.linearRampToValueAtTime(0, t + 0.06);
    o.connect(lp).connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.07);
    this._cleanup(o, [o, lp, g]);
  }

  // Rough error buzz for a press on a lane with no note: fixed low pitch per lane, so spamming never forms a melody.
  playStray(lane, when = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = 220 + (lane % 4) * 14;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.004);
    g.gain.linearRampToValueAtTime(0, t + 0.09);
    o.connect(lp).connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.1);
    this._cleanup(o, [o, lp, g]);
  }

  // Metronome blip; accent = higher pitch.
  tick({ when, accent = false }) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = accent ? 1760 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.002);
    g.gain.linearRampToValueAtTime(0, t + 0.04);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.05);
    this._cleanup(o, [o, g]);
  }
}
