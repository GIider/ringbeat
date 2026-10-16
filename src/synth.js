// Web Audio synthesizer. Everything is scheduled in AudioContext.currentTime seconds.

const FREQ = Array.from({ length: 128 }, (_, m) => 440 * 2 ** ((m - 69) / 12));
const freqOf = m => FREQ[m] || 440 * 2 ** ((m - 69) / 12);
const disconnectAll = function () { for (const n of this) { try { n.disconnect(); } catch {} } };

const ATTACK = 0.005, DECAY = 0.06, SUSTAIN = 0.5, RELEASE = 0.08, PEAK = 0.22;
const BUZZ = 0.13; // buzzer level: a bare square is loud, keep it near the smooth voice's sustain

export class Synth {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.voice = 'buzzer'; // 'buzzer' (phone piezo) | 'smooth' (two detuned squares with a soft envelope)
  }

  // Call from a user gesture. Creates the context once, and resumes it if suspended.
  ensure() {
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
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume * 0.8;
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
    return this.voice === 'buzzer' ? this._buzz(opts) : this._smooth(opts);
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
