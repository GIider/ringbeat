// Latency calibration: tap along with 12 ticks at 90 BPM; the median tap-vs-tick offset is the result.
// Offsets are compared on the audio clock, using input.js's audio timestamps.

const BPM = 90, BEATS = 12, LEAD = 1.2, OUTLIER = 0.25, MIN_TAPS = 4;

export class Calibration {
  constructor(synth) {
    this.synth = synth;
    this.reset();
  }

  reset() { this.tickTimes = []; this.taps = []; this.running = false; }

  start() {
    const ctx = this.synth.ensure();
    this.synth.stopAll();
    this.reset();
    const beat = 60 / BPM, t0 = ctx.currentTime + LEAD;
    for (let i = 0; i < BEATS; i++) {
      const t = t0 + i * beat;
      this.tickTimes.push(t);
      this.synth.tick({ when: t, accent: i % 4 === 0 });
    }
    this.running = true;
  }

  recordTap(audioTime) { if (this.running) this.taps.push(audioTime); }

  get beatsTotal() { return BEATS; }
  get finished() {
    return this.running && this.synth.ctx.currentTime > this.tickTimes[BEATS - 1] + 0.6;
  }

  // 0..1 pulse intensity synced to what the player hears.
  pulse() {
    if (!this.running) return 0;
    const now = this.synth.ctx.currentTime - this.synth.getLatency();
    let best = Infinity;
    for (const t of this.tickTimes) { const d = now - t; if (d >= 0 && d < best) best = d; }
    return best === Infinity ? 0 : Math.max(0, 1 - best / 0.25);
  }

  // Median offset (seconds, positive = player taps late), or null if too few usable taps.
  result() {
    const offs = [];
    for (const tap of this.taps) {
      let best = Infinity;
      for (const t of this.tickTimes) if (Math.abs(tap - t) < Math.abs(best)) best = tap - t;
      if (Math.abs(best) <= OUTLIER) offs.push(best);
    }
    if (offs.length < MIN_TAPS) return null;
    offs.sort((a, b) => a - b);
    const m = offs.length >> 1;
    return offs.length % 2 ? offs[m] : (offs[m - 1] + offs[m]) / 2;
  }
}
