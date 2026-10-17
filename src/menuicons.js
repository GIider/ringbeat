// Main-menu art in the style of the 3310's menu: a small 3310 on the left (its LCD reacts) and the item's animated symbol
// beside it. Each icon is a list of equal-size frames ('#' = ink); menuFrame() composes phone + symbol.
import { SPRITES } from './pixelart.js';

export const ICON_W = 44, ICON_H = 21;
const SYM_X = 14, SYM_W = ICON_W - SYM_X; // the symbol's own 30x21 canvas, blitted beside the phone
const FRAME_COUNT = 8; // every icon loops over 8 frames

// ---- tiny raster helpers (grid = array of char arrays) ----
const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill('.'));
const rows = g => g.map(r => r.join(''));
function px(g, x, y, on = true) { if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = on ? '#' : '.'; }
function hline(g, x0, x1, y) { for (let x = x0; x <= x1; x++) px(g, x, y); }
function vline(g, x, y0, y1) { for (let y = y0; y <= y1; y++) px(g, x, y); }
function rect(g, x, y, w, h) { hline(g, x, x + w - 1, y); hline(g, x, x + w - 1, y + h - 1); vline(g, x, y, y + h - 1); vline(g, x + w - 1, y, y + h - 1); }
function fill(g, x, y, w, h, on = true) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(g, i, j, on); }
function line(g, x0, y0, x1, y1) { // Bresenham
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(g, x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// Stamp a sprite; `solid` first clears each row between its outermost ink pixels so it hides what is behind it.
function stamp(g, spr, ox, oy, solid = false) {
  spr.forEach((r, y) => {
    const a = r.indexOf('#'), b = r.lastIndexOf('#');
    if (solid && a >= 0) for (let x = a; x <= b; x++) px(g, ox + x, oy + y, false);
    for (let x = 0; x < r.length; x++) if (r[x] === '#') px(g, ox + x, oy + y);
  });
}
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// ---- the phone ----
// A small 3310 like SPRITES.nokia: earpiece, LCD window (interior x 4..8, y 4..6), Navi key, 4 rows of keys.
export const PHONE_S = [
  '..#########..',
  '.#.........#.',
  '.#.........#.',
  '.#.#######.#.',
  '.#.#.....#.#.',
  '.#.#.....#.#.',
  '.#.#.....#.#.',
  '.#.#######.#.',
  '.#.........#.',
  '.#...###...#.',
  '.#.........#.',
  '.#..#.#.#..#.',
  '.#.........#.',
  '.#..#.#.#..#.',
  '.#.........#.',
  '.#..#.#.#..#.',
  '.#.........#.',
  '.#..#.#.#..#.',
  '.#.........#.',
  '..#.......#..',
  '...#######...',
];
// What the phone's LCD shows for the item (f = frame 0..7).
function lcd(g, id, f, unread) {
  switch (id) {
    case 'tones': if (f % 2) { px(g, 4, 5); px(g, 8, 5); px(g, 6, 5); } else { px(g, 5, 5); px(g, 7, 5); } break;
    case 'mysongs': hline(g, 4, 4 + (f >> 1), 5); break;
    case 'stats': [0, 1, 2].forEach(i => { const h = 1 + ((f + i * 2) % 3); fill(g, 4 + i * 2, 7 - h, 1, h); }); break;
    case 'messages': rect(g, 4, 4, 5, 3); if (f >= 2 && f <= 5) px(g, 6, 5); break;
    case 'profile': px(g, 5, 4); px(g, 7, 4); if (f % 4 < 2) hline(g, 5, 7, 6); else px(g, 6, 6); break;
    case 'settings': px(g, 6, 5); if (f % 2) { px(g, 6, 4); px(g, 5, 5); px(g, 7, 5); px(g, 6, 6); } else { px(g, 5, 4); px(g, 7, 4); px(g, 5, 6); px(g, 7, 6); } break;
    case 'admin': rect(g, 5, 5, 3, 2); if (f % 2) px(g, 6, 4); break;
  }
}

// ---- symbols (drawn on their own 30x21 canvas; the usual area is x 2..27, y 5..18) ----
const NOTE_PAIR = [ // beamed eighth notes
  '...##########',
  '...##########',
  '...#........#',
  '...#........#',
  '...#........#',
  '.###......###',
  '####.....####',
  '####.....####',
  '.##.......##.',
];
const BOB = [0, -1, -1, -1, 0, 1, 1, 1];
const WAVES = [0, 1, 2, 3, 3, 2, 1, 0]; // how many sound waves are showing
function tones(g, n) {
  stamp(g, NOTE_PAIR, 4, 7 + BOB[n]);
  // sound waves to the right, growing then fading
  for (let k = 0; k < WAVES[n]; k++) {
    const x = 20 + k * 3, h = 2 + k;
    vline(g, x, 11 - h, 11 + h); px(g, x - 1, 11 - h); px(g, x - 1, 11 + h);
  }
}
const HEADS = [[6, 13], [10, 11], [14, 9], [18, 11]];
function mysongs(g, n) {
  for (let i = 0; i < 5; i++) hline(g, 3, 26, 7 + i * 2);
  const shown = 1 + (n >> 1);
  HEADS.slice(0, shown).forEach(([x, y]) => { fill(g, x, y, 3, 2); vline(g, x + 2, y - 4, y); });
  const [hx, hy] = HEADS[shown - 1];
  stamp(g, SPRITES.custom, hx + 3, hy - 6 + (n % 2), true); // the pencil follows the last note, scribbling
}
const BARS = [4, 8, 6, 11, 9];
const GROW = [0.3, 0.6, 0.85, 1, 1, 1, 0.85, 0.6];
function stats(g, n) {
  hline(g, 3, 26, 17);
  vline(g, 3, 6, 17);
  BARS.forEach((h, i) => { const bh = Math.max(1, Math.round(h * GROW[n])); fill(g, 6 + i * 4, 17 - bh, 3, bh); });
}
function envelopeClosed(g, x, y) {
  rect(g, x, y, 18, 11);
  line(g, x + 1, y + 1, x + 8, y + 7); line(g, x + 16, y + 1, x + 9, y + 7);
}
const PEEK = [0, 1, 2, 3, 3, 2, 1, 0]; // read: how many rows of letter show above the envelope
const BADGE = [0, 1, 2, 2, 2, 2, 1, 0]; // unread: a small "new" spark gently grows and fades
function messages(g, n, { unread = false } = {}) {
  if (unread) { // closed envelope, still, with the spark at its corner
    envelopeClosed(g, 5, 6);
    if (BADGE[n] >= 1) px(g, 25, 5);
    if (BADGE[n] >= 2) { px(g, 24, 5); px(g, 26, 5); px(g, 25, 4); px(g, 25, 6); }
  } else { // read: the envelope stays shut and a letter slides up out of it and back
    const r = PEEK[n], top = 6 - r;
    if (r) { vline(g, 8, top, 6); vline(g, 19, top, 6); hline(g, 8, 19, top); }
    if (r >= 3) hline(g, 10, 17, top + 2);
    envelopeClosed(g, 5, 6);
  }
}
const PERSON = [
  '....###....',
  '...#...#...',
  '..#.....#..',
  '..#.....#..',
  '...#...#...',
  '....###....',
  '..#######..',
  '.#.......#.',
  '#.........#',
  '#.........#',
  '###########',
];
const SWAP = [0, 0, 1 / 3, 2 / 3, 1, 1, 2 / 3, 1 / 3];
function profile(g, n) {
  // two players trading places: they slide past each other and the one in front changes halfway
  const t = SWAP[n], a = [6, 6], b = [14, 4];
  const p1 = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], p2 = [lerp(b[0], a[0], t), lerp(b[1], a[1], t)];
  const [front, back] = t < 0.5 ? [p1, p2] : [p2, p1];
  stamp(g, PERSON, back[0], back[1] + 3);
  stamp(g, PERSON, front[0], front[1] + 3, true);
  if (n === 1 || n === 5) { hline(g, 23, 26, 7); px(g, 25, 6); px(g, 25, 8); hline(g, 23, 26, 11); px(g, 24, 10); px(g, 24, 12); }
}
const WRENCH = [
  '......#..#',
  '......#..#',
  '......####',
  '.....##...',
  '....##....',
  '...##.....',
  '..##......',
  '.##.......',
  '##........',
  '#.........',
];
const NUDGE = [0, 0, 1, 1, 1, 1, 0, 0];
function gear(g, cx, cy, turn) {
  for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
    const r = Math.hypot(x, y), a = Math.atan2(y, x) + turn * Math.PI / 8;
    const tooth = Math.cos(a * 4 * 2) > 0.35; // 8 teeth
    if (r <= 1.6) continue; // axle hole
    if (r <= 4.6 || (r <= 6.6 && tooth)) px(g, cx + x, cy + y);
  }
}
function settings(g, n) {
  stamp(g, WRENCH, 4 + NUDGE[n], 7 - NUDGE[n]);
  gear(g, 19, 11, n / 4); // eight teeth: a quarter step per frame loops after two whole steps
}

