// Game logic: judging, scoring, holds, pause/restart. The audio clock is the only time source.

export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.135 }; // seconds, |delta| from target
export const HOLD_RELEASE_FORGIVE = 0.15; // releasing this close to the tail end still completes the hold
export const HOLD_BONUS = 100;
export const POINTS = { perfect: 300, great: 200, good: 100 };
export const SLIDE_WINDOW = 0.18;   // slide follow-up notes (not the first) accept presses this far off
export const COMBO_MULT_CAP = 50;   // combo at which the multiplier stops growing (x1.5)
export const ROLL_TICK_POINTS = 10;  // per press inside a roll, times the multiplier
export const ROLL_GRADES = [[0.8, 'perfect'], [0.6, 'great'], [0.4, 'good']]; // share of the roll's goal -> judgement
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
    this._setWindows(1);
    this.suddenDeath = false;
    this.failed = false;
  }

  // Hit windows for this run (mods can widen or narrow them). All judging reads these, not the exported base values.
  _setWindows(k) {
    this.win = { perfect: WINDOWS.perfect * k, great: WINDOWS.great * k, good: WINDOWS.good * k, slide: SLIDE_WINDOW * k };
    this.reach = Math.max(this.win.good, this.win.slide); // how far ahead of a press a note can still be matched
  }
  // Hit window of a note: slide follow-ups (idx > 0) are more forgiving than everything else.
  _windowOf(n) { return n.slideIdx > 0 ? this.win.slide : this.win.good; }

  start(chart, { leadIn = 2, backing = true, rollAudio = false, calibration = 0, windowScale = 1, suddenDeath = false } = {}) {
    this.stop();
    const ctx = this.synth.ctx;
    this._setWindows(windowScale);
    this.suddenDeath = !!suddenDeath;
    this.failed = false;
    this.chart = chart;
    this.backing = backing;
    this.rollAudio = rollAudio;
    this.rollQueue = [];      // auto-play ticks of rolls the player has started: { time, midi, duration }
    this.calibration = calibration;
    this.songStart = ctx.currentTime + leadIn;
    this.lanePtr = new Array(chart.lanes).fill(0);
    this.byLane = Array.from({ length: chart.lanes }, () => []);
    for (const n of chart.notes) {
      n.hit = n.judged = n.holding = n.broken = n.done = false;
      n.judgement = null; n.voice = null; n.rollHits = 0;
      this.byLane[n.lane].push(n);
    }
    this.backingPtr = 0;
    this.now = 0;
    this.holds = new Array(chart.lanes).fill(null);
    this.pendingRelease = new Array(chart.lanes).fill(false);
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.judgedCount = 0;
    this.strays = 0;          // presses that matched no note before the last note was played (break FC)
    this.notesLeft = chart.notes.length; // notes not yet judged (a dropped hold does not add to this)
    this.accSum = 0;
    this.deltas = [];         // signed hit offsets in seconds (+ = late), in hit order
    this.events = [];         // [note time, accuracy weight] per judged note (the results' score chart)
    // Everything that changed the outcome, in order: [songTime, code], code = lane (press), lane + 8 (release) or -1
    // (an update that judged something or ended the song). Replaying it gives the same results (replay.js).
    this.log = [];
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
  // True while no note has been missed and no stray press made (the "full combo" streak is alive).
  get fcAlive() { return this.judgedCount > 0 && this.counts.miss === 0 && this.strays === 0; }
  get apAlive() { return this.fcAlive && this.counts.great + this.counts.good === 0; }
  get multiplier() { return 1 + Math.floor(Math.min(this.combo, COMBO_MULT_CAP) / 10) * 0.1; }

  // ---- ticks (backing pulse, including the lead-in count-in, only when enabled) ----
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
      if (t >= ctx.currentTime - 0.005 && this.backing) {
        this.synth.tick({ when: t, accent: ((this.nextBeat % 4) + 4) % 4 === 0 });
      }
      this.nextBeat++;
    }
    for (let i = this.rollQueue.length - 1; i >= 0; i--) { // started rolls: play the real notes
      const q = this.rollQueue[i], when = this.songStart + q.time;
      if (when >= horizon) continue;
      this.rollQueue.splice(i, 1);
      if (when >= ctx.currentTime - 0.005) this.synth.playNote({ midi: q.midi, when, duration: q.duration });
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
    this.now = t;
    this.log.push([t, lane]);
    const list = this.byLane[lane];
    let i = this.lanePtr[lane];
    while (i < list.length && list[i].judged) i++;
    this.lanePtr[lane] = i;
    let best = null, bestAbs = Infinity, roll = null, rollAbs = Infinity;
    for (; i < list.length && list[i].time <= t + this.reach; i++) {
      const n = list[i];
      if (n.judged) continue;
      if (n.isRoll) { // a roll takes every press from its window opening until its last tick has passed
        if (t <= n.time + n.duration) { roll = n; rollAbs = Math.max(0, n.time - t); }
        continue;
      }
      const d = Math.abs(t - n.time);
      if (d < bestAbs && d <= this._windowOf(n)) { best = n; bestAbs = d; }
    }
    if (roll && rollAbs <= bestAbs) { this._rollHit(roll); return; }
    if (!best) { // ghost tap: no score effect, but breaks FC until the last note is played
      // Warm-up taps before the first note can be reached are ignored.
      const first = this.chart.notes[0];
      const early = this.judgedCount === 0 && first && t < first.time - this.reach;
      if (this.notesLeft > 0 && !early) {
        this.strays++; this.combo = 0;
        this.synth.playStray?.(lane);
        if (this.suddenDeath) this._fail();
      }
      return;
    }
    const j = bestAbs <= this.win.perfect ? 'perfect' : bestAbs <= this.win.great ? 'great' : 'good'; // slides: wide hits are Good
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
    this.now = t;
    this.log.push([t, lane + 8]);
    if (n.voice) n.voice.release(this.synth.ctx.currentTime);
    if (t >= n.time + n.duration - HOLD_RELEASE_FORGIVE) this._completeHold(n);
    else this._breakHold(n);
  }

  // Per-frame: auto-misses, hold completion, end of song. `t` = songTime().
  update(t) {
    if (this.state !== 'running') return;
    this.now = t;
    const mark = this.judgedCount + this.score; // both only grow: a change means this update counted
    for (let lane = 0; lane < this.byLane.length; lane++) {
      const list = this.byLane[lane];
      let i = this.lanePtr[lane];
      while (i < list.length) {
        const n = list[i];
        if (n.judged) { i++; continue; }
        if (n.isRoll) { // resolves once its last tick has passed
          if (t <= n.time + n.duration) break;
          this._finishRoll(n);
          if (this.state !== 'running') return;
        } else if (n.time + this._windowOf(n) < t) { this._miss(n, true); if (this.state !== 'running') return; }
        else break;
        i++;
      }
      this.lanePtr[lane] = i;
      const h = this.holds[lane];
      if (h && t >= h.time + h.duration) this._completeHold(h); // still held at the end
    }
    const end = t > this.chart.length + END_PADDING;
    if (end || this.judgedCount + this.score !== mark) this.log.push([t, -1]);
    if (end) {
      this.state = 'done';
      clearInterval(this.timer);
      this.onFinish(this.results());
    }
  }

  _rollHit(n) {
    n.hit = true;
    n.rollHits++;
    this.score += Math.round(ROLL_TICK_POINTS * this.multiplier);
    if (!this.rollAudio) { this.synth.playNote({ midi: n.midi, when: this.synth.ctx.currentTime, duration: 0.1 }); return; }
    if (n.rollHits !== 1) return; // the first press plays the roll as written; mashing only scores
    const dur = n.tickDur ?? 0.1; // never leave the duration open: an unbounded voice would sustain forever
    this.synth.playNote({ midi: n.midi, when: this.synth.ctx.currentTime, duration: dur }); // first tick sounds right away
    n.ticks.slice(1).forEach(o => this.rollQueue.push({ time: n.time + o, midi: n.midi, duration: dur }));
    this._schedule();
  }

  _finishRoll(n) {
    const share = n.rollHits / n.goal;
    const grade = ROLL_GRADES.find(([min]) => share >= min);
    n.done = true;
    if (grade) this._judge(n, grade[1]);
    else this._miss(n, true);
  }

  _judge(n, j) {
    n.judged = true; n.judgement = j;
    this.notesLeft--;
    this.counts[j]++;
    this.judgedCount++;
    this.accSum += ACCURACY_WEIGHT[j];
    this.events.push([n.time, ACCURACY_WEIGHT[j]]);
    this.score += Math.round(POINTS[j] * this.multiplier);
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.fx.judge(n.lane, j);
  }

  _miss(n, headMissed) {
    if (headMissed) { n.judged = true; n.judgement = 'miss'; this.notesLeft--; }
    this.counts.miss++;
    this.judgedCount++;
    this.events.push([n.time, 0]);
    this.combo = 0;
    this.synth.playMiss(n.midi);
    this.fx.judge(n.lane, 'miss');
    if (this.suddenDeath) this._fail();
  }

  // Sudden Death: the first miss, dropped hold or stray press ends the run.
  _fail() {
    if (this.failed || this.state !== 'running') return;
    this.failed = true;
    this.state = 'done';
    clearInterval(this.timer);
    this.timer = null;
    this.synth.stopAll();
    this.onFinish(this.results());
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
    this.synth.wantRunning = false;
    this.synth.ctx.suspend(); // currentTime stops, so the timing model stays correct
  }

  async resume() {
    if (this.state !== 'paused') return;
    this.synth.wantRunning = true;
    // Safari can leave this promise pending after an interruption; don't let it freeze the game
    await Promise.race([this.synth.ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, 500))]);
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
      const c = this.synth.ctx;
      this.synth.wantRunning = true;
      if (this.state === 'paused' || (c.state && c.state !== 'running')) c.resume().catch(() => {});
    }
    this.state = 'idle';
    this.active = false;
  }

  results() {
    const total = this.chart.notes.length;
    // Full combo: every note was hit (holds that were dropped count as misses).
    const fc = this.counts.miss === 0 && this.strays === 0 && this.judgedCount >= total;
    return {
      score: this.score, maxCombo: this.maxCombo, counts: { ...this.counts },
      accuracy: this.accuracy, grade: this.grade, ghosts: this.strays,
      fc, ap: fc && this.counts.great + this.counts.good === 0,
      deltas: this.deltas.slice(), failed: this.failed,
      timeline: { length: this.chart.length, noteTimes: this.chart.notes.map(n => n.time), events: this.events.slice() },
    };
  }
}
