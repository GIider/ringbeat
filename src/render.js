// Canvas rendering: highway, notes, hit effects, HUD. Visual-only; never used for judging.

const FONT = 'ui-monospace, Menlo, Consolas, "Courier New", monospace';
const C = {
  bg: '#0b0b1a', laneA: '#13132b', laneB: '#0f0f23', sep: '#2a2a55', line: '#ffffff',
  text: '#e8e8ff', dim: '#4a4a70', ghost: '#3a3a5a',
};
const LANE_COLORS = {
  3: ['#ff4d8d', '#ffd23f', '#3be8d0'],
  4: ['#ff4d8d', '#ffd23f', '#3be8d0', '#5aa9ff'],
};
const JUDGE_COLORS = { perfect: '#ffe14d', great: '#4dffb0', good: '#4dc8ff', miss: '#ff4d6d' };
const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES = Array.from({ length: 128 }, (_, m) => NAMES[m % 12] + (Math.floor(m / 12) - 1));
const noteName = m => NOTE_NAMES[m] || NAMES[m % 12] + (Math.floor(m / 12) - 1);
const F = {
  note: `bold 11px ${FONT}`, judge: `bold 14px ${FONT}`, key: `bold 16px ${FONT}`,
  title: `bold 14px ${FONT}`, score: `bold 20px ${FONT}`, acc: `12px ${FONT}`,
  combo: `bold 40px ${FONT}`, comboLbl: `bold 12px ${FONT}`, count: `bold 48px ${FONT}`,
  resume: `bold 96px ${FONT}`, ready: `bold 20px ${FONT}`,
};
const GLOW_H = 220;

const HIT_Y = 0.85;       // hit line, fraction of canvas height
const RING_POOL = 12, LABEL_POOL = 8;

