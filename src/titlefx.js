// Title screen: a Nokia 3310 drops onto the LCD and rings under the RINGBEAT logo, forever.
// Pure simulation like welcome.js: a sim is { step(), draw(put), tick, ... } advancing one tick per step() (20 Hz), painted by
// runWelcome(). The scene is a pure function of the tick, so a reduced-motion player gets one still frame (REST) instead.
import { GLYPHS, boldGlyph } from './pixelfont.js';
import { SPRITES } from './pixelart.js';
import { circle, bayer, stamp, power } from './welcome.js';

export const NAME = 'RINGBEAT';
// Tick marks (50 ms each): power-on, the phone falls, the letters land, then the ring cycle loops every LOOP ticks (8.4 s; a multiple of 6, 7, 12 and 24 so every rhythm in it repeats exactly).
export const T = { DROP: 16, LOGO: 24, RING: 42, LOOP: 168 };
export const REST = T.RING + 125; // the still frame: between two ring bursts, notes still in the air
const FALL = 7;
const BOUNCE = [0, -3, -5, -6, -5, -3, 0, -2, -3, -2, 0]; // heights (cells) of the two bounces after the fall
const PHONE = SPRITES.nokia, PW = PHONE[0].length, PH = PHONE.length;
const SCREEN = { x: 5, y: 7, w: 14, h: 12 };              // the LCD window inside the sprite
const LOGO_H = 7, GAP = 6;
const RESERVE = 30; // default rows at the bottom the DOM text ("Press any key", version, build) covers; main.js measures it

// Grid cells the whole scene (logo, gap, phone; sideways: the logo or the phone plus its sound waves) needs, so main.js can scale the
// cell up on big LCDs.
export const TITLE_EXTENT = { rows: LOGO_H + GAP + PH, cols: Math.max(PW + 24, [...NAME].reduce((n, ch) => n + boldGlyph(GLYPHS[ch]).w + 1, -1)) + 4 };

// Where everything sits on a w x h grid. `phone` is false on grids too short for the whole stack: the logo alone, centred.
export function layoutTitle(w, h, reserve = RESERVE) {
  const letters = [...NAME].map(ch => boldGlyph(GLYPHS[ch]));
  const lw = letters.reduce((n, g) => n + g.w + 1, -1);
  const avail = h - reserve, stack = LOGO_H + GAP + PH;
  const phone = avail >= stack && w >= PW + 24;
  const top = Math.max(1, Math.round((avail - (phone ? stack : LOGO_H)) / 2));
  let x = Math.round((w - lw) / 2);
  const chars = letters.map(g => { const c = { g, x, y: top }; x += g.w + 1; return c; });
  const cx = w >> 1, py = top + LOGO_H + GAP;
  return phone
    ? { phone, chars, px: cx - (PW >> 1), py, cx, cy: py + 10, hw: PW / 2 + 1, minY: top + LOGO_H + 2, maxY: avail }
    : { phone, chars, px: 0, py: 0, cx, cy: top + 3, hw: Math.ceil(lw / 2) + 2, minY: 0, maxY: avail };
}

// Height of the phone above its resting place `age` ticks after the drop begins (null before it, 0 once settled).
export function dropDy(age, rest) {
  if (age < 0) return null;
  if (age < FALL) return -Math.round((rest + PH + 2) * (1 - (age / FALL) ** 2));
  return BOUNCE[age - FALL] || 0;
}

const ringing = p => p >= 0 && p < 120 && p % 24 < 16; // p = ticks into the loop: two-thirds ring, a third of calm

