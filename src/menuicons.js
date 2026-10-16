// Main-menu art in the style of the 3310's menu: a folder card holding the item's symbol, and a hand pressing a key
// beside it. Each icon is a list of equal-size frames ('#' = ink); menuFrame() composes card + symbol + hand.
import { SPRITES } from './pixelart.js';

export const ICON_W = 44, ICON_H = 21;
const CARD_W = 30, CARD_H = 20, CARD_Y = 1;

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

// ---- shared parts ----
// Folder card with a tab on the top left; the inside is x 2..27, y 4..17 (in card coordinates).
function card(g) {
  const y = CARD_Y, w = CARD_W, h = CARD_H;
  hline(g, 2, 7, y); px(g, 1, y + 1); px(g, 8, y + 1);
  px(g, 0, y + 2); hline(g, 9, w - 2, y + 2);
  vline(g, 0, y + 2, y + h - 2); vline(g, w - 1, y + 3, y + h - 2);
  hline(g, 1, w - 2, y + h - 1);
}
// A hand beside the card, finger pointing down at a key; odd frames press it.
const HAND = [
  '..########..',
  '..#......#..',
  '..########..',
  '.#........#.',
  '#..........#',
  '#..........#',
  '#..........#',
  '.#.#.#.....#',
  '..#.#.##...#',
  '.......#...#',
  '.......#...#',
  '.......#...#',
  '........###.',
];
function hand(g, n) {
  const x = 31, down = ((n % 2) + 2) % 2;
  stamp(g, HAND, x, 2 + down, true);
  // key cap under the finger (squashed while pressed), with click sparks
  if (down) { rect(g, x + 5, 17, 7, 3); px(g, x + 4, 16); px(g, x + 12, 16); }
  else rect(g, x + 5, 16, 7, 4);
}

// ---- symbols (drawn in icon coordinates; the card's inside is x 2..27, y 5..18) ----
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
function tones(g, n) {
  const b = [0, -1, 0, 1][n];
  stamp(g, NOTE_PAIR, 6, 7 + b);
  // sound waves to the right, growing then fading
  if (n >= 1 && n <= 2) { vline(g, 22, 9, 13); }
  if (n === 2) { px(g, 24, 8); vline(g, 25, 9, 13); px(g, 24, 14); }
}
function mysongs(g, n) {
  for (let i = 0; i < 5; i++) hline(g, 3, 26, 7 + i * 2);
  const heads = [[6, 13], [10, 11], [14, 9], [18, 11]];
  const shown = n + 1;
  heads.slice(0, shown).forEach(([x, y]) => { fill(g, x, y, 3, 2); vline(g, x + 2, y - 4, y); });
  const [hx, hy] = heads[Math.min(shown, heads.length) - 1];
  stamp(g, SPRITES.custom, hx + 3, hy - 6, true); // the pencil follows the last note
}
const BARS = [4, 8, 6, 11, 9];
function stats(g, n) {
  hline(g, 3, 26, 17);
  vline(g, 3, 6, 17);
  const k = [0.35, 0.65, 1, 1][n];
  BARS.forEach((h, i) => { const bh = Math.max(1, Math.round(h * k)); fill(g, 6 + i * 4, 17 - bh, 3, bh); });
}
function envelopeClosed(g, x, y) {
  rect(g, x, y, 18, 11);
  line(g, x + 1, y + 1, x + 8, y + 7); line(g, x + 16, y + 1, x + 9, y + 7);
}
function envelopeOpen(g, x, y) {
  // flap folded up behind, a letter half out, then the envelope's front pocket over it
  line(g, x, y + 5, x + 8, y); line(g, x + 17, y + 5, x + 9, y);
  fill(g, x + 3, y + 1, 12, 9, false); rect(g, x + 3, y + 1, 12, 9);
  hline(g, x + 5, x + 12, y + 3); hline(g, x + 5, x + 10, y + 5);
  fill(g, x, y + 7, 18, 9, false);
  rect(g, x, y + 5, 18, 11);
  fill(g, x + 1, y + 6, 16, 1, false);
  line(g, x + 1, y + 14, x + 6, y + 9); line(g, x + 16, y + 14, x + 11, y + 9);
}
function messages(g, n, { unread = false } = {}) {
  if (unread) { // closed envelope that rattles, with "new" marks
    envelopeClosed(g, n % 2 ? 6 : 5, 6);
    if (n % 2) { px(g, 3, 5); px(g, 2, 4); px(g, 26, 5); px(g, 27, 4); vline(g, 14, 2, 3); }
  } else if (n < 2) envelopeClosed(g, 5, 6);
  else envelopeOpen(g, 5, 2);
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
function profile(g, n) {
  // two players trading places: the one in front swaps every other frame
  const a = [6, 6], b = [14, 4];
  const [front, back] = n < 2 ? [a, b] : [b, a];
  stamp(g, PERSON, back[0], back[1] + 3);
  stamp(g, PERSON, front[0], front[1] + 3, true);
  if (n % 2) { hline(g, 23, 26, 7); px(g, 25, 6); px(g, 25, 8); hline(g, 23, 26, 11); px(g, 24, 10); px(g, 24, 12); }
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
function gear(g, cx, cy, turn) {
  for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
    const r = Math.hypot(x, y), a = Math.atan2(y, x) + turn * Math.PI / 8;
    const tooth = Math.cos(a * 4 * 2) > 0.35; // 8 teeth
    if (r <= 1.6) continue; // axle hole
    if (r <= 4.6 || (r <= 6.6 && tooth)) px(g, cx + x, cy + y);
  }
}
function settings(g, n) {
  stamp(g, WRENCH, 4 + (n % 2), 7 - (n % 2));
  gear(g, 19, 11, n);
}

const SYMBOLS = { tones, mysongs, stats, messages, profile, settings };
const FRAMES = { tones: 4, mysongs: 4, stats: 4, messages: 4, profile: 4, settings: 2 };
export const MENU_IDS = Object.keys(SYMBOLS);

// One frame (any integer n, wraps) of a menu icon -> rows.
export function menuFrame(id, n = 0, opts = {}) {
  const g = grid(ICON_W, ICON_H);
  const f = ((n % FRAMES[id]) + FRAMES[id]) % FRAMES[id];
  card(g);
  SYMBOLS[id](g, f, opts);
  hand(g, n);
  return rows(g);
}
// Every distinct frame of an icon (for tests and preloading).
export const menuFrames = (id, opts) => Array.from({ length: Math.max(2, FRAMES[id]) * 2 }, (_, n) => menuFrame(id, n, opts));

// ---- Messages screens ----
export const PERSON_ART = PERSON;
// The big envelope on the "Opening message" screen: closed, then opening, then open.
export function letterFrame(n) {
  const g = grid(20, 17);
  if (n <= 0) envelopeClosed(g, 1, 6);
  else if (n === 1) { envelopeClosed(g, 1, 6); fill(g, 2, 7, 16, 3, false); line(g, 1, 6, 9, 2); line(g, 18, 6, 10, 2); }
  else envelopeOpen(g, 1, 1);
  return rows(g);
}
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
