// Canvas rendering: the 8-bit highway that lives inside the phone's LCD. Visual-only; never used for judging.
// The canvas backing store is one pixel per LCD pixel (CSS size = logical size x --u), two colours only: LCD ink on the
// transparent LCD, so the DOM's green backlight and pixel grid show through. All coordinates are whole pixels.
import { GLYPHS, boldGlyph, CAP } from './pixelfont.js';
import { t as tr } from './i18n.js';
import { WINDOWS } from './game.js';

export const INK = '#1d2b12';
const PAPER = '#a3c464';   // LCD green, used for text knocked out of an ink box
const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const BANNER_POOL = 3;
const RING_POOL = 12, LABEL_POOL = 8, DEBRIS_POOL = 24;
const DEBRIS_DIRS = [[-1, -1], [1, -1], [-1, 1], [1, 1]]; // diagonal pixel debris on a perfect hit
const SPRITE_MAX = 200;   // cached text strings (each has up to 4 colour/weight variants)
const LANE_MAX = 40;
const RAIL_L = 64, RAIL_R = 84, RAIL_LANE_MIN = 24; // wide LCDs: stat rails left and right of the lanes (BPM / time, combo / judgement counts)
const NOTE_H = 7;
const HIDE_FRAC = 0.35;  // Hidden mod: share of the approach time (nearest the hit line) where notes are not drawn
const HEAD = 1;           // rows above the cap line that text sprites keep (raised umlaut dots)
const LABEL_H = CAP + 2;   // key-label row under each receptor