// `invert`: the Scroll direction setting; the notes rise onto a hit line near the top of the LCD instead of falling onto one near the bottom.
export function createTitle(w, h, reserve, invert = false) {
  const L = layoutTitle(w, h, reserve);
  const s = { tick: 0, done: false, L };
  s.step = () => { s.tick++; };
  s.jump = t => { s.tick = Math.max(s.tick, t); };

  s.draw = put0 => {
    const put = (x, y) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) put0(x, y); };
    const t = s.tick;
    if (t < T.DROP) { power(put, t, w, h); return; }
    const p = t - T.RING;        // ticks into the ring cycle (negative during the intro)
    const q = p < 0 ? p : p % T.LOOP;

    if (L.phone) drawPhone(put, t, q);
    drawWaves(put, t);
    drawNotes(put, t);
    drawLogo(put, t, q);
  };

  function drawPhone(put, t, q) {
    const dy = dropDy(t - T.DROP, L.py);
    if (dy === null) return;
    const shake = ringing(q) ? (t & 1 ? 1 : -1) : 0, x0 = L.px + shake, y0 = L.py + dy;
    stamp(put, PHONE, x0, y0);
    if (t - T.DROP < FALL - 1) for (const x of [4, 12, 19]) for (let y = y0 - 8; y < y0 - 2; y += 2) put(x0 + x, y); // speed lines
    // the LCD: a four-lane highway, a note per lane falling onto the hit line, which flashes as it lands
    const sx = x0 + SCREEN.x, sy = y0 + SCREEN.y, hit = invert ? 2 : SCREEN.h - 3;
    for (let x = 0; x < SCREEN.w; x += 2) put(sx + x, sy + hit);
    for (let lane = 0; lane < 4; lane++) {
      const x = sx + 1 + lane * 3, f = (t + lane * 5) % SCREEN.h;
      if (f >= SCREEN.h - 1) continue; // passed the line
      const k = invert ? SCREEN.h - 1 - f : f;
      for (let dx = 0; dx < 2; dx++) for (let dy2 = 0; dy2 < 2; dy2++) put(x + dx, sy + k + dy2 - 1);
      if (k === hit) { put(x - 1, sy + hit - 1); put(x + 2, sy + hit - 1); put(x - 1, sy + hit + 1); put(x + 2, sy + hit + 1); }
    }
  }

  // Rings from the handset, left and right of it (never over the phone itself); each is born while it rings and thins out.
  function drawWaves(put, t) {
    if (t < T.RING) return;
    for (let age = 0; age < 10; age++) {
      const b = t - age, bp = (b - T.RING) % T.LOOP;
      if (b < T.RING || bp % 6 || !ringing(bp)) continue;
      const r = Math.round(L.hw + 2 + age * 1.7);
      circle((x, y) => {
        if (y < L.minY || y >= L.maxY || Math.abs(x - L.cx) <= L.hw || bayer(x, y) < age * 1.6) return;
        put(x, y);
      }, L.cx, L.cy, r);
    }
  }

  // Notes born every 7 ticks while it rings, rising and swaying away on both sides.
  function drawNotes(put, t) {
    for (let n = Math.max(0, Math.floor((t - T.RING - 28) / 7)); n <= Math.floor((t - T.RING) / 7); n++) {
      const born = T.RING + n * 7, age = t - born;
      if (age < 0 || age >= 28 || !ringing((born - T.RING) % T.LOOP)) continue;
      const side = n & 1 ? 1 : -1, sway = Math.round(2 * Math.sin(age * 0.4 + (n % 24)));
      const x = L.cx + side * (L.hw + 4 + sway), y = L.cy - 2 - age;
      if (y - 3 < L.minY || y + 3 >= L.maxY) continue;
      stamp(put, SPRITES.note, Math.round(x) - 3, Math.round(y) - 3);
    }
  }

  // RINGBEAT, one letter every other tick, dropping in; a glint sweeps over it; in the calm of every cycle it ripples.
  function drawLogo(put, t, q) {
    const shineAge = t < T.RING ? t - (T.LOGO + 18) : (t - T.RING + T.LOOP - 40) % T.LOOP;
    const glint = shineAge * 5 - 12;
    L.chars.forEach((c, i) => {
      const age = t - (T.LOGO + i * 2);
      if (age < 0) return;
      let dy = [-5, -2, 1, 0][Math.min(age, 3)];
      if (q >= 0 && q - 130 - i >= 0 && q - 130 - i < 2) dy = 1;
      c.g.rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          if (row[rx] !== '#') continue;
          const x = c.x + rx, y = c.y + ry + dy - (c.g.up ? 1 : 0);
          if (shineAge >= 0 && Math.abs(x + (y - c.y) * 2 - glint) < 2) continue; // the glint knocks the ink out
          put(x, y);
        }
      });
    });
  }
  return s;
}
