// Canvas rendering: highway, notes, hit effects, HUD. Visual-only; never used for judging.
// Look: a backlit phone LCD at night — dark green field, pale-green note pills, a lime hit line.
// Progress, time and the song title live on the phones around the canvas (main.js), except in the compact layout.

const FONT = '"RB Pixel", ui-monospace, Menlo, Consolas, monospace';
const C = {
  bg: '#0a1308', field: '#0d180b', lane: '#2a4320', laneHi: '#3d5f2c', line: '#c9ff5a', text: '#b9e07c',
  dim: '#6f9a4a', faint: '#3d5a2c', ink: '#10200b', ghost: '#263a1d', ghostText: '#4d6b3a', box: '#5b8640',
};
// Notes brighten as they approach the line: far, mid, near.
const NOTE = [
  { fill: '#557d3d', edge: '#77a356', text: '#0d1a09' },
  { fill: '#8fbc61', edge: '#b4dc84', text: '#0f1e0a' },
  { fill: '#dcfb88', edge: '#f4ffc8', text: '#132408' },
];
const JUDGE_COLORS = { perfect: '#e4ff8c', great: '#b4e276', good: '#86b35c', miss: '#5c7a48' };
const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const GRADE_COLORS = { S: '#e4ff8c', A: '#c3ea86', B: '#9fcc6c', C: '#7fa95a', D: '#5c7a48' };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES = Array.from({ length: 128 }, (_, m) => NAMES[m % 12] + (Math.floor(m / 12) - 1));
const noteName = m => NOTE_NAMES[m] || NAMES[m % 12] + (Math.floor(m / 12) - 1);
// Pixel font sizes are multiples of 10px so every font pixel lands on whole CSS pixels.
const px = (n, bold = true) => `${bold ? 'bold ' : ''}${n}px ${FONT}`;
const GLOW_H = 220;
const HUD_MIN = 200;       // narrowest HUD column; below this (plus lanes) we fall back to the compact layout
const LANE_MIN = 56;
const BANNER_POOL = 3;

const HIT_Y = 0.8;        // hit line, fraction of canvas height
const RING_POOL = 12, LABEL_POOL = 8;

