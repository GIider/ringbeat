// Sign-in intro: a 5.8 s scene over the whole LCD (power-on, ripples, four rings that interlock like the four lanes, a burst, the player's name).
// Pure simulation like the cameos in cameo.js: a sim is { step(), draw(put), done, tick, ... }; it advances one tick per step()
// (20 Hz). runWelcome() is the only DOM piece: a canvas painted one cell per sim pixel.
import { GLYPHS } from './pixelfont.js';
import { SPRITES } from './pixelart.js';
import { INK } from './render.js';

export const CELL = 4;       // CSS px per LCD cell (same grid as the cameos)
export const TICK_MS = 50;
// Tick marks of the script (50 ms each): 5.8 s in all.
export const T = { RINGS: 16, SLIDE: 18, LOCK: 38, FLASH: 48, HOLD: 70, FADE: 76, TYPE: 78, TITLE: 102, CLEAR: 102, END: 116 };
export const HOLD_LIMIT = 120; // ticks the scene waits for the sign-in answer at T.HOLD before giving up (6 s)

const DITHER = 1.3; // dither level gained per tick while the scene dissolves (T.CLEAR to T.END)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)]; // 0-15: a cell is inked while bayer < level (0 empty ... 16 solid)

export function circle(put, cx, cy, r) {
  if (r < 1) { put(cx, cy); return; }
  let x = r, y = 0, e = 1 - r;
  while (x >= y) {
    put(cx + x, cy + y); put(cx + y, cy + x); put(cx - x, cy + y); put(cx - y, cy + x);
    put(cx + x, cy - y); put(cx + y, cy - x); put(cx - x, cy - y); put(cx - y, cy - x);
    y++;
    if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; }
  }
}
// Bresenham; `dash` > 0 inks `dash` cells, skips `dash`, shifted by `phase`.
function line(put, x0, y0, x1, y1, dash = 0, phase = 0) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (let i = 0; ; i++) {
    if (!dash || (i + phase) % (dash * 2) < dash) put(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
export const stamp = (put, rows, ox, oy) => rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') put(ox + x, oy + y); });

// The player's name in the 5x7 LCD font, centred on row `cy`; wraps onto two lines when a line won't fit.
// -> [{ ch, g, x, y }] in reading order (x, y = top-left of the cap line).
export function layoutName(name, w, cy) {
  const glyph = ch => GLYPHS[ch] || GLYPHS['?'] || GLYPHS[' '];
  const chars = [...String(name)].map(ch => ({ ch, g: glyph(ch) }));
  const width = cs => cs.reduce((n, c) => n + c.g.w + 1, -1);
  let lines = [chars];
  if (chars.length > 1 && width(chars) > w - 6) {
    const mid = chars.length >> 1;
    let cut = mid, best = Infinity;
    chars.forEach((c, i) => { if (c.ch === ' ' && Math.abs(i - mid) < best) { best = Math.abs(i - mid); cut = i; } });
    lines = [chars.slice(0, cut), chars.slice(cut + (chars[cut].ch === ' ' ? 1 : 0))];
  }
  const LINE = 12, top = Math.round(cy - (lines.length * LINE - 3) / 2);
  const out = [];
  lines.forEach((line, li) => {
    let x = Math.round((w - width(line)) / 2);
    for (const c of line) { out.push({ ch: c.ch, g: c.g, x, y: top + li * LINE }); x += c.g.w + 1; }
  });
  return out;
}

export function createWelcome(w, h) {
  const cx = w >> 1, cy = Math.round(h * 0.46);
  const R = Math.max(5, Math.min(13, Math.floor(Math.min(w, h) / 7))); // ring radius
  const sep = Math.round(R * 0.55);                                   // neighbouring ring centres are 2 * sep apart
  const RINGS = 4, spot = i => cx + Math.round((i - (RINGS - 1) / 2) * 2 * sep); // where ring i comes to rest
  const halfW = Math.round((RINGS - 1) * sep) + R + 2;                 // half the width of the linked row
  const maxR = Math.ceil(Math.hypot(w, h) / 2) + 2;
  const s = { tick: 0, hold: 0, done: false, ready: false, name: '', chars: [] };

  // Parks at T.HOLD (animation keeps looping) until the sign-in answer is known.
  s.step = () => {
    if (s.done) return;
    if (s.tick === T.HOLD && !s.ready) { s.hold++; return; }
    s.tick++;
    if (s.tick >= T.END) s.done = true;
  };
  s.release = name => { s.ready = true; s.name = name; s.chars = layoutName(name, w, cy); };
  // Reduced motion: jump over the show (never past the wait for the name).
  s.jump = t => { s.tick = Math.max(s.tick, Math.min(t, s.ready ? t : T.HOLD)); };

  s.draw = put0 => {
    const put = (x, y) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) put0(x, y); };
    const t = s.tick, a = t + s.hold;
    if (t < T.RINGS) { power(put, t, w, h); return; }

    // ripples: one every 8 ticks from the middle, plus one when the rings touch
    const births = [T.LOCK];
    for (let b = T.RINGS; b <= a; b += 8) if (t < T.FADE || b < T.FADE + s.hold) births.push(b);
    const fade = t >= T.CLEAR ? (t - T.CLEAR + 1) * DITHER : 0; // the last ticks dither everything out, ripples too
    const box = t >= T.TYPE && s.chars.length ? nameBox() : null; // ripples keep clear of the name
    const ripple = (x, y) => {
      if (fade && bayer(Math.round(x), Math.round(y)) < fade) return;
      if (box && x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]) return;
      put(x, y);
    };
    for (const b of births) { const r = (a - b) * 1.6; if (r > 0 && r < maxR) circle(ripple, cx, cy, Math.round(r)); }

    // the four rings slide in from the edges (two from each side) and interlock; blink as they lock; shrink away at the end
    const p = Math.min(1, Math.max(0, (t - T.SLIDE) / (T.LOCK - T.SLIDE))), e = 1 - (1 - p) * (1 - p);
    const lockBlink = t === T.LOCK + 3 || t === T.LOCK + 5;
    const shrink = t >= T.FADE ? 1 - (t - T.FADE) / 8 : 1;
    if (t >= T.SLIDE && !lockBlink && shrink > 0) {
      const r = Math.round(R * shrink);
      for (let i = 0; i < RINGS; i++) {
        const from = i < RINGS / 2 ? -R : w - 1 + R, rest = spot(i), x = cx + (from + (rest - from) * e - cx) * shrink;
        circle(put, Math.round(x), cy, r); circle(put, Math.round(x), cy, Math.max(0, r - 1));
      }
    }

    if (t === T.FLASH || t === T.FLASH + 1) fill(put, t === T.FLASH ? 17 : 9); // the flash: the whole LCD goes dark, then half
    if (t >= T.FLASH && t < T.FADE) burst(put, a);
    if (t >= T.TYPE) text(put, t);
  };

  const fill = (put, level) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bayer(x, y) < level) put(x, y); };
  const nameBox = () => {
    const xs = s.chars.map(c => c.x), ys = s.chars.map(c => c.y);
    return [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...s.chars.map(c => c.x + c.g.w)) + 3, Math.max(...ys) + 12];
  };

  function burst(put, a) {
    const k = a - T.FLASH;
    for (let i = 0; i < 12; i++) {
      const ang = i * Math.PI / 6 + a * 0.02, c = Math.cos(ang), n = Math.sin(ang);
      const r0 = 1 / Math.hypot(c / halfW, n / (R + 3)), len = Math.max(0, Math.min(maxR - r0, k * 3)); // rays start outside the linked row
      line(put, cx + c * r0, cy + n * r0, cx + c * (r0 + len), cy + n * (r0 + len), 2, a);
      if (i % 2 === 0 && k > 1) { // a note rides out along every other ray
        const r = r0 + 1 + ((a * 2 + i * 9) % Math.max(1, maxR - r0 - 1));
        stamp(put, SPRITES.note, Math.round(cx + c * r) - 3, Math.round(cy + n * r) - 3);
      }
    }
    for (let i = 0; i < 4; i++) { // data packets run in from the corners to the rings
      const sx = i & 1 ? w - 1 : 0, sy = i & 2 ? h - 1 : 0, q = ((k * 0.035 + i * 0.25) % 1) * 0.8;
      for (let j = 0; j < 6; j++) {
        if (j > 2 && j % 2) continue;
        const f = Math.max(0, q - j * 0.025);
        put(sx + (cx - sx) * f, sy + (cy - sy) * f);
      }
    }
  }

  // The name, typed in large; blinking caret; dithers out just before the menu opens.
  function text(put, t) {
    const n = s.chars.length, per = n > 8 ? 1 : 2, shown = Math.min(n, Math.floor((t - T.TYPE) / per) + 1);
    const level = t >= T.CLEAR ? (t - T.CLEAR + 1) * DITHER : 0;
    const vis = (x, y) => bayer(x, y) >= level;
    for (let i = 0; i < shown; i++) {
      const c = s.chars[i];
      c.g.rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const x = c.x + rx, y = c.y + ry - (c.g.up ? 1 : 0);
          if (row[rx] === '#' && vis(x, y)) put(x, y);
        }
      });
    }
    if (n && (t >> 1) % 2 === 0 && t < T.CLEAR) {
      const last = s.chars[Math.min(shown, n) - 1] || s.chars[0], x = shown < n ? s.chars[shown].x : last.x + last.g.w + 1, y = shown < n ? s.chars[shown].y : last.y;
      for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 3; xx++) put(x + xx, y + yy);
    }
  }

  return s;
}

