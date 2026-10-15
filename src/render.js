// Canvas rendering: the 8-bit highway that lives inside the phone's LCD. Visual-only; never used for judging.
// The canvas backing store is one pixel per LCD pixel (CSS size = logical size x --u), two colours only: LCD ink on the
// transparent LCD, so the DOM's green backlight and pixel grid show through. All coordinates are whole pixels.
import { GLYPHS, boldGlyph, CAP } from './pixelfont.js';

const INK = '#1d2b12';
const PAPER = '#a3c464';   // LCD green, used for text knocked out of an ink box
const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const BANNER_POOL = 3;
const RING_POOL = 12, LABEL_POOL = 8;
const LANE_MAX = 40;
const NOTE_H = 5;
const REC_H = 13;          // receptor box height

const BOLD = {};
const glyph = (ch, bold) => {
  const g = GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS[' '];
  if (!bold) return g;
  return BOLD[ch] || (BOLD[ch] = boldGlyph(g));
};
function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
// Width in LCD pixels of a string in the 5x7 font (advance = glyph width + 1).
export function textWidth(str, bold = false) {
  let w = 0;
  for (const ch of str) w += glyph(ch, bold).w + 1;
  return Math.max(0, w - 1);
}
function paintText(c, str, x, y, color, bold) {
  c.fillStyle = color;
  for (const ch of str) {
    const g = glyph(ch, bold);
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      for (let k = 0; k < row.length; k++) {
        if (row[k] !== '#') continue;
        let e = k + 1; while (e < row.length && row[e] === '#') e++;
        c.fillRect(x + k, y + r, e - k, 1);
        k = e - 1;
      }
    }
    x += g.w + 1;
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.u = 2;                                   // CSS pixels per LCD pixel
    this.lanes = 4;
    this.scrollTime = 1.6;
    this.keyLabels = [];
    this.title = '';
    this.trainingLabel = '';
    this.resumeCount = 0;
    this.w = 0; this.h = 0;
    this.reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    this.flash = new Float64Array(4).fill(-10);
    this.pressed = new Uint8Array(4);
    // Fixed pools -> no per-frame/per-hit allocations
    this.rings = Array.from({ length: RING_POOL }, () => ({ t: -10, lane: 0, big: false }));
    this.labels = Array.from({ length: LABEL_POOL }, () => ({ t: -10, lane: 0, text: '' }));
    this.ringI = 0; this.labelI = 0;
    this.vi = 0;
    this.lastCombo = 0;
    this.banners = Array.from({ length: BANNER_POOL }, () => ({ t: -10, text: '' }));
    this.bannerI = 0;
    this._sprites = new Map();
    this.resetState();
    this.resize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => this.resize());
    }
    // The LCD changes size with the phone layout (compact <-> full phone) and while its screen is hidden.
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      new ResizeObserver(() => {
        const b = canvas.parentElement;
        if (b.clientWidth && Math.floor(b.clientWidth / this.u) !== this.w || Math.floor(b.clientHeight / this.u) !== this.h) this.resize();
      }).observe(canvas.parentElement);
    }
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', () => { this._staticDirty = true; });
    }
    // fx hooks handed to the game
    this.fx = {
      press: lane => { this.flash[lane] = performance.now() / 1000; },
      judge: (lane, j) => {
        const now = performance.now() / 1000;
        if (j !== 'miss') {
          const r = this.rings[this.ringI++ % RING_POOL];
          r.t = now; r.lane = lane; r.big = j === 'perfect';
        }
        const l = this.labels[this.labelI++ % LABEL_POOL];
        l.t = now; l.lane = lane; l.text = JUDGE_TEXT[j];
      },
    };
  }

  setPixelScale(u) {
    if (u === this.u) return;
    this.u = u;
    this.resize();
  }

  resize() {
    const box = this.canvas.parentElement || this.canvas;
    const cw = box.clientWidth, ch = box.clientHeight;
    if (!(cw > 0 && ch > 0)) return;              // hidden screen: keep the last size
    const w = Math.floor(cw / this.u), h = Math.floor(ch / this.u);
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    if (this.canvas.style) { this.canvas.style.width = w * this.u + 'px'; this.canvas.style.height = h * this.u + 'px'; }
    this._layout();
  }

  setLanes(n, keyLabels) {
    this.lanes = n;
    this.keyLabels = keyLabels || [];
    this.flash = new Float64Array(n).fill(-10);
    this.pressed = new Uint8Array(n);
    this._layout();
  }

  resetState() {
    this.vi = 0; this.lastCombo = 0;
    this.rings.forEach(r => r.t = -10); this.labels.forEach(l => l.t = -10); this.banners.forEach(b => b.t = -10);
    this._dispScore = 0; this._shownScore = -1;
    this._halfDone = this._lastTenDone = false;
  }

  _banner(text, now) {
    const b = this.banners[this.bannerI++ % BANNER_POOL];
    b.t = now; b.text = text;
  }

  _layout() {
    const W = this.w, H = this.h, n = this.lanes;
    this.laneW = Math.max(8, Math.min(LANE_MAX, Math.floor((W - 4) / n)));
    this.x0 = Math.floor((W - this.laneW * n) / 2);
    this.top = 20;                                // below the two HUD rows
    this.recY = H - REC_H - 4;                    // receptor boxes
    this.hitY = this.recY - 3;                    // hit line (2px, rows hitY..hitY+1)
    this._titleLines = null;
    this._staticDirty = true;
    this._idleDone = false;
  }

  // Pre-rendered text (one canvas per string/colour) so a frame blits a handful of bitmaps instead of hundreds of rects.
  _text(c, str, x, y, color = INK, bold = false, scale = 1, align = 'left') {
    const w = textWidth(str, bold), h = CAP + 2;
    if (align === 'center') x -= Math.floor(w * scale / 2);
    else if (align === 'right') x -= w * scale;
    x = Math.round(x); y = Math.round(y);
    const key = str + '|' + color + '|' + bold;
    let sp = this._sprites.get(key);
    if (sp === undefined) {
      if (this._sprites.size > 200) this._sprites.clear();
      sp = makeCanvas(Math.max(1, w), h);
      if (sp) paintText(sp.getContext('2d'), str, 0, 0, color, bold);
      this._sprites.set(key, sp);
    }
    if (sp && typeof c.drawImage === 'function') c.drawImage(sp, x, y, w * scale, h * scale);
    else if (scale === 1) paintText(c, str, x, y, color, bold);
    return w * scale;
  }

  // A text box knocked out of the field: paper rectangle, ink border, ink text.
  _box(c, str, cx, cy, scale = 1, bold = true) {
    // Cap height (7 rows) is what's visible, so the box is sized on that, not on the sprite's descender rows.
    const padX = 2 * scale, padY = scale + 1;
    const w = textWidth(str, bold) * scale + 2 * padX + 2, h = CAP * scale + 2 * padY + 2;
    const x = Math.max(0, Math.min(this.w - w, Math.round(cx - w / 2))), y = Math.round(cy - h / 2);
    c.fillStyle = INK; c.fillRect(x, y, w, h);
    c.fillStyle = PAPER; c.fillRect(x + 1, y + 1, w - 2, h - 2);
    this._text(c, str, x + 1 + padX, y + 1 + padY, INK, bold, scale);
  }

  // Lanes, hit line and receptors never change between frames: paint them once.
  _buildStatic() {
    this._staticDirty = false;
    this.staticLayer = null;
    this.checker = null;
    if (typeof document === 'undefined' || !(this.w > 0 && this.h > 0)) return;
    const layer = makeCanvas(this.w, this.h);
    this._paintStatic(layer.getContext('2d'));
    this.staticLayer = layer;
    const ck = makeCanvas(2, 2);
    if (ck) {
      const k = ck.getContext('2d');
      k.fillStyle = INK; k.fillRect(0, 0, 1, 1); k.fillRect(1, 1, 1, 1);
      this.checker = this.c.createPattern ? this.c.createPattern(ck, 'repeat') : null;
    }
  }

  _paintStatic(c) {
    const n = this.lanes, lw = this.laneW, x0 = this.x0, H = this.h, hitY = this.hitY;
    c.fillStyle = INK;
    // dotted lane separators
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * lw;
      for (let y = this.top + (i & 1); y < hitY; y += 2) c.fillRect(x, y, 1, 1);
    }
    // hit line: solid, a little wider than the lanes
    c.fillRect(x0 - 2, hitY, lw * n + 5, 2);
    // receptors
    for (let i = 0; i < n; i++) {
      const bx = x0 + i * lw + 2, bw = lw - 3, by = this.recY;
      c.fillRect(bx, by, bw, 1); c.fillRect(bx, by + REC_H - 1, bw, 1);
      c.fillRect(bx, by, 1, REC_H); c.fillRect(bx + bw - 1, by, 1, REC_H);
    }
    // left progress rail track (dotted)
    for (let y = this.top; y < H - 2; y += 2) c.fillRect(1, y, 1, 1);
  }

  // Map a client X to a lane (used by pointer input).
  laneAt(clientX) {
    const r = this.canvas.getBoundingClientRect();
    const s = r.width ? r.width / (this.w || 1) : 1;
    const x = (clientX - r.left) / s;
    return Math.max(0, Math.min(this.lanes - 1, Math.floor((x - this.x0) / this.laneW)));
  }

  drawIdle() {
    if (this._idleDone) return; // nothing changes while idle; repaint only after a resize or a game frame
    this._idleDone = true;
    this.c.clearRect(0, 0, this.w, this.h);
  }

  _keyBox(c, i, down) {
    const bx = this.x0 + i * this.laneW + 2, bw = this.laneW - 3, by = this.recY;
    if (down) { c.fillStyle = INK; c.fillRect(bx, by, bw, REC_H); }
    const lab = this.keyLabels[i];
    if (lab) this._text(c, String(lab).slice(0, 3), bx + Math.floor(bw / 2), by + 3, down ? PAPER : INK, true, 1, 'center');
  }

  draw(game, t) {
    const c = this.c, W = this.w, H = this.h, n = this.lanes;
    const lw = this.laneW, x0 = this.x0, hitY = this.hitY;
    const pps = (hitY - this.top) / this.scrollTime;
    const now = performance.now() / 1000;

    this._idleDone = false;
    if (this._staticDirty) this._buildStatic();
    c.clearRect(0, 0, W, H);
    if (this.staticLayer) c.drawImage(this.staticLayer, 0, 0);
    else this._paintStatic(c);

    // Key boxes: inverted while pressed or held, plus a short flash after a tap
    for (let i = 0; i < n; i++) {
      const age = now - this.flash[i];
      this._keyBox(c, i, !!(game.holds && game.holds[i]) || age < 0.09);
    }

    // Notes: sorted by time, so only walk the visible slice.
    const notes = game.chart.notes;
    const below = (H - hitY) / pps + 0.1;
    while (this.vi < notes.length && notes[this.vi].time + notes[this.vi].duration < t - below) this.vi++;
    const bw = lw - 5, hx = Math.floor((lw - bw) / 2);
    for (let i = this.vi; i < notes.length; i++) {
      const nt = notes[i];
      if (nt.time > t + this.scrollTime + 0.1) break;
      if (nt.done || (nt.hit && !nt.isHold)) continue;
      const missed = nt.judgement === 'miss' || nt.broken;
      const x = x0 + nt.lane * lw + hx;
      const yHead = nt.holding ? hitY : Math.round(hitY - (nt.time - t) * pps);
      if (nt.isHold) {
        const yTop = Math.max(this.top, Math.round(hitY - (nt.time + nt.duration - t) * pps));
        const hgt = yHead - yTop;
        if (hgt > 0) {
          const tw = Math.max(3, (bw >> 1) | 1), tx = x + ((bw - tw) >> 1);
          if (missed) { // ghost: just the two edges, dotted
            c.fillStyle = INK;
            for (let y = yTop; y < yHead; y += 2) { c.fillRect(tx, y, 1, 1); c.fillRect(tx + tw - 1, y, 1, 1); }
          } else {
            c.fillStyle = (!nt.holding && this.checker) ? this.checker : INK;
            c.fillRect(tx, yTop, tw, hgt);
          }
        }
      }
      const y = yHead - (NOTE_H >> 1);
      if (y + NOTE_H < this.top || y > H) continue;
      c.fillStyle = INK;
      if (missed) { // hollow ghost
        c.fillRect(x, y, bw, 1); c.fillRect(x, y + NOTE_H - 1, bw, 1);
        c.fillRect(x, y, 1, NOTE_H); c.fillRect(x + bw - 1, y, 1, NOTE_H);
      } else {
        c.fillRect(x, y, bw, NOTE_H);
        c.clearRect(x, y, 1, 1); c.clearRect(x + bw - 1, y, 1, 1);
        c.clearRect(x, y + NOTE_H - 1, 1, 1); c.clearRect(x + bw - 1, y + NOTE_H - 1, 1, 1);
        if (nt.isHold) { c.fillStyle = PAPER; c.fillRect(x + (bw >> 1), y + 2, 1, 1); }   // hold heads have a centre dot
      }
    }

    // Hit sparkles: three pixel frames, no easing
    if (!this.reduced) {
      c.fillStyle = INK;
      for (const r of this.rings) {
        const age = now - r.t;
        if (age > 0.21 || age < 0) continue;
        const cx = x0 + r.lane * lw + (lw >> 1), cy = hitY;
        const f = age < 0.07 ? 0 : age < 0.14 ? 1 : 2, d = 3 + f * 2 + (r.big ? 2 : 0);
        if (f === 0) { c.fillRect(cx - d, cy, 2 * d + 1, 1); c.fillRect(cx, cy - d, 1, 2 * d + 1); }
        else {
          for (let k = 2; k <= d; k += 2) {
            c.fillRect(cx - k, cy - k, 1, 1); c.fillRect(cx + k, cy - k, 1, 1);
            c.fillRect(cx - k, cy + k, 1, 1); c.fillRect(cx + k, cy + k, 1, 1);
          }
        }
      }
    }

    // Judgement labels (no fade: shown, then gone)
    for (const l of this.labels) {
      const age = now - l.t;
      if (age > 0.45 || age < 0) continue;
      const x = Math.max(0, Math.min(W - textWidth(l.text, false) - 1, x0 + l.lane * lw + (lw >> 1) - (textWidth(l.text, false) >> 1)));
      this._text(c, l.text, x, hitY - 14 - (this.reduced ? 0 : age > 0.2 ? 1 : 0), INK, false);
    }

    this._hud(game, t, now);
  }

  _hud(game, t, now) {
    const c = this.c, W = this.w, H = this.h;
    const total = game.chart.notes.length;
    const p = Math.max(0, Math.min(1, t / game.chart.length));

    // Score counts up in steps toward the real value; strings are rebuilt only when the integer changes.
    this._dispScore += (game.score - this._dispScore) * 0.3;
    if (Math.abs(game.score - this._dispScore) < 1) this._dispScore = game.score;
    const shown = Math.round(this._dispScore);
    if (shown !== this._shownScore) { this._shownScore = shown; this._scoreTxt = String(shown).padStart(7, '0'); }
    const acc = game.accuracy;
    if (acc !== this._acc || game.grade !== this._grade) { this._acc = acc; this._grade = game.grade; this._accTxt = game.grade + ' ' + acc.toFixed(1) + '%'; }
    const cmb = game.combo;
    if (cmb !== this.lastCombo) {
      if (cmb > this.lastCombo && cmb >= 50 && cmb % 50 === 0) this._banner(cmb + ' COMBO', now);
      this.lastCombo = cmb;
    }
    const left = game.notesLeft;
    if (!this._halfDone && p >= 0.5) { this._halfDone = true; this._banner('HALFWAY', now); }
    if (!this._lastTenDone && total > 20 && left <= 10 && left > 0) { this._lastTenDone = true; this._banner('LAST 10', now); }

    // Row 1: score + grade/accuracy. Row 2: FC/AP or training label + combo.
    this._text(c, this._scoreTxt, 3, 1, INK, true);
    this._text(c, this._accTxt, W - 2, 1, INK, false, 1, 'right');
    c.fillStyle = INK; c.fillRect(0, 10, W, 1);
    let tag = this.trainingLabel;
    if (!tag && game.fcAlive && game.judgedCount >= 5) tag = game.apAlive ? 'ALL PERFECT' : 'FULL COMBO';
    if (tag) this._text(c, tag, 3, 12, INK, false);
    if (cmb > 1) this._text(c, cmb + ' COMBO', W - 2, 12, INK, true, 1, 'right');

    // Progress rail (left edge, fills downward from the top)
    const ry = this.top, rh = H - 2 - ry;
    c.fillStyle = INK; c.fillRect(0, ry, 3, Math.round(rh * p));

    // Milestone banners over the highway
    const bx = Math.round(this.x0 + this.laneW * this.lanes / 2);
    for (const b of this.banners) {
      const age = now - b.t;
      if (age > 1.2 || age < 0) continue;
      this._box(c, b.text, bx, Math.round(H * 0.4));
    }

    // Count-in
    if (t < 0 && this.resumeCount <= 0) this._box(c, String(Math.ceil(-t)), bx, Math.round(H * 0.4), 3);
    // Resume countdown (song time is frozen while this shows)
    if (this.resumeCount > 0) {
      this._box(c, 'GET READY', bx, Math.round(H * 0.3));
      this._box(c, String(this.resumeCount), bx, Math.round(H * 0.45), 3);
    }
  }
}