const SHIELD = [
  '#############',
  '#...........#',
  '#...........#',
  '#...........#',
  '#...........#',
  '#...........#',
  '.#.........#.',
  '..#.......#..',
  '...#.....#...',
  '....#####....',
];
// Dev-only admin app: a shield with a keyhole; the shine sweeps across it.
function admin(g, n) {
  stamp(g, SHIELD, 8, 5);
  if (n >= 1 && n <= 6) { // diagonal glint, skipping the keyhole
    const sx = 9 + (n - 1) * 2;
    for (let i = 0; i < 4; i++) if (sx + i < 13 || sx + i > 15) px(g, sx + i, 11 - i);
  }
  fill(g, 13, 8, 3, 3); vline(g, 14, 11, 13);
}

const SYMBOLS = { tones, mysongs, stats, messages, profile, settings, admin };
export const MENU_IDS = Object.keys(SYMBOLS);

// One frame (any integer n, wraps) of a menu icon -> rows.
export function menuFrame(id, n = 0, opts = {}) {
  const g = grid(ICON_W, ICON_H), sym = grid(SYM_W, ICON_H);
  const f = ((n % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
  SYMBOLS[id](sym, f, opts);
  sym.forEach((r, y) => r.forEach((c, x) => { if (c === '#') px(g, SYM_X + x, y); }));
  stamp(g, PHONE_S, 0, 0);
  lcd(g, id, f, !!opts.unread);
  return rows(g);
}
// Every distinct frame of an icon (for tests and preloading).
export const menuFrames = (id, opts) => Array.from({ length: FRAME_COUNT }, (_, n) => menuFrame(id, n, opts));

// ---- Messages screens ----
export const PERSON_ART = PERSON;
// Inbox row icons, 14x9 like the status-bar envelope: sealed (unread) and opened (read).
export const ENVELOPE_SMALL_OPEN = [
  '......##......',
  '....##..##....',
  '..##......##..',
  '.############.',
  '.#..........#.',
  '.##........##.',
  '.#.##....##.#.',
  '.#...####...#.',
  '.############.',
];