// 1-bit icons for the rails (rows of '#' / '.')
const ICON_NOTE = ['...########', '...########', '...##....##', '...##....##', '...##....##', '...##....##', '.####..####', '#####.#####', '.###...###.'];
const ICON_CLOCK = ['...#####...', '..##...##..', '.##..#..##.', '.#...#...#.', '##...#...##', '##...###.##', '##.......##', '.#.......#.', '.##.....##.', '..##...##..', '...#####...'];
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
export function paintText(c, str, x, y, color, bold) {
  c.fillStyle = color;
  for (const ch of str) {
    const g = glyph(ch, bold), up = g.up || 0;
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      for (let k = 0; k < row.length; k++) {
        if (row[k] !== '#') continue;
        let e = k + 1; while (e < row.length && row[e] === '#') e++;
        c.fillRect(x + k, y + r - up, e - k, 1);
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
    this.modLabel = '';        // active mod chips, shown on the HUD while no FC/AP tag is up
    this.hidden = false;       // Hidden mod: notes vanish before they reach the hit line
    this.w = 0; this.h = 0;
    this.reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    this.flash = new Float64Array(4).fill(-10);
    this.pressed = new Uint8Array(4);
    // Fixed pools -> no per-frame/per-hit allocations
    this.rings = Array.from({ length: RING_POOL }, () => ({ t: -10, lane: 0, big: false }));
    this.labels = Array.from({ length: LABEL_POOL }, () => ({ t: -10, lane: 0, text: '', j: 'good' }));
    this.ringI = 0; this.labelI = 0;
    // Juice (all stepped, fixed pools): debris on perfects, receptor punch, tiny shake, combo-break strike, milestone frame.
    this.juice = true;
    this.comboPopup = true; // "N COMBO" banner at every 50th combo
    this.debris = Array.from({ length: DEBRIS_POOL }, () => ({ t: -10, lane: 0, dx: 0, dy: 0 }));
    this.debrisI = 0;
    this.punch = new Float64Array(4).fill(-10);
    this.shakeT = -10; this.breakT = -10; this.popT = -10; this.frameT = -10; this.bumpT = -10;
    this._brokenTxt = '';
    this.vi = 0;
    this.lastCombo = 0; this._comboTxt = ''; this._comboShort = '';
    this.banners = Array.from({ length: BANNER_POOL }, () => ({ t: -10, text: '' }));
    this.bannerI = 0;
    this._sprites = new Map();  // string -> [ink, paper, ink bold, paper bold] -> { w, sp }
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
          if (lane < this.punch.length && (j === 'perfect' || j === 'great')) this.punch[lane] = now;
          if (j === 'perfect') {
            for (let k = 0; k < DEBRIS_DIRS.length; k++) {
              const d = this.debris[this.debrisI++ % DEBRIS_POOL];
              d.t = now; d.lane = lane; d.dx = DEBRIS_DIRS[k][0]; d.dy = DEBRIS_DIRS[k][1];
            }
          }
        } else if (this.lastCombo >= 10) { // combo break: strike the old counter, jitter the field
          this.breakT = now; this.shakeT = now; this._brokenTxt = this._comboTxt;
        }
        for (const o of this.labels) if (o.lane === lane) o.t = -10; // a new judgement replaces the lane's previous label
        const l = this.labels[this.labelI++ % LABEL_POOL];
        l.t = now; l.lane = lane; l.text = tr(JUDGE_TEXT[j]); l.j = j;
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
    this.c.imageSmoothingEnabled = false;         // scaled text sprites (the combo) stay crisp
    if (this.canvas.style) { this.canvas.style.width = w * this.u + 'px'; this.canvas.style.height = h * this.u + 'px'; }
    this._layout();
  }

  setLanes(n, keyLabels) {
    this.lanes = n;
    this.keyLabels = keyLabels || [];
    this.flash = new Float64Array(n).fill(-10);
    this.punch = new Float64Array(n).fill(-10);
    this.pressed = new Uint8Array(n);
    this._layout();
  }

  resetState() {
    this.vi = 0; this.lastCombo = 0; this._comboTxt = ''; this._comboShort = '';
    this.rings.forEach(r => r.t = -10); this.labels.forEach(l => l.t = -10); this.banners.forEach(b => b.t = -10);
    this.debris.forEach(d => d.t = -10); this.punch.fill(-10);
    this.shakeT = this.breakT = this.popT = this.frameT = this.bumpT = -10; this._lastScore = 0;
    this._dispScore = 0; this._shownScore = -1;
  }

  _banner(text, now) {
    const b = this.banners[this.bannerI++ % BANNER_POOL];
    b.t = now; b.text = text;
  }

  _layout() {
    const W = this.w, H = this.h, n = this.lanes;
    this.rails = W >= RAIL_L + RAIL_R + RAIL_LANE_MIN * n;
    const railL = this.rails ? RAIL_L : 0, area = W - railL - (this.rails ? RAIL_R : 0);
    this.laneW = Math.max(8, Math.min(LANE_MAX, Math.floor((area - 4) / n)));
    this.x0 = railL + Math.floor((area - this.laneW * n) / 2);
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

  // Pre-rendered text (one canvas per string/colour/weight) so a frame blits a handful of bitmaps instead of hundreds
  // of rects. Lookup is by string, then a 4-slot array for ink/paper x plain/bold: no key concatenation per call, and
  // the oldest string is evicted one at a time (a wholesale clear would re-rasterise every label in a single frame).
  _text(c, str, x, y, color = INK, bold = false, scale = 1, align = 'left') {
    const ci = color === INK ? 0 : color === PAPER ? 1 : -1;
    let ent;
    if (ci >= 0) {
      let slots = this._sprites.get(str);
      if (slots === undefined) {
        if (this._sprites.size >= SPRITE_MAX) this._sprites.delete(this._sprites.keys().next().value);
        this._sprites.set(str, slots = [null, null, null, null]);
      }
      const si = ci + (bold ? 2 : 0);
      ent = slots[si];
      if (ent === null) {
        const w = textWidth(str, bold);
        const sp = makeCanvas(Math.max(1, w), CAP + 2 + HEAD);
        if (sp) paintText(sp.getContext('2d'), str, 0, HEAD, color, bold); // HEAD: room for raised umlaut dots
        slots[si] = ent = { w, sp };
      }
    } else {
      ent = { w: textWidth(str, bold), sp: null }; // unexpected colour: draw uncached
    }
    const w = ent.w, h = CAP + 2 + HEAD, sp = ent.sp;
    if (align === 'center') x -= Math.floor(w * scale / 2);
    else if (align === 'right') x -= w * scale;
    x = Math.round(x); y = Math.round(y);
    if (sp && typeof c.drawImage === 'function') c.drawImage(sp, x, y - HEAD * scale, w * scale, h * scale);
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

  // Judgement chip: clear halo, then an ink chip with knocked-out text (Perfect/Great) or a hollow outline (Good/Miss),
  // so it stays readable over solid ink notes. Perfect is bold with side sparkles; Miss is struck through.
  _chip(c, str, j, cx, y) {
    const bold = j === 'perfect', solid = j === 'perfect' || j === 'great';
    const tw = textWidth(str, bold), w = tw + 4, h = CAP + 4;
    const x = Math.max(1, Math.min(this.w - w - 1, Math.round(cx - w / 2)));
    c.clearRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = INK;
    if (solid) c.fillRect(x, y, w, h);
    else {
      c.fillRect(x, y, w, 1); c.fillRect(x, y + h - 1, w, 1);
      c.fillRect(x, y, 1, h); c.fillRect(x + w - 1, y, 1, h);
    }
    this._text(c, str, x + 2, y + 2, solid ? PAPER : INK, bold);
    if (j === 'miss') c.fillRect(x + 2, y + (h >> 1), tw, 1);
    if (j === 'perfect') {
      const my = y + (h >> 1);
      for (const sx of [x - 3, x + w + 2]) { c.fillRect(sx, my, 1, 1); c.fillRect(sx, my - 3, 1, 1); c.fillRect(sx, my + 3, 1, 1); }
    }
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
    const fx = this.juice && !this.reduced;
    // Tiny shake: 1 px sideways, flipping every frame-ish step for ~0.1 s (the HUD is drawn unshaken).
    const shakeAge = now - this.shakeT;
    const sx = fx && shakeAge >= 0 && shakeAge < 0.1 ? (Math.floor(shakeAge / 0.033) & 1 ? 1 : -1) : 0;
    if (sx) c.translate(sx, 0);
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
    const hideAt = this.hidden ? this.scrollTime * HIDE_FRAC : 0;
    for (let i = this.vi; i < notes.length; i++) {
      const nt = notes[i];
      if (nt.time > t + this.scrollTime + 0.1) break;
      if (nt.done || (nt.hit && !nt.isHold && !nt.isRoll)) continue;
      if (hideAt > 0 && !nt.holding && nt.time - t < hideAt) continue;
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
        if (nt.isHold) c.fillRect(cx, cy, 1, 1); // hold heads have a centre dot
        c.fillStyle = INK;
        if (nt.chordLane === nt.lane + 1) c.fillRect(x + bw, cy, lw - bw, 1); // double: bridge to the right lane
      }
    }

    if (fx) {
      // Receptor punch: the box fills solid for a moment on a perfect/great, then the sparkle takes over
      c.fillStyle = INK;
      const bwp = lw - 5;
      for (let i = 0; i < n; i++) {
        const age = now - this.punch[i];
        if (age < 0 || age > 0.05) continue;
        c.fillRect(x0 + i * lw + ((lw - bwp) >> 1), this.recY + 1, bwp, this.recH - 2);
      }
      // Held notes shimmer: alternating pixel row on the hit line
      const par = Math.floor(now / 0.07) & 1;
      if (game.holds) {
        for (let i = 0; i < n; i++) {
          if (!game.holds[i]) continue;
          const bx = x0 + i * lw + ((lw - bwp) >> 1);
          c.fillStyle = PAPER;
          for (let x = bx + 1 + par; x < bx + bwp - 1; x += 2) c.fillRect(x, hitY, 1, 1);
          c.fillStyle = INK;
        }
      }
      // Perfect debris: 4 diagonal pixels, three 70 ms steps outward
      for (const d of this.debris) {
        const age = now - d.t;
        if (age < 0 || age > 0.21) continue;
        const r = 5 + 3 * Math.floor(age / 0.07);
        c.fillRect(x0 + d.lane * lw + (lw >> 1) + d.dx * r, hitY + d.dy * r, 1, 1);
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
      // Typewriter reveal on the first steps
      const txt = fx && age < 0.1 ? l.text.slice(0, 2 + Math.floor(age / 0.025)) : l.text;
      // Sits in the key-label row under the receptor (covering the key letter briefly), clear of incoming notes
      this._chip(c, txt, l.j, x0 + l.lane * lw + (lw >> 1), this.recY + this.recH + 1);
    }

    if (sx) c.translate(-sx, 0);

    this._hud(game, t, now);

    // Milestone: the LCD edge blinks (two 50 ms pulses, border only so it never strobes the whole screen)
    if (fx) {
      const fa = now - this.frameT;
      if (fa >= 0 && fa < 0.15 && Math.floor(fa / 0.05) !== 1) {
        c.fillStyle = INK;
        c.fillRect(0, 0, W, 1); c.fillRect(0, H - 1, W, 1); c.fillRect(0, 0, 1, H); c.fillRect(W - 1, 0, 1, H);
      }
    }
  }

  _icon(c, rows, x, y) {
    for (let r = 0; r < rows.length; r++) for (let k = 0; k < rows[r].length; k++) if (rows[r][k] === '#') c.fillRect(x + k, y + r, 1, 1);
  }

  // Wide LCDs: progress bar in the top row, BPM / time on the left, combo / judgement counts / accuracy meter on the right.
  _rails(game, t, now, fx, cmb) {
    const c = this.c, W = this.w, H = this.h, len = game.chart.length || 1;
    const p = Math.max(0, Math.min(1, t / len));
    const bx = 3 + textWidth(this._scoreTxt, true) + 8, bw = W - 2 - textWidth(this._accTxt) - 8 - bx;
    if (bw > 12) { // outline + fill
      c.fillStyle = INK;
      c.fillRect(bx, 2, bw, 1); c.fillRect(bx, 6, bw, 1); c.fillRect(bx, 2, 1, 5); c.fillRect(bx + bw - 1, 2, 1, 5);
      c.fillRect(bx + 2, 4, Math.round((bw - 4) * p), 1);
    }
    // left rail: BPM and time left, each under its icon
    const left = Math.max(0, Math.ceil(len - t));
    if (left !== this._timeS) { this._timeS = left; this._timeTxt = String((left / 60) | 0).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0'); }
    c.fillStyle = INK;
    this._icon(c, ICON_NOTE, 4, 30);
    this._text(c, 'BPM', 3, 43, INK, false);
    this._text(c, String(Math.round(game.chart.bpm || 0)), 3, 53, INK, true);
    this._icon(c, ICON_CLOCK, 4, 70);
    this._text(c, this._timeTxt, 3, 84, INK, true);
    // right rail: combo (centred over its label), judgement counts, accuracy meter
    const rx = W - 3, rl = W - RAIL_R + 2, rc = Math.round((rl + rx) / 2);
    const num = String(cmb), nw = textWidth(num, true) * 3;
    if (fx && now - this.popT < 0.1) {
      c.fillStyle = INK; c.fillRect(rc - (nw >> 1) - 2, 13, nw + 4, CAP * 3 + 4);
      this._text(c, num, rc, 15, PAPER, true, 3, 'center');
    } else this._text(c, num, rc, 15, INK, true, 3, 'center');
    this._text(c, tr('COMBO'), rc, 15 + CAP * 3 + 3, INK, true, 1, 'center');
    c.fillStyle = INK; c.fillRect(rl, 15 + CAP * 3 + 14, rx - rl, 1);
    let y = 15 + CAP * 3 + 20;
    for (const j of ['perfect', 'great', 'good', 'miss']) {
      this._text(c, tr(JUDGE_TEXT[j]), rl, y, INK, false);
      this._text(c, String(game.counts[j]), rx, y, INK, false, 1, 'right');
      y += 10;
    }
    // accuracy meter: ten segments, bottom up
    const mh = Math.min(H - y - 26, 70), mx = rx - 10;
    if (mh > 24) {
      const my = H - 8 - mh, segs = 10, fill = game.judgedCount ? Math.round(Math.max(0, Math.min(100, game.accuracy)) / 100 * segs) : 0; // starts empty
      this._text(c, tr('ACC'), rx, my - 10, INK, false, 1, 'right');
      c.fillStyle = INK;
      c.fillRect(mx, my, 10, 1); c.fillRect(mx, my + mh - 1, 10, 1); c.fillRect(mx, my, 1, mh); c.fillRect(mx + 9, my, 1, mh);
      const sh = (mh - 4) / segs;
      for (let i = 0; i < fill; i++) c.fillRect(mx + 2, Math.round(my + mh - 2 - (i + 1) * sh) + 1, 6, Math.max(1, Math.floor(sh) - 1));
    }
  }

  _hud(game, t, now) {
    const c = this.c, W = this.w, H = this.h;

    // Score counts up in steps toward the real value; strings are rebuilt only when the integer changes.
    this._dispScore += (game.score - this._dispScore) * 0.3;
    if (Math.abs(game.score - this._dispScore) < 1) this._dispScore = game.score;
    const shown = Math.round(this._dispScore);
    if (shown !== this._shownScore) { this._shownScore = shown; this._scoreTxt = String(shown).padStart(7, '0'); }
    const acc = game.accuracy;
    if (acc !== this._acc || game.grade !== this._grade) { this._acc = acc; this._grade = game.grade; this._accTxt = game.grade + ' ' + acc.toFixed(1) + '%'; }
    const cmb = game.combo;
    if (cmb !== this.lastCombo) {
      if (cmb > this.lastCombo && cmb >= 50 && cmb % 50 === 0) {
        if (this.comboPopup) {
          this._banner(tr('{n} COMBO', { n: cmb }), now);
          this.frameT = now; this.shakeT = now;
        }
      }
      if (cmb > this.lastCombo && cmb >= 10 && cmb % 10 === 0) this.popT = now;
      this.lastCombo = cmb;
      const m = game.multiplier > 1 ? ' x' + game.multiplier.toFixed(1) : '';
      this._comboTxt = tr('{n} COMBO', { n: cmb }) + m;
      this._comboShort = cmb + m;
    }

    const fx = this.juice && !this.reduced;
    if (game.score !== this._lastScore) { if (game.score > this._lastScore) this.bumpT = now; this._lastScore = game.score; }
    // Row 1: score + grade/accuracy (+ the progress bar between them on wide LCDs). Row 2: FC/AP (or the active mod chips) + combo.
    this._text(c, this._scoreTxt, 3, fx && now - this.bumpT < 0.06 ? 0 : 1, INK, true);
    this._text(c, this._accTxt, W - 2, 1, INK, false, 1, 'right');
    c.fillStyle = INK; c.fillRect(0, 10, W, 1);
    let tag = '';
    if (game.fcAlive && game.judgedCount >= 5) tag = tr(game.apAlive ? 'ALL PERFECT' : 'FULL COMBO');
    if (!tag) tag = this.modLabel;
    if (tag) this._text(c, tag, 3, 12, INK, false);
    if (this.rails) this._rails(game, t, now, fx, cmb);
    else if (cmb > 1) {
      // Fall back to the short form when the full string would collide with the left tag.
      const full = this._comboTxt;
      const fits = !tag || 3 + textWidth(tag) + 4 + textWidth(full, true) < W - 2;
      const str = fits ? full : this._comboShort;
      if (fx && now - this.popT < 0.1) { // every 10th combo: the counter flashes inverted
        const tw = textWidth(str, true);
        c.fillStyle = INK; c.fillRect(W - 3 - tw, 11, tw + 2, CAP + 3);
        this._text(c, str, W - 2, 12, PAPER, true, 1, 'right');
      } else this._text(c, str, W - 2, 12, INK, true, 1, 'right');
    } else if (fx && this._brokenTxt) {
      // Combo broke: the old counter stays up for a beat, struck through and flickering
      const ba = now - this.breakT;
      if (ba >= 0 && ba < 0.3) {
        if (Math.floor(ba / 0.05) % 2 === 0) {
          const tw = textWidth(this._brokenTxt, true);
          this._text(c, this._brokenTxt, W - 2, 12, INK, true, 1, 'right');
          c.fillStyle = INK; c.fillRect(W - 2 - tw, 15, tw, 1);
        }
      } else this._brokenTxt = '';
    }

    // Milestone banners over the highway
    const bx = Math.round(this.x0 + this.laneW * this.lanes / 2);
    // Simultaneous banners (e.g. two combo milestones) stack upward, newest at the base position.
    // Picked newest-first straight from the 3-slot pool (no per-frame filter/sort arrays).
    const bn = this.banners;
    let slot = 0, used = 0;
    for (;;) {
      let best = -1;
      for (let i = 0; i < bn.length; i++) {
        if (used & (1 << i)) continue;
        const age = now - bn[i].t;
        if (age < 0 || age > 1.2) continue;
        if (best < 0 || bn[i].t > bn[best].t) best = i;
      }
      if (best < 0) break;
      used |= 1 << best;
      this._box(c, bn[best].text, bx, Math.round(H * 0.4) - slot++ * (CAP + 8));
    }
  }
}
