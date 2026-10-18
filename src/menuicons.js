// Main-menu hero art: one big animated 1-bit picture per item (64x48, 12 frames), drawn procedurally in the 3310's style.
// A frame is a list of equal-length rows ('#' = ink). Also here: the dithered copies the carousel shows for the neighbouring
// items and a small pattern tile per item for the scrolling backdrop.
import { SPRITES } from './pixelart.js';

export const ICON_W = 64, ICON_H = 48;
export const FRAME_COUNT = 12; // every icon loops over 12 frames

// ---- tiny raster helpers (grid = array of char arrays) ----
const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill('.'));
const rows = g => g.map(r => r.join(''));
function px(g, x, y, on = true) { if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = on ? '#' : '.'; }
function hline(g, x0, x1, y, on = true) { for (let x = x0; x <= x1; x++) px(g, x, y, on); }
function vline(g, x, y0, y1, on = true) { for (let y = y0; y <= y1; y++) px(g, x, y, on); }
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
function disc(g, cx, cy, r, on = true) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.8) px(g, cx + x, cy + y, on);
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
const wave = (f, phase = 0) => Math.sin((f / FRAME_COUNT) * 2 * Math.PI + phase); // one period per loop
const SPARK = [['...#...', '.......', '...#...', '#.###.#', '...#...', '.......', '...#...'], ['.......', '.......', '...#...', '..###..', '...#...', '.......', '.......']];
function spark(g, x, y, big) { stamp(g, SPARK[big ? 0 : 1], x - 3, y - 3); }