function rrect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h));
  return cv;
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
    this.resumeCount = 0;
    this.reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    this.flash = new Float64Array(4).fill(-10);
    // Fixed pools -> no per-frame/per-hit allocations
    this.rings = Array.from({ length: RING_POOL }, () => ({ t: -10, lane: 0, color: '#fff', big: false }));
    this.labels = Array.from({ length: LABEL_POOL }, () => ({ t: -10, lane: 0, text: '', color: '#fff' }));
    this.ringI = 0; this.labelI = 0;
    this.vi = 0;
    this.lastCombo = 0; this.pulseT = -10;
    this.banners = Array.from({ length: BANNER_POOL }, () => ({ t: -10, text: '', color: '#fff' }));
    this.bannerI = 0;
    this.mode = 'compact';
    this.resetState();
    this.resize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => this.resize());
    }
    // The canvas also changes size when the phone moves between menu and play layouts.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        if (canvas.clientWidth !== this.w || canvas.clientHeight !== this.h) this.resize();
      }).observe(canvas);
    }
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.load(px(20, false)); document.fonts.load(px(20));
      document.fonts.addEventListener('loadingdone', () => { this._staticDirty = true; this._idleDone = false; });
    }
    // fx hooks handed to the game
    this.fx = {
      press: lane => { this.flash[lane] = performance.now() / 1000; },
      judge: (lane, j) => {
        const now = performance.now() / 1000;
        if (j !== 'miss') {
          const r = this.rings[this.ringI++ % RING_POOL];
          r.t = now; r.lane = lane; r.color = JUDGE_COLORS[j]; r.big = j === 'perfect';
        }
        const l = this.labels[this.labelI++ % LABEL_POOL];
        l.t = now; l.lane = lane; l.text = JUDGE_TEXT[j]; l.color = JUDGE_COLORS[j];
      },
    };
  }

  resize() {
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
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
    this._halfDone = this._lastTenDone = false;
  }

  _banner(text, color, now) {
    const b = this.banners[this.bannerI++ % BANNER_POOL];
    b.t = now; b.text = text; b.color = color;
  }

  _layout() {
    const W = this.w, H = this.h, n = this.lanes;
    const hudW = Math.round(Math.max(HUD_MIN, Math.min(300, W * 0.3)));
    this.mode = W - hudW >= n * LANE_MIN + 24 ? 'wide' : 'compact';
    if (this.mode === 'wide') {
      this.hudW = hudW;
      this.laneW = Math.floor(Math.min((W - hudW - 24) / n, 120));
      this.x0 = Math.round((W - hudW - this.laneW * n) / 2);
      this.hx = W - hudW + 8;                   // HUD column text x
    } else {
      this.hudW = 0;
      this.laneW = Math.floor(Math.min(W / n, 110));
      this.x0 = Math.round((W - this.laneW * n) / 2);
      this.hx = 0;
    }
    this.hitY = Math.round(H * HIT_Y);
    this.recY = this.hitY + 18;                 // receptor boxes
    this.recH = Math.max(0, Math.min(84, H - this.recY - (this.mode === 'wide' ? 12 : 40)));
    const big = this.hudW >= 236;
    this.fp = {
      score: px(big ? 40 : 30), acc: px(30), lbl: px(20), small: px(20, false), left: px(40), grade: px(40),
      combo: px(H >= 640 ? 60 : 40), banner: px(30), note: px(20), judge: px(20), key: px(20), count: px(60),
      resume: px(80), title: px(20),
    };
    this.fpScoreH = big ? 40 : 30;
    // Pre-rendered glow sprites (one per lane width), drawn with globalAlpha.
    const lw = this.laneW;
    this.glow = null; this.burst = null; this.halo = null;
    if (this.c.createLinearGradient) {
      const g = this.c.createLinearGradient(0, -GLOW_H, 0, 0);
      g.addColorStop(0, 'rgba(201,255,90,0)'); g.addColorStop(1, 'rgba(201,255,90,0.85)');
      this.glow = g;
    }
    const bs = Math.ceil(lw * 1.8);
    const burst = makeCanvas(bs, bs);
    if (burst) {
      const b = burst.getContext('2d'), r = bs / 2;
      const rg = b.createRadialGradient(r, r, 0, r, r, r);
      rg.addColorStop(0, 'rgba(240,255,190,0.95)'); rg.addColorStop(0.25, 'rgba(201,255,90,0.7)');
      rg.addColorStop(0.6, 'rgba(140,210,60,0.18)'); rg.addColorStop(1, 'rgba(140,210,60,0)');
      b.fillStyle = rg; b.fillRect(0, 0, bs, bs);
      b.strokeStyle = 'rgba(220,255,150,0.55)'; b.lineWidth = 2;
      for (let i = 0; i < 12; i++) { // sparkle rays
        const a = i / 12 * Math.PI * 2, r0 = r * (i % 2 ? 0.35 : 0.3), r1 = r * (i % 2 ? 0.62 : 0.9);
        b.beginPath(); b.moveTo(r + Math.cos(a) * r0, r + Math.sin(a) * r0); b.lineTo(r + Math.cos(a) * r1, r + Math.sin(a) * r1); b.stroke();
      }
      this.burst = burst;
    }
    const hw = Math.ceil(lw * 1.1), hh = 70;
    const halo = makeCanvas(hw, hh);
    if (halo) {
      const h = halo.getContext('2d');
      const rg = h.createRadialGradient(hw / 2, hh / 2, 4, hw / 2, hh / 2, hw / 2);
      rg.addColorStop(0, 'rgba(220,255,140,0.45)'); rg.addColorStop(1, 'rgba(220,255,140,0)');
      h.fillStyle = rg; h.fillRect(0, 0, hw, hh);
      this.halo = halo;
    }
    this._titleLines = null;
    this._staticDirty = true;
    this._idleDone = false;
  }

  // Field, lanes, hit line, receptors and HUD captions never change between frames: paint them once.
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
    const n = this.lanes, lw = this.laneW, x0 = this.x0, W = this.w, H = this.h, hitY = this.hitY;
    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    // lanes: a slightly lighter field with thin separators
    c.fillStyle = C.field; c.fillRect(x0, 0, lw * n, H);
    c.fillStyle = C.lane;
    for (let i = 0; i <= n; i++) c.fillRect(x0 + i * lw - 1, 0, 2, H);
    // hit line with baked glow, reaching a little past the lanes like a scanner beam
    c.save();
    c.shadowColor = C.line; c.shadowBlur = 14;
    c.fillStyle = C.line; c.fillRect(x0 - 4, hitY - 2, lw * n + 8, 4);
    c.restore();
    c.fillStyle = 'rgba(201,255,90,0.35)'; c.fillRect(x0 + lw * n + 4, hitY - 1, 26, 2);
    // receptors: key boxes under the line
    if (this.recH >= 36) {
      c.lineWidth = 2; c.strokeStyle = C.lane;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const bx = x0 + i * lw + 4, cx = Math.round(x0 + (i + 0.5) * lw);
        rrect(c, bx, this.recY, lw - 8, this.recH, 8); c.stroke();
        c.fillStyle = C.dim; c.font = this.fp.key;
        if (this.keyLabels[i]) c.fillText(this.keyLabels[i], cx, Math.round(this.recY + this.recH * 0.36));
        c.font = this.fp.small;
        c.fillText('◆', cx, Math.round(this.recY + this.recH * 0.72));
      }
    }
    if (this.mode === 'wide') this._paintHud(c);
  }

  // Static HUD-column captions.
  _paintHud(c) {
    const H = this.h, x = this.hx, f = this.fp;
    c.font = f.lbl; c.fillStyle = C.dim; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('SCORE', x, 24);
    c.fillText('ACCURACY', x, 40 + this.fpScoreH + 26);
    const by = Math.round(H * 0.56), bw = Math.min(this.hudW - 40, 180);
    this.leftBox = { x, y: by, w: bw, h: 120 };
    c.strokeStyle = C.box; c.lineWidth = 2;
    rrect(c, x, by, bw, 120, 10); c.stroke();
    c.fillText('NOTES LEFT', x + 14, by + 12);
    if (H - 70 > by + 140) c.fillText('TIMING', x, H - 92);
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
    const c = this.c, H = this.h, n = this.lanes;
    const lw = this.laneW, x0 = this.x0, hitY = this.hitY;
    const pps = hitY / this.scrollTime;
    const now = performance.now() / 1000;

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
        c.fillStyle = this.glow || C.line;
        c.fillRect(0, -GLOW_H, lw, GLOW_H);
        c.restore();
        c.globalAlpha = 1;
      }
    }

    // Notes: sorted by time, so only walk the visible slice.
    const notes = game.chart.notes;
    const below = (H - hitY) / pps + 0.1;
    while (this.vi < notes.length && notes[this.vi].time + notes[this.vi].duration < t - below) this.vi++;
    const bw = Math.round(lw * 0.82), bh = Math.round(Math.max(24, Math.min(34, lw * 0.3)));
    const nearY = hitY - Math.min(140, hitY * 0.2), midY = hitY * 0.45;
    c.font = this.fp.note;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 2;
    for (let i = this.vi; i < notes.length; i++) {
      const nt = notes[i];
      if (nt.time > t + this.scrollTime + 0.1) break;
      if (nt.done || (nt.hit && !nt.isHold)) continue;
      const missed = nt.judgement === 'miss' || nt.broken;
      const x = Math.round(x0 + nt.lane * lw + (lw - bw) / 2);
      const yHead = nt.holding ? hitY : Math.round(hitY - (nt.time - t) * pps);
      const st = NOTE[yHead >= nearY ? 2 : yHead >= midY ? 1 : 0];
      if (nt.isHold) {
        const yTop = hitY - (nt.time + nt.duration - t) * pps;
        const tw = Math.round(bw * 0.4);
        c.globalAlpha = nt.holding ? 0.85 : missed ? 0.35 : 0.5;
        c.fillStyle = missed ? C.ghost : st.fill;
        rrect(c, x + (bw - tw) / 2, yTop, tw, Math.max(0, yHead - yTop), 6);
        c.fill();
        c.globalAlpha = 1;
      }
      if (!missed && st === NOTE[2] && this.halo) c.drawImage(this.halo, x + bw / 2 - this.halo.width / 2, yHead - this.halo.height / 2);
      rrect(c, x, yHead - bh / 2, bw, bh, 9);
      c.fillStyle = missed ? C.ghost : st.fill; c.fill();
      c.strokeStyle = missed ? C.ghost : st.edge; c.stroke();
      c.fillStyle = missed ? C.ghostText : st.text;
      c.fillText(noteName(nt.midi), x + bw / 2, yHead);
    }

    // Hit bursts
    if (this.burst) {
      const bs = this.burst.width;
      for (const r of this.rings) {
        const age = now - r.t;
        if (age > 0.35 || age < 0) continue;
        const k = age / 0.35, s = this.reduced ? 1 : (r.big ? 0.7 : 0.55) + 0.5 * k;
        c.globalAlpha = (1 - k) * (r.big ? 1 : 0.7);
        const d = bs * s;
        c.drawImage(this.burst, x0 + (r.lane + 0.5) * lw - d / 2, hitY - d / 2, d, d);
      }
      c.globalAlpha = 1;
    }

    // Judgement labels
    c.font = this.fp.judge;
    for (const l of this.labels) {
      const age = now - l.t;
      if (age > 0.6 || age < 0) continue;
      c.globalAlpha = 1 - age / 0.6;
      c.fillStyle = l.color;
      const rise = this.reduced ? 0 : age * 40;
      c.fillText(l.text, Math.round(x0 + (l.lane + 0.5) * lw), Math.round(hitY - 54 - rise));
    }
    c.globalAlpha = 1;

    this._hud(game, t, now);
  }

  _mixBar(c, game, x, y, w, h) {
    c.fillStyle = C.faint; c.fillRect(x, y, w, h);
    const n = game.judgedCount;
    if (!n) return;
    let cx = x;
    for (const k of ['perfect', 'great', 'good', 'miss']) {
      const sw = w * game.counts[k] / n;
      if (sw <= 0) continue;
      c.fillStyle = JUDGE_COLORS[k]; c.fillRect(cx, y, sw, h);
      cx += sw;
    }
  }

  // Recent hit offsets (left = early, right = late).
  _timing(c, game, mx, my, mw) {
    c.fillStyle = C.faint; c.fillRect(mx - mw / 2, my - 1, mw, 2);
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
    if (left !== this._left || total !== this._total) {
      this._left = left; this._total = total; this._leftTxt = String(left); this._totTxt = '♪ / ' + total;
    }
    const cmb = game.combo;
    if (cmb !== this.lastCombo) {
      if (cmb > this.lastCombo) {
        this.pulseT = now;
        if (cmb >= 50 && cmb % 50 === 0) this._banner(cmb + ' COMBO', '#e4ff8c', now);
      }
      this.lastCombo = cmb;
    }
    if (!this._halfDone && p >= 0.5) { this._halfDone = true; this._banner('HALFWAY', '#b9e07c', now); }
    if (!this._lastTenDone && total > 20 && left <= 10 && left > 0) { this._lastTenDone = true; this._banner('LAST 10 NOTES', '#e4ff8c', now); }
    const tier = cmb >= 100 ? '#f4ffc8' : cmb >= 50 ? '#e4ff8c' : cmb >= 25 ? '#c3ea86' : C.text;
    const s = this.reduced ? 1 : 1 + Math.max(0, 1 - (now - this.pulseT) / 0.12) * 0.25;

    c.textBaseline = 'top'; c.textAlign = 'left';
    if (wide) {
      const x = this.hx, sh = this.fpScoreH;
      c.save(); c.shadowColor = 'rgba(201,255,90,0.45)'; c.shadowBlur = 8;
      c.fillStyle = C.text; c.font = f.score; c.fillText(this._scoreTxt, x, 52);
      c.font = f.acc; c.fillText(this._accTxt, x, 52 + sh + 52);
      c.restore();
      c.font = f.grade; c.fillStyle = GRADE_COLORS[game.grade];
      c.textAlign = 'right'; c.fillText(game.grade, W - 16, 52 + sh + 46);
      c.textAlign = 'left';
      let y = 52 + sh + 52 + 44;
      if (this.trainingLabel) { c.fillStyle = C.dim; c.font = f.small; c.fillText(this.trainingLabel, x, y); y += 26; }
      if (game.fcAlive && game.judgedCount >= 5) {
        c.font = f.lbl; c.fillStyle = game.apAlive ? '#e4ff8c' : '#b4e276';
        c.fillText(game.apAlive ? 'ALL PERFECT' : 'FULL COMBO', x, y);
      }
      const box = this.leftBox, cy = Math.round((y + 30 + box.y) / 2);
      if (cmb > 1 && box.y - y > 110) {
        c.save();
        c.translate(x, cy); c.scale(s, s);
        c.fillStyle = tier; c.font = f.combo; c.textBaseline = 'middle';
        c.fillText(String(cmb), 0, 0);
        c.restore();
        c.textBaseline = 'top';
        c.font = f.lbl; c.fillStyle = C.dim;
        c.fillText('COMBO x' + game.multiplier.toFixed(1), x, cy + 34);
      }
      c.fillStyle = C.text; c.font = f.left; c.fillText(this._leftTxt, box.x + 14, box.y + 42);
      c.font = f.small; c.fillStyle = C.dim; c.fillText(this._totTxt, box.x + 14, box.y + 90);
      if (H - 70 > box.y + 140) this._timing(c, game, x + (this.hudW - 40) / 2, H - 52, this.hudW - 40);
      this._mixBar(c, game, x, H - 28, this.hudW - 40, 10);
    } else {
      // Compact: slim strip on top, progress bar along the bottom edge
      c.fillStyle = 'rgba(10,19,8,0.85)'; c.fillRect(0, 0, W, 64);
      c.fillStyle = C.lane; c.fillRect(0, 64, W, 2);
      c.fillStyle = C.text; c.font = f.title;
      if (!this._titleFit || this._titleFitKey !== this.title + '|' + W) {
        this._titleFitKey = this.title + '|' + W;
        let tt = String(this.title);
        const maxW = W - 230;
        if (typeof c.measureText === 'function') while (tt.length > 3 && c.measureText(tt).width > maxW) tt = tt.slice(0, -2) + '…';
        this._titleFit = tt;
      }
      c.fillText(this._titleFit, 72, 10);
      c.fillStyle = C.dim;
      c.fillText(this._leftTxt + ' left', 72, 36);
      c.textAlign = 'right'; c.fillStyle = C.text; c.font = f.title; c.fillText(this._scoreTxt, W - 12, 10);
      c.fillStyle = C.dim; c.fillText(this._accTxt + ' ' + game.grade, W - 12, 36);
      c.textAlign = 'left';
      if (this.trainingLabel) { c.fillStyle = C.dim; c.font = f.small; c.fillText(this.trainingLabel, 12, 72); }
      c.fillStyle = C.faint; c.fillRect(0, H - 8, W, 8);
      c.fillStyle = C.line; c.fillRect(0, H - 8, W * p, 8);
      if (cmb > 1) {
        c.save();
        c.translate(W / 2, H * 0.3); c.scale(s, s);
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.globalAlpha = 0.9;
        c.fillStyle = tier; c.font = f.combo;
        c.fillText(String(cmb), 0, 0);
        c.font = f.lbl; c.fillStyle = C.dim;
        c.fillText(game.fcAlive && game.judgedCount >= 5 ? (game.apAlive ? 'ALL PERFECT' : 'FULL COMBO') : 'COMBO', 0, 40);
        c.restore();
      }
      this._timing(c, game, W / 2, H - 24, Math.min(220, W * 0.6));
    }

    // Milestone banners over the highway
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const bx = Math.round(this.x0 + this.laneW * this.lanes / 2);
    for (const b of this.banners) {
      const age = now - b.t;
      if (age > 1.4 || age < 0) continue;
      c.globalAlpha = Math.min(1, (1.4 - age) / 0.5);
      c.fillStyle = b.color; c.font = f.banner;
      c.fillText(b.text, bx, Math.round(H * 0.42 - (this.reduced ? 0 : age * 20)));
    }
    c.globalAlpha = 1;

    // Count-in
    if (t < 0) {
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = C.text; c.font = f.count;
      c.fillText(String(Math.ceil(-t)), bx, Math.round(H * 0.45));
    }
    // Resume countdown (song time is frozen while this shows)
    if (this.resumeCount > 0) {
      c.fillStyle = 'rgba(5,10,4,0.55)'; c.fillRect(0, 0, W, H);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = C.line; c.font = f.resume;
      c.fillText(String(this.resumeCount), bx, Math.round(H * 0.45));
      c.font = f.banner; c.fillStyle = C.text;
      c.fillText('GET READY', bx, Math.round(H * 0.45 - 80));
    }
    c.globalAlpha = 1;
  }
}