function rrect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.lanes = 4;
    this.scrollTime = 1.6;
    this.keyLabels = [];
    this.title = '';
    this.trainingLabel = '';
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.flash = new Float64Array(4).fill(-10);
    // Fixed pools -> no per-frame/per-hit allocations
    this.rings = Array.from({ length: RING_POOL }, () => ({ t: -10, lane: 0, color: '#fff' }));
    this.labels = Array.from({ length: LABEL_POOL }, () => ({ t: -10, lane: 0, text: '', color: '#fff' }));
    this.ringI = 0; this.labelI = 0;
    this.vi = 0;
    this.lastCombo = 0; this.pulseT = -10;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // fx hooks handed to the game
    this.fx = {
      press: lane => { this.flash[lane] = performance.now() / 1000; },
      judge: (lane, j) => {
        const now = performance.now() / 1000;
        const r = this.rings[this.ringI++ % RING_POOL];
        r.t = now; r.lane = lane; r.color = JUDGE_COLORS[j];
        const l = this.labels[this.labelI++ % LABEL_POOL];
        l.t = now; l.lane = lane; l.text = JUDGE_TEXT[j]; l.color = JUDGE_COLORS[j];
      },
    };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._layout();
  }

  setLanes(n, keyLabels) {
    this.lanes = n;
    this.keyLabels = keyLabels || [];
    this._staticDirty = true;
    this.flash = new Float64Array(n).fill(-10);
    this._layout();
  }

  resetState() { this.vi = 0; this.lastCombo = 0; this.rings.forEach(r => r.t = -10); this.labels.forEach(l => l.t = -10); }

  _layout() {
    this.laneW = Math.min(this.w / this.lanes, 120);
    this.x0 = (this.w - this.laneW * this.lanes) / 2;
    this.hitY = this.h * HIT_Y;
    // One glow gradient per lane, drawn at origin (translated into place per use).
    const colors = LANE_COLORS[this.lanes] || LANE_COLORS[4];
    this.glow = colors.slice(0, this.lanes).map(col => {
      const g = this.c.createLinearGradient(0, -GLOW_H, 0, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col);
      return g;
    });
    this._staticDirty = true;
    this._idleDone = false;
  }

  // Lanes, separators, hit line and key labels never change between frames: paint them once.
  _buildStatic() {
    this._staticDirty = false;
    this.staticLayer = null;
    if (typeof document === 'undefined' || !(this.w > 0 && this.h > 0)) return;
    const dpr = this.canvas.width / this.w;
    // A DOM canvas (not OffscreenCanvas) so the layer stays GPU-backed and blits without a per-frame upload.
    const layer = document.createElement('canvas');
    layer.width = this.canvas.width; layer.height = this.canvas.height;
    const c = layer.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paintStatic(c);
    this.staticLayer = layer;
  }

  _paintStatic(c) {
    const n = this.lanes, lw = this.laneW, x0 = this.x0, H = this.h, hitY = this.hitY;
    c.fillStyle = C.bg; c.fillRect(0, 0, this.w, H);
    for (let i = 0; i < n; i++) {
      c.fillStyle = i % 2 ? C.laneA : C.laneB;
      c.fillRect(x0 + i * lw, 0, lw, H);
    }
    c.fillStyle = C.sep;
    for (let i = 0; i <= n; i++) c.fillRect(x0 + i * lw - 1, 0, 2, H);
    c.fillStyle = C.line;
    c.fillRect(x0, hitY - 2, lw * n, 4);
    c.fillStyle = C.dim; c.font = F.key;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      if (this.keyLabels[i]) c.fillText(this.keyLabels[i], x0 + (i + 0.5) * lw, hitY + 30);
    }
  }

  // Map a client X to a lane (used by pointer input).
  laneAt(clientX) {
    const x = clientX - this.canvas.getBoundingClientRect().left;
    return Math.max(0, Math.min(this.lanes - 1, Math.floor((x - this.x0) / this.laneW)));
  }

  drawIdle() {
    if (this._idleDone) return; // nothing changes while idle; repaint only after a resize or a game frame
    this._idleDone = true;
    const c = this.c;
    c.fillStyle = C.bg; c.fillRect(0, 0, this.w, this.h);
  }

  draw(game, t) {
    const c = this.c, W = this.w, H = this.h, n = this.lanes;
    const lw = this.laneW, x0 = this.x0, hitY = this.hitY;
    const pps = hitY / this.scrollTime;
    const now = performance.now() / 1000;
    const colors = LANE_COLORS[n] || LANE_COLORS[4];

    this._idleDone = false;
    if (this._staticDirty) this._buildStatic();
    if (this.staticLayer) {
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.staticLayer, 0, 0);
      c.restore();
    } else this._paintStatic(c);

    // Flashes + active-hold glow
    for (let i = 0; i < n; i++) {
      const age = now - this.flash[i];
      const held = game.holds && game.holds[i];
      if (held || age < 0.15) {
        c.globalAlpha = held ? 0.22 : 0.3 * (1 - age / 0.15);
        c.save();
        c.translate(x0 + i * lw, hitY);
        c.fillStyle = this.glow[i];
        c.fillRect(0, -GLOW_H, lw, GLOW_H);
        c.restore();
        c.globalAlpha = 1;
      }
    }

    // Notes: sorted by time, so only walk the visible slice.
    const notes = game.chart.notes;
    const below = (H - hitY) / pps + 0.1;
    while (this.vi < notes.length && notes[this.vi].time + notes[this.vi].duration < t - below) this.vi++;
    const bw = lw - 12, bh = Math.max(18, Math.min(28, lw * 0.3));
    c.font = F.note;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = this.vi; i < notes.length; i++) {
      const nt = notes[i];
      if (nt.time > t + this.scrollTime + 0.1) break;
      if (nt.done || (nt.hit && !nt.isHold)) continue;
      const missed = nt.judgement === 'miss' || nt.broken;
      const color = missed ? C.ghost : colors[nt.lane];
      const x = x0 + nt.lane * lw + 6;
      const yHead = nt.holding ? hitY : hitY - (nt.time - t) * pps;
      if (nt.isHold) {
        const yTop = hitY - (nt.time + nt.duration - t) * pps;
        const tw = bw * 0.5;
        c.globalAlpha = nt.holding ? 1 : missed ? 0.5 : 0.55;
        c.fillStyle = color;
        rrect(c, x + (bw - tw) / 2, yTop, tw, Math.max(0, yHead - yTop), 6);
        c.fill();
        c.globalAlpha = 1;
      }
      c.fillStyle = color;
      rrect(c, x, yHead - bh / 2, bw, bh, 7);
      c.fill();
      c.fillStyle = missed ? C.dim : '#0b0b1a';
      c.fillText(noteName(nt.midi), x + bw / 2, yHead + 1);
    }

    // Rings
    for (const r of this.rings) {
      const age = now - r.t;
      if (age > 0.35 || age < 0) continue;
      const k = age / 0.35;
      c.globalAlpha = 1 - k;
      c.strokeStyle = r.color; c.lineWidth = 3;
      const rad = this.reduced ? lw * 0.35 : lw * (0.25 + 0.45 * k);
      c.beginPath();
      c.arc(x0 + (r.lane + 0.5) * lw, hitY, rad, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;

    // Judgement labels
    c.font = F.judge;
    for (const l of this.labels) {
      const age = now - l.t;
      if (age > 0.6 || age < 0) continue;
      c.globalAlpha = 1 - age / 0.6;
      c.fillStyle = l.color;
      const rise = this.reduced ? 0 : age * 40;
      c.fillText(l.text, x0 + (l.lane + 0.5) * lw, hitY - 40 - rise);
    }
    c.globalAlpha = 1;

    this._hud(game, t, now);
  }

  _hud(game, t, now) {
    const c = this.c, W = this.w, H = this.h;
    // Progress bar
    const p = Math.max(0, Math.min(1, t / game.chart.length));
    c.fillStyle = C.sep; c.fillRect(0, 0, W, 4);
    c.fillStyle = '#3be8d0'; c.fillRect(0, 0, W * p, 4);

    c.textBaseline = 'top';
    c.fillStyle = C.text; c.textAlign = 'center'; c.font = F.title;
    c.fillText(this.title, W / 2, 14);
    if (game.score !== this._score) { this._score = game.score; this._scoreTxt = String(game.score).padStart(7, '0'); }
    const acc = game.accuracy;
    if (acc !== this._acc) { this._acc = acc; this._accTxt = acc.toFixed(1) + '%'; }
    c.textAlign = 'right'; c.font = F.score;
    c.fillText(this._scoreTxt, W - 12, 40);
    c.font = F.acc; c.fillStyle = C.dim;
    c.fillText(this._accTxt, W - 12, 66);

    // Combo with punch on increments
    if (game.combo !== this.lastCombo) {
      if (game.combo > this.lastCombo) this.pulseT = now;
      this.lastCombo = game.combo;
    }
    if (game.combo > 1) {
      const age = now - this.pulseT;
      const s = this.reduced ? 1 : 1 + Math.max(0, 1 - age / 0.12) * 0.35;
      c.save();
      c.translate(W / 2, H * 0.3);
      c.scale(s, s);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.globalAlpha = 0.9;
      c.fillStyle = C.text; c.font = F.combo;
      c.fillText(String(game.combo), 0, 0);
      c.font = F.comboLbl; c.fillStyle = C.dim;
      c.fillText('COMBO', 0, 30);
      c.restore();
    }

    // Full-combo streak badge (disappears at the first miss) and training label
    c.textAlign = 'left'; c.textBaseline = 'top';
    if (this.trainingLabel) {
      c.fillStyle = C.dim; c.font = F.comboLbl;
      c.fillText(this.trainingLabel, 12, 48);
    }
    if (game.fcAlive && game.judgedCount >= 5) {
      c.font = F.title;
      c.fillStyle = game.apAlive ? '#ffe14d' : '#3be8d0';
      c.fillText(game.apAlive ? 'ALL PERFECT' : 'FULL COMBO', 12, 66);
    }

    // Timing meter: recent hit offsets (left = early, right = late)
    const mw = Math.min(220, W * 0.6), mx = W / 2, my = this.hitY + 52;
    if (my < H - 6) {
      c.fillStyle = C.sep; c.fillRect(mx - mw / 2, my - 1, mw, 2);
      c.fillStyle = C.text; c.fillRect(mx - 1, my - 7, 2, 14);
      const ds = game.deltas, n = Math.min(ds.length, 16);
      for (let i = 0; i < n; i++) {
        const d = ds[ds.length - 1 - i];
        const x = mx + Math.max(-1, Math.min(1, d / 0.135)) * mw / 2;
        c.globalAlpha = 1 - i / 18;
        c.fillStyle = Math.abs(d) <= 0.045 ? JUDGE_COLORS.perfect : Math.abs(d) <= 0.09 ? JUDGE_COLORS.great : JUDGE_COLORS.good;
        c.fillRect(x - 1.5, my - 9, 3, 18);
      }
      c.globalAlpha = 1;
    }

    // Count-in
    if (t < 0) {
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = C.text; c.font = F.count;
      c.fillText(String(Math.ceil(-t)), W / 2, H * 0.5);
    }
    // Resume countdown (song time is frozen while this shows)
    if (this.resumeCount > 0) {
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 0, W, H);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = C.text; c.font = F.resume;
      c.fillText(String(this.resumeCount), W / 2, H * 0.5);
      c.font = F.ready;
      c.fillText('GET READY', W / 2, H * 0.5 - 80);
    }
    c.globalAlpha = 1;
  }
}
