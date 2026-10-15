// Game logic: judging, scoring, holds, pause/restart. The audio clock is the only time source.

export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.135 }; // seconds, |delta| from target
export const HOLD_RELEASE_FORGIVE = 0.15; // releasing this close to the tail end still completes the hold
export const HOLD_BONUS = 100;
export const POINTS = { perfect: 300, great: 200, good: 100 };
const ACCURACY_WEIGHT = { perfect: 1, great: 2 / 3, good: 1 / 3, miss: 0 };
const LOOKAHEAD = 0.1, SCHED_INTERVAL = 25; // ms timer that schedules *audio* only, never judges
const END_PADDING = 0.6;

export function gradeFor(acc) {
  return acc >= 95 ? 'S' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : acc >= 70 ? 'C' : 'D';
}

export class Game {
  constructor(synth) {
    this.synth = synth;
    this.active = false;      // a song is loaded (running, paused or finishing)
    this.state = 'idle';      // idle | running | paused | done
    this.fx = { press() {}, judge() {} }; // set by renderer
    this.onFinish = () => {};
    this.timer = null;
  }

  start(chart, { leadIn = 2, backing = true, calibration = 0 } = {}) {
    this.stop();
    const ctx = this.synth.ctx;
    this.chart = chart;
    this.backing = backing;
    this.calibration = calibration;
    this.songStart = ctx.currentTime + leadIn;
    this.lanePtr = new Array(chart.lanes).fill(0);
    this.byLane = Array.from({ length: chart.lanes }, () => []);
    for (const n of chart.notes) {
      n.hit = n.judged = n.holding = n.broken = n.done = false;
      n.judgement = null; n.voice = null;
      this.byLane[n.lane].push(n);
    }
    this.backingPtr = 0;
    this.holds = new Array(chart.lanes).fill(null);
    this.pendingRelease = new Array(chart.lanes).fill(false);
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.judgedCount = 0;
    this.notesLeft = chart.notes.length; // notes not yet judged (a dropped hold does not add to this)
    this.accSum = 0;
    this.deltas = [];         // signed hit offsets in seconds (+ = late), in hit order
    // Beat grid: tick n sits at songStart + (n - firstBeat) * beatLen
    this.nextBeat = Math.ceil(chart.firstBeat + (ctx.currentTime - this.songStart) / chart.beatLen - 1e-9);
    this.active = true;
    this.state = 'running';
    this._startScheduler();
  }

  // Song time in seconds as the player *hears/sees* it: audio clock minus output latency and calibration.
  songTime() {
    const ctx = this.synth.ctx;
    return ctx.currentTime - this.songStart - this.synth.getLatency() - this.calibration;
  }

  get accuracy() { return this.judgedCount ? 100 * this.accSum / this.judgedCount : 100; }
  get grade() { return gradeFor(this.accuracy); }
  // True while no note has been missed so far (the "full combo" streak is alive).
  get fcAlive() { return this.judgedCount > 0 && this.counts.miss === 0; }
  get apAlive() { return this.fcAlive && this.counts.great + this.counts.good === 0; }
  get multiplier() { return Math.min(2, 1 + Math.floor(this.combo / 10) * 0.1); }

  // ---- ticks (count-in always; backing pulse optional) ----
  _startScheduler() {
    clearInterval(this.timer);
    this._schedule();
    this.timer = setInterval(() => this._schedule(), SCHED_INTERVAL);
  }
  _schedule() {
    const ctx = this.synth.ctx, c = this.chart;
    const horizon = ctx.currentTime + LOOKAHEAD;
    const stopAt = this.songStart + c.length;
    for (;;) {
      const t = this.songStart + (this.nextBeat - c.firstBeat) * c.beatLen;
      if (t >= horizon || t > stopAt) break;
      const countIn = t < this.songStart - 1e-6;
      if (t >= ctx.currentTime - 0.005 && (countIn || this.backing)) {
        this.synth.tick({ when: t, accent: ((this.nextBeat % 4) + 4) % 4 === 0 });
      }
      this.nextBeat++;
    }
    // Auto-play notes that were filtered out of the playable chart so the song sounds complete.
    const bk = c.backing || [];
    while (this.backingPtr < bk.length && this.songStart + bk[this.backingPtr].time < horizon) {
      const b = bk[this.backingPtr++], when = this.songStart + b.time;
      if (when >= ctx.currentTime - 0.005) this.synth.playNote({ midi: b.midi, when, duration: b.duration });
    }
  }