// Power-on: the LCD fills with a dither ramp to solid ink (ticks 0-9), then wipes clear from the middle out (12 on).
export function power(put, t, w, h) {
  const level = t < 10 ? Math.ceil((t + 1) * 1.6) : 17, mid = h >> 1;
  for (let y = 0; y < h; y++) {
    if (t >= 12 && Math.abs(y - mid) < (t - 11) * (h / 8)) continue;
    for (let x = 0; x < w; x++) if (bayer(x, y) < level) put(x, y);
  }
}

// -- DOM: size the canvas to its parent in cells, and run a sim on it at TICK_MS --
export function measureGrid(canvas, cell = CELL) {
  const p = canvas.parentElement, w = Math.floor(p.clientWidth / cell), h = Math.floor(p.clientHeight / cell);
  canvas.width = w; canvas.height = h;
  canvas.style.width = w * cell + 'px'; canvas.style.height = h * cell + 'px';
  return { w, h };
}

// Paints the sim after every tick; onTick(sim) runs right after each step. -> stop() (clears the canvas).
export function runWelcome(canvas, sim, { onTick = () => {}, onDone = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = INK; // not the computed color: Dark Reader rewrites it light
  let raf = 0, stopped = false, last = performance.now(), acc = 0;
  const paint = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); sim.draw((x, y) => ctx.fillRect(x, y, 1, 1)); };
  const stop = () => { stopped = true; cancelAnimationFrame(raf); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  const frame = now => {
    if (stopped) return;
    acc += Math.min(now - last, 250); last = now; // a hidden tab doesn't fast-forward the show
    let stepped = false;
    while (acc >= TICK_MS && !sim.done) {
      sim.step(); onTick(sim); acc -= TICK_MS; stepped = true;
      if (stopped) return;
    }
    if (stepped) paint();
    if (sim.done) { stop(); onDone(); } else raf = requestAnimationFrame(frame);
  };
  paint();
  raf = requestAnimationFrame(frame);
  return stop;
}