// ---- Tones: a 3310 rings and shakes, notes fly out of it ----
const PHONE = SPRITES.nokia; // 24x42, its LCD window inside at x 5..18, y 7..18
const SHAKE = [0, -1, 1, -1, 1, -1, 1, 0, 0, 0, 0, 0];
const QUAVER = ['...#..', '...##.', '...#.#', '...#..', '.###..', '####..', '.##...'];
const QUAVERS = [ // two beamed eighths
  '...#####',
  '...#...#',
  '...#...#',
  '...#...#',
  '.###.###',
  '########',
  '.##..##.',
];
function tones(g, f) {
  const ox = 4 + SHAKE[f], oy = 3;
  stamp(g, PHONE, ox, oy, true);
  // the phone's own LCD: an equaliser bouncing to the ring
  for (let i = 0; i < 4; i++) {
    const h = 2 + Math.round(4 * (1 + wave(f * 2, i * 1.4)));
    fill(g, ox + 6 + i * 3, oy + 18 - h + 1, 2, h);
  }
  if (SHAKE[f]) { // ring marks beside the phone while it shakes
    const s = f % 2;
    line(g, ox - 3 + s, oy + 4, ox - 1 + s, oy + 6); line(g, ox + 26 - s, oy + 4, ox + 24 - s, oy + 6);
  }
  // sound waves: arcs to the right, swelling out from the phone
  for (let k = 0; k < 3; k++) {
    const r = 6 + k * 5 + ((f >> 1) % 2), cx = ox + 20, cy = oy + 20;
    if ((f + k * 4) % 12 >= 8) continue;
    for (let a = -0.6; a <= 0.6; a += 0.04) px(g, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
  }
  // three notes rising up and out to the right, out of step
  for (let i = 0; i < 3; i++) {
    const p = (f + i * 4) % 12;
    if (p >= 10) continue;
    const x = 38 + Math.round(p * 2.1 + Math.sin(p * 0.9 + i) * 1.5), y = 30 - Math.round(p * 2.9);
    stamp(g, i === 1 ? QUAVERS : QUAVER, x, y, true);
  }
}

// ---- My songs: a pencil writes a tune on a staff ----
const STAFF = [16, 21, 26, 31, 36];
const HEAD = ['.###.', '#####', '#####', '.###.'];
const TUNE = [[14, 31], [25, 26], [36, 21], [47, 28]]; // note head x, centre y
const CLEF = [
  '..##.',
  '.#..#',
  '.#..#',
  '.#.#.',
  '.##..',
  '##...',
  '#.#..',
  '#.###',
  '#.#.#',
  '.##.#',
  '..##.',
  '..#..',
  '..#..',
  '#.#..',
  '.#...',
];
const PENCIL = [
  '.......###',
  '......#..#',
  '.....#..#.',
  '....#..#..',
  '...#..#...',
  '..#..#....',
  '.#..#.....',
  '##.#......',
  '###.......',
  '#.........',
];
function note(g, x, y) { stamp(g, HEAD, x, y - 2, true); vline(g, x + 4, y - 13, y); }
function mysongs(g, f) {
  for (const y of STAFF) hline(g, 3, 60, y);
  vline(g, 60, STAFF[0], STAFF[4]); vline(g, 58, STAFF[0], STAFF[4]);
  stamp(g, CLEF, 4, 14, true);
  const shown = f < 8 ? 1 + (f >> 1) : 4;
  TUNE.slice(0, shown).forEach(([x, y], i) => note(g, x, y - (f >= 8 && (f + i) % 2 ? 2 : 0)));
  if (shown >= 2) { // the first two share a beam
    const b = (f >= 8 && f % 2 ? 2 : 0), c = (f >= 8 && (f + 1) % 2 ? 2 : 0);
    line(g, TUNE[0][0] + 4, TUNE[0][1] - 13 - b, TUNE[1][0] + 4, TUNE[1][1] - 13 - c);
    line(g, TUNE[0][0] + 4, TUNE[0][1] - 12 - b, TUNE[1][0] + 4, TUNE[1][1] - 12 - c);
  }
  if (f < 8) { // writing: the pencil scribbles beside the newest note
    const [x, y] = TUNE[shown - 1];
    stamp(g, PENCIL, x + 6 + (f % 2), y - 9 + (f % 2), true);
  } else { // done: it lifts off up and to the right from where it stopped
    const [x, y] = TUNE[3], k = f - 7;
    stamp(g, PENCIL, x + 7 + k * 2, y - 9 - k * 5, true);
  }
}

// ---- Stats: a live bar chart, a star on the leader ----
const BASE = [12, 20, 15, 27, 21];
const STAR = ['...#...', '...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];
function stats(g, f) {
  vline(g, 5, 3, 43); hline(g, 5, 61, 43);
  for (let y = 11; y < 43; y += 8) px(g, 4, y);
  let top = 0, best = 0;
  const hs = BASE.map((b, i) => b + Math.round(3 * wave(f, i * 1.7)));
  hs.forEach((h, i) => { if (h > best) { best = h; top = i; } });
  hs.forEach((h, i) => {
    const x = 10 + i * 10, y = 43 - h;
    if (i % 2) { rect(g, x, y, 7, h); for (let j = y + 2; j < 43; j += 2) for (let k = x + 2 - (j % 4 ? 0 : 1); k < x + 6; k += 2) px(g, k, j); }
    else fill(g, x, y, 7, h);
  });
  const sx = 10 + top * 10, sy = 43 - best - 10 + (f % 4 < 2 ? 0 : -1);
  stamp(g, STAR, sx, sy);
  if (f % 6 < 3) { px(g, sx - 2, sy + 1); px(g, sx + 8, sy + 2); } else { px(g, sx - 1, sy - 1); px(g, sx + 9, sy); }
}

// ---- Messages: the envelope opens and a letter peeks out; unread: it jitters with a badge ----
const EX = 12, EY = 20, EW = 38, EH = 23;
const FLAP = [13, 6, -3, -9, -9, -9, -9, -9, -9, -9, -3, 6]; // where the flap's tip is (below the top edge = shut)
const PEEK = [0, 0, 0, 0, 4, 8, 11, 12, 11, 8, 4, 0]; // rows of letter above the envelope
const JITTER = [0, 1, -1, 1, -1, 0, 0, 0, 0, 0, 0, 0];
const SPARKS = [[4, 12, 0], [56, 4, 3], [60, 34, 6], [30, 6, 9], [6, 40, 4]]; // x, y, phase: twinkling out of step
const flap = (g, x, y, tip) => { line(g, x, y, x + 18, y + tip); line(g, x + EW - 1, y, x + EW - 19, y + tip); };
// The envelope body; `tip` > 0 draws the flap folded down over its front.
function envelope(g, x, y, tip = 13) {
  fill(g, x, y, EW, EH, false);
  rect(g, x, y, EW, EH);
  if (tip > 0) flap(g, x, y, tip);
}
function messages(g, f, { unread = false } = {}) {
  if (unread) {
    const x = EX + JITTER[f];
    envelope(g, x, EY);
    disc(g, x + EW, EY, 6); // the "new" badge with a ! knocked out of it
    vline(g, x + EW, EY - 3, EY + 1, false); px(g, x + EW, EY + 3, false);
    for (const [sx, sy, ph] of SPARKS) { const k = (f + ph) % 12; if (k < 4) spark(g, sx, sy, k === 1 || k === 2); }
    return;
  }
  const r = PEEK[f], tip = FLAP[f];
  if (tip <= 0) flap(g, EX, EY, tip); // an open flap stands up behind the letter
  if (r) { // the letter rising out
    const lx = EX + 7, lw = EW - 14, ly = EY - r;
    fill(g, lx, ly, lw, r + 2, false); rect(g, lx, ly, lw, r + 6);
    [[3, 16], [6, 19], [9, 11]].forEach(([dy, len]) => { if (dy < r) hline(g, lx + 3, lx + 3 + len, ly + dy); });
  }
  envelope(g, EX, EY, tip);
}

// ---- Profile: two players trade places, the one in front wears the crown ----
const BUST = [
  '.......#######.......',
  '......#.......#......',
  '.....#.........#.....',
  '.....#.........#.....',
  '.....#.........#.....',
  '.....#.........#.....',
  '.....#.........#.....',
  '......#.......#......',
  '.......#######.......',
  '.........###.........',
  '.....###########.....',
  '...##...........##...',
  '..#...............#..',
  '.#.................#.',
  '.#.................#.',
  '#...................#',
  '#...................#',
  '#...................#',
  '#####################',
];
const CROWN = ['#..#..#', '#.###.#', '#######', '#######'];
const SWAP = [0, 0, 0, 1 / 4, 1 / 2, 3 / 4, 1, 1, 1, 3 / 4, 1 / 2, 1 / 4];
function profile(g, f) {
  const t = SWAP[f], a = [8, 24], b = [34, 13];
  // the x moves ease in for both, so they stay apart half way instead of passing through each other
  const p1 = [lerp(a[0], b[0], t * t), lerp(a[1], b[1], t)], p2 = [lerp(b[0], a[0], t * t), lerp(b[1], a[1], t)];
  const [front, back] = t < 0.5 ? [p1, p2] : [p2, p1];
  stamp(g, BUST, back[0], back[1]);
  stamp(g, BUST, front[0], front[1], true);
  stamp(g, CROWN, front[0] + 7, front[1] - 6, true);
  if (f === 0 || f === 6) spark(g, front[0] + 17, front[1] - 7, true);
  if (f === 1 || f === 7) spark(g, front[0] + 17, front[1] - 7, false);
  if (t > 0 && t < 1) { // swap arrows on the right
    vline(g, 58, 10, 20); line(g, 55, 13, 58, 10); line(g, 61, 13, 58, 10);
    vline(g, 58, 26, 36); line(g, 55, 33, 58, 36); line(g, 61, 33, 58, 36);
  }
}

// ---- Settings: two gears meshing ----
// A gear: a toothed rim, a hub and four spokes, turned by `ang` radians.
function gear(g, cx, cy, rOut, rIn, hole, teeth, ang) {
  for (let y = -rOut - 1; y <= rOut + 1; y++) for (let x = -rOut - 1; x <= rOut + 1; x++) {
    const r = Math.hypot(x, y), a = Math.atan2(y, x) - ang;
    const rim = r <= rIn && r > rIn - 3, tooth = r <= rOut && r > rIn - 1 && Math.cos(a * teeth) > 0.2;
    const hub = r > hole && r <= (rIn > 9 ? hole + 2.5 : rIn), spoke = rIn > 9 && r <= rIn && r > hole && Math.abs(Math.sin(a * 2)) < 0.2; // small gears are solid
    if (rim || tooth || hub || spoke) px(g, cx + x, cy + y);
  }
}
function settings(g, f) {
  const step = f / FRAME_COUNT; // each gear turns exactly one tooth per loop, the pair stays meshed
  gear(g, 26, 28, 16, 12.5, 3, 10, step * 2 * Math.PI / 10);
  gear(g, 45, 15, 10, 7, 2, 6, -step * 2 * Math.PI / 6 + Math.PI / 6);
}

// ---- Admin (dev only): a shield with a keyhole, a glint sweeping across ----
const SX = 16, SY = 4, SW = 32, SH = 40;
function inShield(x, y) {
  if (x < 0 || x >= SW || y < 0 || y >= SH) return false;
  if (y < 18) return y > 0 || (x > 1 && x < SW - 2);
  const hw = (SW / 2) * (1 - ((y - 18) / (SH - 18)) ** 2);
  return Math.abs(x + 0.5 - SW / 2) <= hw;
}
function admin(g, f) {
  const c = -26 + f * 9; // the glint band: x - y = c
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    if (!inShield(x, y)) continue;
    const edge = !inShield(x - 2, y) || !inShield(x + 2, y) || !inShield(x, y - 2) || !inShield(x, y + 2);
    const d = x - y - c;
    if (edge || (f < 8 && d >= 0 && d < 3)) px(g, SX + x, SY + y);
  }
  disc(g, 32, 19, 4); // keyhole
  for (let y = 22; y <= 30; y++) hline(g, 32 - 1 - ((y - 22) >> 2), 32 + 1 + ((y - 22) >> 2), y);
  if (f === 8 || f === 9) spark(g, SX + SW - 3, SY + 3, f === 8);
}

const SYMBOLS = { tones, mysongs, stats, messages, profile, settings, admin };
export const MENU_IDS = Object.keys(SYMBOLS);

// One frame (any integer n, wraps) of a menu icon -> rows. Frames are cached: the menu repaints one every tick.
const cache = new Map();
export function menuFrame(id, n = 0, opts = {}) {
  const f = ((n % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT, key = `${id}/${f}/${opts.unread ? 1 : 0}`;
  let out = cache.get(key);
  if (!out) {
    const g = grid(ICON_W, ICON_H);
    SYMBOLS[id](g, f, opts);
    cache.set(key, out = rows(g));
  }
  return out;
}
// All frames of an icon side by side in one sprite (cached): the menu shows one by moving the mask, so stepping the
// animation never swaps the image (a newly swapped image can flash blank while the browser decodes it).
const sheets = new Map();
export function menuSheet(id, opts = {}) {
  const key = id + (opts.unread ? '/u' : '');
  let out = sheets.get(key);
  if (!out) {
    const fr = menuFrames(id, opts);
    sheets.set(key, out = fr[0].map((_, y) => fr.map(f => f[y]).join('')));
  }
  return out;
}
// Every distinct frame of an icon (for tests and preloading).
export const menuFrames = (id, opts) => Array.from({ length: FRAME_COUNT }, (_, n) => menuFrame(id, n, opts));

// Half the ink in a checker: how the carousel greys out the items above and below the current one.
export const ditherRows = rows => rows.map((r, y) => [...r].map((c, x) => (c === '#' && (x + y) % 2 === 0 ? '#' : '.')).join(''));

// The dithered first frame of an item, as the carousel shows it above or below the current one (cached).
const peeks = new Map();
export function menuPeek(id, unread = false) {
  const key = id + (unread ? '/u' : '');
  let out = peeks.get(key);
  if (!out) peeks.set(key, out = ditherRows(menuFrame(id, 0, { unread })));
  return out;
}

// Backdrop tiles (16x16, repeated across the LCD behind the current item): a small motif and an offset accent.
const TILES = {
  tones: ['...#............', '...##...........', '...#.#..........', '...#............', '.###............', '####............', '.##.............', '................', '................', '.........#####..', '.........#...#..', '.........#...#..', '.......###.###..', '......########..', '.......##..##...', '................'],
  mysongs: ['................', '..##............', '.####...........', '.####...........', '..##............', '................', '................', '................', '################', '................', '................', '...........##...', '..........####..', '..........####..', '...........##...', '................'],
  stats: ['................', '.....#..........', '.....#..........', '.#...#..........', '.#.#.#..........', '.#.#.#..........', '######..........', '................', '................', '................', '.........#......', '.........#.#....', '.......#.#.#....', '.......#.#.#....', '......######....', '................'],
  messages: ['................', '.#######........', '.##...##........', '.#.#.#.#........', '.#..#..#........', '.#######........', '................', '................', '................', '................', '.........#######', '.........##...##', '.........#.#.#.#', '.........#..#..#', '.........#######', '................'],
  profile: ['................', '..###...........', '.#...#..........', '..###...........', '.#####..........', '#.....#.........', '#######.........', '................', '................', '..........###...', '.........#...#..', '..........###...', '.........#####..', '........#.....#.', '........#######.', '................'],
  settings: ['................', '...#.#..........', '..#####.........', '.##...##........', '..#...#.........', '.##...##........', '..#####.........', '...#.#..........', '................', '................', '..........#.....', '.........###....', '..........#.....', '................', '................', '................'],
  admin: ['................', '.#####..........', '.#...#..........', '.#.#.#..........', '..#.#...........', '...#............', '................', '................', '................', '..........##....', '.........#..#...', '.........#..#...', '..........##....', '...........#....', '...........##...', '................'],
};
export const menuTile = id => TILES[id];

// ---- Messages screens ----
export const PERSON_ART = [
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