  // ---- input ----
  // `audioTime` is on the speaker timeline (see input.js), so it compares directly with songTime().
  press(lane, audioTime) {
    if (this.state !== 'running') return;
    this.fx.press(lane);
    const t = audioTime - this.songStart - this.calibration;
    const list = this.byLane[lane];
    let i = this.lanePtr[lane];
    while (i < list.length && list[i].judged) i++;
    this.lanePtr[lane] = i;
    let best = null, bestAbs = Infinity;
    for (; i < list.length && list[i].time <= t + WINDOWS.good; i++) {
      const n = list[i];
      if (n.judged) continue;
      const d = Math.abs(t - n.time);
      if (d < bestAbs) { best = n; bestAbs = d; }
    }
    if (!best || bestAbs > WINDOWS.good) return; // ghost tap: ignored
    const j = bestAbs <= WINDOWS.perfect ? 'perfect' : bestAbs <= WINDOWS.great ? 'great' : 'good';
    this._judge(best, j);
    this.deltas.push(t - best.time);
    best.hit = true;
    const ctx = this.synth.ctx;
    if (best.isHold) {
      best.holding = true;
      this.holds[lane] = best;
      // Sustain until release() or the note's natural end.
      const remaining = Math.max(0.05, best.time + best.duration - t);
      best.voice = this.synth.playNote({ midi: best.midi, when: ctx.currentTime, duration: remaining, releasable: true });
    } else {
      this.synth.playNote({ midi: best.midi, when: ctx.currentTime, duration: best.duration });
    }
  }

  release(lane, audioTime) {
    if (this.state === 'paused') { this.pendingRelease[lane] = true; return; }
    const n = this.holds[lane];
    if (this.state !== 'running' || !n) return;
    const t = audioTime - this.songStart - this.calibration;
    if (n.voice) n.voice.release(this.synth.ctx.currentTime);
    if (t >= n.time + n.duration - HOLD_RELEASE_FORGIVE) this._completeHold(n);
    else this._breakHold(n);
  }

  // Per-frame: auto-misses, hold completion, end of song. `t` = songTime().
  update(t) {
    if (this.state !== 'running') return;
    for (let lane = 0; lane < this.byLane.length; lane++) {
      const list = this.byLane[lane];
      let i = this.lanePtr[lane];
      while (i < list.length && (list[i].judged || list[i].time + WINDOWS.good < t)) {
        const n = list[i];
        if (!n.judged) this._miss(n, true);
        i++;
      }
      this.lanePtr[lane] = i;
      const h = this.holds[lane];
      if (h && t >= h.time + h.duration) this._completeHold(h); // still held at the end
    }
    if (t > this.chart.length + END_PADDING) {
      this.state = 'done';
      clearInterval(this.timer);
      this.onFinish(this.results());
    }
  }

  _judge(n, j) {
    n.judged = true; n.judgement = j;
    this.notesLeft--;
    this.counts[j]++;
    this.judgedCount++;
    this.accSum += ACCURACY_WEIGHT[j];
    this.score += Math.round(POINTS[j] * this.multiplier);
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.fx.judge(n.lane, j);
  }

  _miss(n, headMissed) {
    if (headMissed) { n.judged = true; n.judgement = 'miss'; this.notesLeft--; }
    this.counts.miss++;
    this.judgedCount++;
    this.combo = 0;
    this.synth.playMiss(n.midi);
    this.fx.judge(n.lane, 'miss');
  }

  _completeHold(n) {
    n.holding = false; n.done = true;
    this.holds[n.lane] = null;
    this.score += Math.round(HOLD_BONUS * this.multiplier);
  }

  _breakHold(n) {
    n.holding = false; n.broken = true;
    this.holds[n.lane] = null;
    this._miss(n, false);
  }

  // ---- pause / restart ----
  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    clearInterval(this.timer);
    this.synth.ctx.suspend(); // currentTime stops, so the timing model stays correct
  }

  async resume() {
    if (this.state !== 'paused') return;
    await this.synth.ctx.resume();
    this.state = 'running';
    this._startScheduler();
    const now = this.synth.ctx.currentTime - this.synth.getLatency();
    this.pendingRelease.forEach((r, lane) => {
      if (r) { this.pendingRelease[lane] = false; this.release(lane, now); }
    });
  }

  // Silence everything and cancel timers (used by restart / back to menu).
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.synth.ctx) {
      this.synth.stopAll();
      if (this.state === 'paused') this.synth.ctx.resume();
    }
    this.state = 'idle';
    this.active = false;
  }

  results() {
    const total = this.chart.notes.length;
    // Full combo: every note was hit (holds that were dropped count as misses).
    const fc = this.counts.miss === 0 && this.judgedCount >= total;
    return {
      score: this.score, maxCombo: this.maxCombo, counts: { ...this.counts },
      accuracy: this.accuracy, grade: this.grade,
      fc, ap: fc && this.counts.great + this.counts.good === 0,
      deltas: this.deltas.slice(),
    };
  }
}
