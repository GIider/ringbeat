// Web Audio synthesizer. Everything is scheduled in AudioContext.currentTime seconds.

const ATTACK = 0.005, DECAY = 0.06, SUSTAIN = 0.5, RELEASE = 0.08, PEAK = 0.22;

export class Synth {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
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
    osc.onended = () => nodes.forEach(n => { try { n.disconnect(); } catch {} });
  }

  // Instrument voice. Auto-ends at when+duration; release() can cut it earlier (hold notes).
  // Omit duration (Infinity) to sustain until release().
  playNote({ midi, when, duration = Infinity }) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const freq = 440 * 2 ** ((midi - 69) / 12);

    const o1 = ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = freq; o2.detune.value = 7;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const env = ctx.createGain();   // attack / decay / sustain
    const rel = ctx.createGain();   // release lives on its own node so it can be re-scheduled freely
    o1.connect(env); o2.connect(g2).connect(env); env.connect(rel).connect(this.bus);

    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(PEAK, t + ATTACK);
    env.gain.linearRampToValueAtTime(PEAK * SUSTAIN, t + ATTACK + DECAY);

    o1.start(t); o2.start(t);
    this._cleanup(o2, [o1, o2, g2, env, rel]);

    let ended = false;
    const end = (at) => {
      at = Math.max(at, t + ATTACK);
      rel.gain.cancelScheduledValues(at);
      rel.gain.setValueAtTime(1, at);
      rel.gain.linearRampToValueAtTime(0, at + RELEASE);
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
    o.frequency.value = 440 * 2 ** ((midi - 12 - 69) / 12);
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
