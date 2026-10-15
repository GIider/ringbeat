// Canvas rendering: the 8-bit highway that lives inside the phone's LCD. Visual-only; never used for judging.
// The canvas backing store is one pixel per LCD pixel (CSS size = logical size x --u), two colours only: LCD ink on the
// transparent LCD, so the DOM's green backlight and pixel grid show through. All coordinates are whole pixels.
import { GLYPHS, boldGlyph, CAP } from './pixelfont.js';
import { WINDOWS } from './game.js';

const INK = '#1d2b12';
const PAPER = '#a3c464';   // LCD green, used for text knocked out of an ink box
const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const BANNER_POOL = 3;
const RING_POOL = 12, LABEL_POOL = 8;
const LANE_MAX = 40;
const NOTE_H = 7;
const LABEL_H = CAP + 2;   // key-label row under each receptor

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
    this._scrollTime = 1.6;
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
      banner: text => this._banner(text, performance.now() / 1000),
    };
  }

  get scrollTime() { return this._scrollTime; }
  set scrollTime(v) {
    if (v === this._scrollTime) return;
    this._scrollTime = v;
    if (this.w > 0) this._layout();
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
    // The receptor box *is* the target: its height spans the +-good window at the current scroll speed, so a note is
    // hittable exactly while it overlaps the box, and perfect while it sits on the centre band.
    const avail = H - this.top - 4 - LABEL_H - 3;
    const pps0 = avail / this._scrollTime;
    this.recH = Math.max(11, Math.min(17, Math.round(2 * WINDOWS.good * pps0) | 1));
    this.recY = H - 4 - LABEL_H - this.recH;
    this.hitY = this.recY + (this.recH >> 1);     // centre row of the box
    this.pps = (this.hitY - this.top) / this._scrollTime;
    this.perfH = Math.max(1, Math.round(WINDOWS.perfect * this.pps));
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
    const n = this.lanes, lw = this.laneW, x0 = this.x0, H = this.h, hitY = this.hitY, recY = this.recY;
    const bw = lw - 5, ph = this.perfH;
    c.fillStyle = INK;
    // dotted lane separators
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * lw;
      for (let y = this.top + (i & 1); y < recY; y += 2) c.fillRect(x, y, 1, 1);
    }
    // receptors: hollow box the note slots into; dotted lines mark the perfect band, ticks mark the exact centre
    for (let i = 0; i < n; i++) {
      const bx = x0 + i * lw + ((lw - bw) >> 1) - 1, w = bw + 2, by = recY, h = this.recH;
      c.fillRect(bx, by, w, 1); c.fillRect(bx, by + h - 1, w, 1);
      c.fillRect(bx, by, 1, h); c.fillRect(bx + w - 1, by, 1, h);
      for (let x = bx + 1; x < bx + w - 1; x += 2) { c.fillRect(x, hitY - ph, 1, 1); c.fillRect(x, hitY + ph, 1, 1); }
      c.fillRect(bx + 1, hitY, 2, 1); c.fillRect(bx + w - 3, hitY, 2, 1);
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
    const bw = this.laneW - 5, bx = this.x0 + i * this.laneW + ((this.laneW - bw) >> 1) - 1, w = bw + 2;
    const ly = this.recY + this.recH + 2;
    const lab = this.keyLabels[i];
    if (down) {
      c.fillStyle = INK;
      c.fillRect(bx, ly - 1, w, LABEL_H);
      // pressed: thicken the receptor with an inner outline (the box interior must stay clear for the note)
      const by = this.recY, h = this.recH;
      c.fillRect(bx + 1, by + 1, w - 2, 1); c.fillRect(bx + 1, by + h - 2, w - 2, 1);
      c.fillRect(bx + 1, by + 1, 1, h - 2); c.fillRect(bx + w - 2, by + 1, 1, h - 2);
    }
    if (lab) this._text(c, String(lab).slice(0, 3), bx + (w >> 1), ly, down ? PAPER : INK, true, 1, 'center');
  }

  draw(game, t) {
    const c = this.c, W = this.w, H = this.h, n = this.lanes;
    const lw = this.laneW, x0 = this.x0, hitY = this.hitY;
    const pps = this.pps, ph = this.perfH;
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

    // Beat lines (every 4th stronger): a rhythm ruler between the notes.
    const bl = game.chart.beatLen, fb = game.chart.firstBeat;
    if (bl > 0) {
      c.fillStyle = INK;
      const span = n * lw, tEnd = t + this.scrollTime;
      for (let k = Math.ceil(fb + t / bl); ; k++) {
        const bt = (k - fb) * bl;
        if (bt > tEnd) break;
        const y = Math.round(hitY - (bt - t) * pps);
        if (y < this.top || y >= this.recY) continue;
        const step = (k & 3) === 0 ? 2 : 4;
        for (let x = x0 + 1; x < x0 + span; x += step) c.fillRect(x, y, 1, 1);
      }
    }

    // "Now" cue: a lane's perfect band goes solid while its next note is inside the hit window.
    const bwr = lw - 5, rx = ((lw - bwr) >> 1) - 1;
    c.fillStyle = INK;
    for (let i = 0; i < n; i++) {
      const list = game.byLane && game.byLane[i];
      if (!list) continue;
      let k = game.lanePtr[i];
      while (k < list.length && list[k].judged) k++;
      if (k >= list.length || Math.abs(t - list[k].time) > WINDOWS.good) continue;
      const bx = x0 + i * lw + rx;
      c.fillRect(bx, hitY - ph, bwr + 2, 1); c.fillRect(bx, hitY + ph, bwr + 2, 1);
    }

    // Notes: sorted by time, so only walk the visible slice.
    const notes = game.chart.notes;
    const below = (H - hitY) / pps + 0.1;
    while (this.vi < notes.length && notes[this.vi].time + notes[this.vi].duration < t - below) this.vi++;
    const bw = lw - 5, hx = Math.floor((lw - bw) / 2);
    for (let i = this.vi; i < notes.length; i++) {
      const nt = notes[i];
      if (nt.time > t + this.scrollTime + 0.1) break;
      if (nt.done || (nt.hit && !nt.isHold && !nt.isRoll)) continue;
      const missed = nt.judgement === 'miss' || nt.broken;
      const x = x0 + nt.lane * lw + hx;
      if (nt.isRoll) { // rolls: a dotted rail with a thin bar per tick (the head is the first tick)
        const yTop = Math.round(hitY - (nt.time + nt.duration - t) * pps), yBot = Math.round(hitY - (nt.time - t) * pps);
        const rx = x + (bw >> 1);
        c.fillStyle = INK;
        for (let y = Math.max(this.top, yTop); y < Math.min(H, yBot); y += 2) c.fillRect(rx, y, 1, 1);
        for (let k = 0; k < nt.ticks.length; k++) {
          const yk = Math.round(hitY - (nt.time + nt.ticks[k] - t) * pps);
          if (yk < this.top || yk > H - 2) continue;
          if (k === 0 && !nt.hit) { // head: a full-height note with an "R" notch
            c.fillRect(x, yk - 3, bw, NOTE_H);
            c.clearRect(x, yk - 3, 1, 1); c.clearRect(x + bw - 1, yk - 3, 1, 1);
            c.clearRect(x, yk + 3, 1, 1); c.clearRect(x + bw - 1, yk + 3, 1, 1);
            c.fillStyle = PAPER; c.fillRect(rx - 1, yk, 3, 1); c.fillStyle = INK;
          } else if (nt.time + nt.ticks[k] > t - 0.02 || !nt.hit) c.fillRect(x + 1, yk - 1, bw - 2, 3);
        }
        continue;
      }
      const yHead = nt.holding ? hitY : Math.round(hitY - (nt.time - t) * pps);
      if (nt.slide !== undefined && !missed) { // slide: dotted line to the next note of the chain
        let nx = null;
        for (let j = i + 1; j < notes.length && j <= i + 4; j++) {
          if (notes[j].slide === nt.slide && notes[j].slideIdx === nt.slideIdx + 1) { nx = notes[j]; break; }
        }
        if (nx) {
          const x1 = x + (bw >> 1), y1 = yHead, x2 = x0 + nx.lane * lw + hx + (bw >> 1), y2 = Math.round(hitY - (nx.time - t) * pps);
          const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
          c.fillStyle = INK;
          for (let k = 0; k <= steps; k += 2) {
            const px = Math.round(x1 + (x2 - x1) * k / steps), py = Math.round(y1 + (y2 - y1) * k / steps);
            if (py >= this.top && py <= H - 2) c.fillRect(px, py, 1, 1);
          }
        }
      }
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
      if (!missed && !nt.holding) { // approach cue: a lead line 0.3s out, a second one 0.15s out
        const dt = nt.time - t;
        if (dt < 0.3 && dt > -WINDOWS.good) {
          c.fillRect(x + 1, y - 2, bw - 2, 1);
          if (dt < 0.15) c.fillRect(x + 1, y + NOTE_H + 1, bw - 2, 1);
        }
      }
      if (missed) { // hollow ghost
        c.fillRect(x, y, bw, 1); c.fillRect(x, y + NOTE_H - 1, bw, 1);
        c.fillRect(x, y, 1, NOTE_H); c.fillRect(x + bw - 1, y, 1, NOTE_H);
      } else {
        c.fillRect(x, y, bw, NOTE_H);
        c.clearRect(x, y, 1, 1); c.clearRect(x + bw - 1, y, 1, 1);
        c.clearRect(x, y + NOTE_H - 1, 1, 1); c.clearRect(x + bw - 1, y + NOTE_H - 1, 1, 1);
        const cx = x + (bw >> 1), cy = y + (NOTE_H >> 1);
        c.fillStyle = PAPER;
        if (nt.power) { c.fillRect(cx - 1, cy, 3, 1); c.fillRect(cx, cy - 1, 1, 3); }  // power notes: plus sign
        else if (nt.isHold) c.fillRect(cx, cy, 1, 1);                                  // hold heads have a centre dot
        c.fillStyle = INK;
        if (nt.accent) { c.fillRect(cx - 1, y - 3, 3, 1); c.fillRect(cx, y - 4, 1, 1); } // accent: caret above the head
        if (nt.chordLane === nt.lane + 1) c.fillRect(x + bw, cy, lw - bw, 1);            // double: bridge to the right lane
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
      this._text(c, l.text, x, this.recY - 10 - (this.reduced ? 0 : age > 0.2 ? 1 : 0), INK, false);
    }

    this._hud(game, t, now);
  }

  _hud(game, t, now) {
    const c = this.c, W = this.w, H = this.h;
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

    // Resume countdown (song time is frozen while this shows)
    if (this.resumeCount > 0) {
      this._box(c, 'GET READY', bx, Math.round(H * 0.3));
      this._box(c, String(this.resumeCount), bx, Math.round(H * 0.45), 3);
    }
  }
}
