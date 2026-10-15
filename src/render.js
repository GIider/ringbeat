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
const GRADE_COLORS = { S: '#ffe14d', A: '#4dffb0', B: '#4dc8ff', C: '#ffa94d', D: '#ff4d6d' };
const PANEL_MIN = 190;     // min side-panel width (px) before falling back to the compact layout
const BANNER_POOL = 3;
const mmss = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

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
    this.banners = Array.from({ length: BANNER_POOL }, () => ({ t: -10, text: '', color: '#fff' }));
    this.bannerI = 0;
    this.mode = 'compact';
    this.resetState();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
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

  resetState() {
    this.vi = 0; this.lastCombo = 0;
    this.rings.forEach(r => r.t = -10); this.labels.forEach(l => l.t = -10); this.banners.forEach(b => b.t = -10);
    this._dispScore = 0; this._shownScore = -1; this._lastNow = 0;
    this._halfDone = this._lastTenDone = false; this._lastMilestone = 0;
  }

  _banner(text, color, now) {
    const b = this.banners[this.bannerI++ % BANNER_POOL];
    b.t = now; b.text = text; b.color = color;
  }

  _layout() {
    this.laneW = Math.min(this.w / this.lanes, 120);
    this.x0 = (this.w - this.laneW * this.lanes) / 2;
    this.hitY = this.h * HIT_Y;
    // Wide screens get a panel on each side of the highway; narrow ones a slim strip on top.
    this.mode = this.x0 >= PANEL_MIN ? 'wide' : 'compact';
    this.panelW = this.x0;
    this.rx = this.x0 + this.laneW * this.lanes; // left edge of the right panel
    const k = Math.min(1, Math.max(0.7, this.h / 720));
    const pf = Math.max(24, Math.min(44, Math.floor((this.panelW - 36) / 7 / 0.62)));
    this.fp = {
      score: `bold ${pf}px ${FONT}`, combo: `bold ${Math.round(72 * k)}px ${FONT}`,
      left: `bold ${Math.round(40 * k)}px ${FONT}`, title: `bold 20px ${FONT}`,
      grade: `bold 36px ${FONT}`, lbl: `bold 11px ${FONT}`, small: `12px ${FONT}`,
      cs: `bold 28px ${FONT}`, ss: `bold 26px ${FONT}`,
    };
    this._titleLines = null;
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
    if (this.mode === 'wide') this._paintPanels(c);
  }

  // Static side-panel chrome: backgrounds, dividers and captions that never change.
  _paintPanels(c) {
    const H = this.h, pw = this.panelW, rx = this.rx, p = 20, f = this.fp;
    c.fillStyle = '#0e0e22'; c.fillRect(0, 0, pw, H); c.fillRect(rx, 0, pw, H);
    c.fillStyle = C.sep; c.fillRect(pw - 2, 0, 2, H); c.fillRect(rx, 0, 2, H);
    c.font = f.lbl; c.fillStyle = C.dim; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('SCORE', rx + p, 20);
    c.fillText('ACCURACY', rx + p, 112);
    c.fillText('NOTES LEFT', rx + p, H * 0.64);
    c.fillText('JUDGEMENTS', rx + p, H - 70);
    c.textAlign = 'right';
    c.fillText('PROGRESS', this.x0 - 28, Math.round(H * 0.3) - 20);
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

  _mixBar(c, game, x, y, w, h) {
    c.fillStyle = C.sep; c.fillRect(x, y, w, h);
    const n = game.judgedCount;
    if (!n) return;
    const keys = ['perfect', 'great', 'good', 'miss'];
    let cx = x;
    for (const k of keys) {
      const sw = w * game.counts[k] / n;
      if (sw <= 0) continue;
      c.fillStyle = JUDGE_COLORS[k]; c.fillRect(cx, y, sw, h);
      cx += sw;
    }
  }

  _titleFit(maxW) {
    if (this._titleLines && this._titleKey === this.title + '|' + maxW) return this._titleLines;
    this._titleKey = this.title + '|' + maxW;
    const c = this.c, words = String(this.title).split(' '), lines = [''];
    c.font = this.fp.title;
    for (const w of words) {
      const cur = lines[lines.length - 1], test = cur ? cur + ' ' + w : w;
      if (!cur || typeof c.measureText !== 'function' || c.measureText(test).width <= maxW) lines[lines.length - 1] = test;
      else if (lines.length < 3) lines.push(w);
      else lines[2] = test;
    }
    return (this._titleLines = lines);
  }

  _hud(game, t, now) {
    const c = this.c, W = this.w, H = this.h, f = this.fp, wide = this.mode === 'wide';
    const total = game.chart.notes.length;
    const p = Math.max(0, Math.min(1, t / game.chart.length));
    const dt = Math.min(0.1, Math.max(0, now - (this._lastNow || now)));
    this._lastNow = now;

    // Score counts up toward the real value; strings are rebuilt only when the integer changes.
    this._dispScore += (game.score - this._dispScore) * Math.min(1, dt * 14);
    if (Math.abs(game.score - this._dispScore) < 1) this._dispScore = game.score;
    const shown = Math.round(this._dispScore);
    if (shown !== this._shownScore) { this._shownScore = shown; this._scoreTxt = String(shown).padStart(7, '0'); }
    const acc = game.accuracy;
    if (acc !== this._acc) { this._acc = acc; this._accTxt = acc.toFixed(1) + '%'; }
    const left = game.notesLeft;
    if (left !== this._left) { this._left = left; this._leftTxt = String(left); this._totTxt = '/ ' + total; }
    const cmb = game.combo;
    if (cmb !== this.lastCombo) {
      if (cmb > this.lastCombo) {
        this.pulseT = now;
        if (cmb >= 50 && cmb % 50 === 0) this._banner(cmb + ' COMBO', '#ffe14d', now);
      }
      this.lastCombo = cmb;
    }
    if (!this._halfDone && p >= 0.5) { this._halfDone = true; this._banner('HALFWAY', '#3be8d0', now); }
    if (!this._lastTenDone && total > 20 && left <= 10 && left > 0) { this._lastTenDone = true; this._banner('LAST 10 NOTES', '#ff4d8d', now); }
    const tier = cmb >= 100 ? '#ff4d8d' : cmb >= 50 ? '#ffe14d' : cmb >= 25 ? '#3be8d0' : C.text;
    const s = this.reduced ? 1 : 1 + Math.max(0, 1 - (now - this.pulseT) / 0.12) * 0.3;

    c.textBaseline = 'top';
    if (wide) {
      const pw = this.panelW, rx = this.rx, pad = 20;
      // Left: title, streak badge, training label, vertical progress column
      c.textAlign = 'left'; c.fillStyle = C.text; c.font = f.title;
      const lines = this._titleFit(pw - pad * 2);
      for (let i = 0; i < lines.length; i++) c.fillText(lines[i], pad, 56 + i * 24);
      let y = 56 + lines.length * 24 + 8;
      if (this.trainingLabel) { c.fillStyle = C.dim; c.font = f.lbl; c.fillText(this.trainingLabel, pad, y); y += 18; }
      if (game.fcAlive && game.judgedCount >= 5) {
        c.font = F.title; c.fillStyle = game.apAlive ? '#ffe14d' : '#3be8d0';
        c.fillText(game.apAlive ? 'ALL PERFECT' : 'FULL COMBO', pad, y);
      }
      // Progress rail hugs the lane edge so it can be read while watching the notes
      const bw = 12, bx = this.x0 - 8 - bw, top = 16, bot = H - 16, bh = bot - top, tx = bx - 12;
      c.fillStyle = C.sep; c.fillRect(bx, top, bw, bh);
      c.fillStyle = '#3be8d0'; c.fillRect(bx, bot - bh * p, bw, bh * p);
      c.fillStyle = C.line;
      for (let q = 1; q < 4; q++) c.fillRect(bx - 3, top + bh * q / 4 - 1, bw + 6, 2);
      const ty = Math.round(H * 0.3);
      c.textAlign = 'right';
      c.font = f.cs; c.fillStyle = C.text;
      c.fillText(Math.round(p * 100) + '%', tx, ty);
      c.font = f.small; c.fillStyle = C.dim;
      c.fillText(mmss(Math.max(0, t)) + ' / ' + mmss(game.chart.length), tx, ty + 34);
      c.fillText('-' + mmss(Math.max(0, game.chart.length - t)), tx, ty + 54);
      c.textAlign = 'left';

      // Right: score, accuracy + grade, combo, notes left, judgement mix
      const rp = rx + pad;
      c.fillStyle = C.text; c.font = f.score; c.fillText(this._scoreTxt, rp, 36);
      c.font = f.cs; c.fillText(this._accTxt, rp, 128);
      c.font = f.grade; c.fillStyle = GRADE_COLORS[game.grade];
      c.textAlign = 'right'; c.fillText(game.grade, rx + pw - pad, 120);
      c.textAlign = 'left';
      if (cmb > 1) {
        c.save();
        c.translate(rp, H * 0.34 + 40); c.scale(s, s);
        c.fillStyle = tier; c.font = f.combo; c.textBaseline = 'middle';
        c.fillText(String(cmb), 0, 0);
        c.restore();
        c.textBaseline = 'top';
        c.font = f.lbl; c.fillStyle = C.dim;
        c.fillText('COMBO  x' + game.multiplier.toFixed(1), rp, H * 0.34 + 84);
      }
      c.fillStyle = C.text; c.font = f.left; c.fillText(this._leftTxt, rp, H * 0.64 + 18);
      c.font = f.small; c.fillStyle = C.dim;
      c.fillText(this._totTxt, rp, H * 0.64 + 18 + Math.round(f.left.match(/\d+/)[0]) + 6);
      this._mixBar(c, game, rp, H - 50, pw - pad * 2, 12);
    } else {
      // Compact: slim strip on top, progress bar along the bottom edge
      c.fillStyle = 'rgba(11,11,26,0.78)'; c.fillRect(0, 0, W, 64);
      c.textAlign = 'center'; c.fillStyle = C.text; c.font = F.title;
      c.fillText(this.title, W / 2, 10);
      c.textAlign = 'right'; c.font = f.cs; c.fillText(this._scoreTxt, W - 12, 8);
      c.font = F.acc; c.fillStyle = C.dim;
      c.fillText(this._accTxt + '  ' + game.grade, W - 12, 40);
      c.textAlign = 'left';
      c.font = F.title; c.fillStyle = C.text;
      c.fillText(this._leftTxt + ' ' + this._totTxt, 56, 40);
      if (this.trainingLabel) { c.fillStyle = C.dim; c.font = F.comboLbl; c.fillText(this.trainingLabel, 56, 12); }
      if (game.fcAlive && game.judgedCount >= 5) {
        c.font = F.comboLbl; c.fillStyle = game.apAlive ? '#ffe14d' : '#3be8d0';
        c.fillText(game.apAlive ? 'ALL PERFECT' : 'FULL COMBO', 56, 26);
      }
      c.fillStyle = C.sep; c.fillRect(0, H - 10, W, 10);
      c.fillStyle = '#3be8d0'; c.fillRect(0, H - 10, W * p, 10);
      if (cmb > 1) {
        c.save();
        c.translate(W / 2, H * 0.3); c.scale(s, s);
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.globalAlpha = 0.9;
        c.fillStyle = tier; c.font = F.combo;
        c.fillText(String(cmb), 0, 0);
        c.font = F.comboLbl; c.fillStyle = C.dim;
        c.fillText('COMBO', 0, 30);
        c.restore();
      }
    }

    // Milestone banners over the highway
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const bx = this.x0 + this.laneW * this.lanes / 2;
    for (const b of this.banners) {
      const age = now - b.t;
      if (age > 1.4 || age < 0) continue;
      c.globalAlpha = Math.min(1, (1.4 - age) / 0.5);
      c.fillStyle = b.color; c.font = f.ss;
      c.fillText(b.text, bx, H * 0.45 - (this.reduced ? 0 : age * 20));
    }
    c.globalAlpha = 1;

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
