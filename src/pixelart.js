// 1-bit LCD sprites ('#' = ink). Rendered as crisp SVG data-URIs and used in the DOM as CSS masks,
// so one sprite works in any ink colour (normal rows, inverted highlight bars, the dark play area).

const S = {
  // a Nokia 3310: tapered top with the earpiece, the LCD window, the Navi key with C and up/down, the 3x4 keypad, rounded bottom.
  // The LCD interior (cols 5-18, rows 7-18) stays empty: the title animation draws into it.
  nokia: [
    '......############......',
    '....##............##....',
    '..##................##..',
    '.#....................#.',
    '.#.....##########.....#.',
    '.#....................#.',
    '.#..################..#.',
    ...Array(12).fill('.#..#..............#..#.'),
    '.#..################..#.',
    '.#....................#.',
    '.#....................#.',
    '.#......########......#.',
    '.#.###.#........#.###.#.',
    '.#.###.#........#.###.#.',
    '.#......########......#.',
    '.#....................#.',
    ...[0, 1, 2, 3].flatMap(() => ['.#.####...####...####.#.', '.#.####...####...####.#.', '.#....................#.']),
    '..#..................#..',
    '...##..............##...',
    '.....##############.....',
  ],
  note: [
    '..#...',
    '..##..',
    '..#.#.',
    '..#..#',
    '..#...',
    '###...',
    '###...',
  ],
  // category icons, cap height (7 rows)
  classical: [
    '..#####',
    '..#...#',
    '..#...#',
    '..#...#',
    '###.###',
    '###.###',
    '.......',
  ],
  pop: [
    '...#...',
    '..###..',
    '#######',
    '.#####.',
    '..###..',
    '.##.##.',
    '.#...#.',
  ],
  dance: [
    '...#...',
    '#..#..#',
    '.#.#.#.',
    '..###..',
    '.#.#.#.',
    '#..#..#',
    '...#...',
  ],
  ndw: [
    '#.....#',
    '##...##',
    '#.#.#.#',
    '#..#..#',
    '#.....#',
    '#.....#',
    '#.....#',
  ],
  screen: [
    '.#...#.',
    '..#.#..',
    '#######',
    '#.....#',
    '#.....#',
    '#.....#',
    '#######',
  ],
  videogame: [
    '.........',
    '.#######.',
    '##.###.##',
    '#...#.#.#',
    '##.###.##',
    '###...###',
    '.##...##.',
  ],
  folk: [
    '......#',
    '.....#.',
    '....#..',
    '.##.#..',
    '####...',
    '####...',
    '.##....',
  ],
  custom: [
    '.....##',
    '....###',
    '...###.',
    '..###..',
    '.###...',
    '##.....',
    '#......',
  ],
  // the developer (IMEI easter egg), from their pixel avatar
  avatar: [
    '...................##...........................',
    '...................#.........#.#................',
    '..............#####..##..######.................',
    '...........#######...#...#####..................',
    '....###.#.#####.###.#.#..##.#######...###.......',
    '......####.#.#.##........#.#.########...#.......',
    '.......####.#.###...#...###.#.#.#####...##......',
    '.......###.#.###........##.#.#.#.#####.#........',
    '......###.#.###.....#...###.#.#.#######.#.......',
    '....####...####.......########.#.###...#........',
    '...########.##.......##########.#.#....##.......',
    '...#.###.#.###.......###########.#.#..###.......',
    '..#.###.#.####....#####.#######.###.######......',
    '.#####.#.###.#........##.#######.##########.....',
    '#####.#.#.#.###..####..#..#######.###.#####.....',
    '##.###.#.#.#.###..####.###.#######.##########...',
    '#.###.#.###.###...#.#####.#.#####.###.#####.###.',
    '..###..###.#####..#.#####....#####.###.####..###',
    '.####.###.######..#####..#....#######.#.###.....',
    '..####.###.##..##..#.#...#......######.#.###....',
    '..###.###.#.#...#.###.#..##....######.#.#.###...',
    '.#######.#.###....#######......###.###.#.###.#..',
    '#######.#.#.###...#########.#.#######.#...###.#.',
    '########.#.#.###...#######.....#####.#.#...#.#..',
    '#########.#.#.###...#####.......###.#.###.###.#.',
    '########.###.#.#.#...........#....##.#.###.#....',
    '.##########.#.#.#....##...........###.#.####....',
    '.#.#####.###.#.#.#....##..........####.#####....',
    '#.#####.#####.#.###...#.#.........#####.####..##',
    '.#######.#####.#.##....#.#.......#######.#....#.',
    '#.#####.#####.#.#.#.....#.###..###########...##.',
    '.#####.#######.#####.....##....###.....###....##',
    '#######.#####.###.####....#.#####.#.....##....#.',
    '######.#####.###...#.###....####................',
    '#####.#####.###...##..##########.#..............',
    '.#########.#####...#..####.#.###................',
    '..###############.....#####.#.###...............',
    '...#########.##.##....######.#.###..............',
    '..###.#.#######.###.....#######.###.............',
    '..##.#.#.####.##.###.....###.#####.#............',
  ],
};

export const SPRITES = S;

// "Favorite" variants of the category icons: same size, drawn solid (or with a heart) so a favorite stands out in the list.
export const SPRITES_FAV = {
  classical: [
    '..#####',
    '..#####',
    '..#####',
    '..#####',
    '###.###',
    '###.###',
    '.......',
  ],
  pop: [
    '.##.##.',
    '#######',
    '#######',
    '.#####.',
    '..###..',
    '...#...',
    '.......',
  ],
  dance: [
    '...#...',
    '#.###.#',
    '.#####.',
    '#######',
    '.#####.',
    '#.###.#',
    '...#...',
  ],
  ndw: [
    '#.....#',
    '##...##',
    '#.#.#.#',
    '#.#.#.#',
    '#.###.#',
    '#..#..#',
    '#.....#',
  ],
  screen: [
    '.#...#.',
    '..#.#..',
    '#######',
    '#.#.#.#',
    '#.###.#',
    '#..#..#',
    '#######',
  ],
  videogame: [
    '.........',
    '.#######.',
    '#########',
    '#########',
    '#########',
    '###...###',
    '.##...##.',
  ],
  folk: [
    '......#',
    '.....##',
    '....###',
    '.######',
    '#######',
    '#####..',
    '.##....',
  ],
  custom: [
    '.....##',
    '....###',
    '...####',
    '..#####',
    '.######',
    '#######',
    '#######',
  ],
};

// Pop-up icons for adding / removing a favorite.
export const HEART = [
  '.###...###.',
  '#####.#####',
  '###########',
  '###########',
  '###########',
  '.#########.',
  '..#######..',
  '...#####...',
  '....###....',
  '.....#.....',
];
export const HEART_BROKEN = [
  '.###...###.',
  '####..#####',
  '#####.#####',
  '####..#####',
  '#####..####',
  '.####.####.',
  '..###..##..',
  '...##.##...',
  '....#..#...',
  '.....#.....',
];
// HEART_BROKEN cut along its crack (per-row split column) into two same-size sprites that overlay into the broken heart:
// the unfavorite animation flies the halves apart.
const HEART_SPLIT = [5, 5, 5, 5, 6, 5, 5, 5, 5, 5];
export const HEART_HALVES = [
  HEART_BROKEN.map((r, i) => r.slice(0, HEART_SPLIT[i]).padEnd(r.length, '.')),
  HEART_BROKEN.map((r, i) => '.'.repeat(HEART_SPLIT[i]) + r.slice(HEART_SPLIT[i])),
];
// The pop-up icons, by name (the Glyphs & icons gallery lists them and replays their animation).
export const POPUPS = { heart: HEART, 'heart broken': HEART_BROKEN };

// The list icon for a category (custom for unknown ones), in its favorite form when `fav`.
export const categorySprite = (category, fav = false) =>
  (fav ? SPRITES_FAV[category] || SPRITES_FAV.custom : null) || SPRITES[category] || SPRITES.custom;

// Signal strength: five rising bars, `level` (0-5) of them solid; the rest are just a dot at the foot.
export function signal(level) {
  const W = 14, H = 9, rows = Array.from({ length: H }, () => Array(W).fill('.'));
  for (let i = 0; i < 5; i++) {
    const h = 2 + Math.round(i * 1.75), x = i * 3;
    for (let y = H - h; y < H; y++) for (let dx = 0; dx < 2; dx++) {
      if (i < level || y === H - 1) rows[y][x + dx] = '#';
    }
  }
  return rows.map(r => r.join(''));
}

// Little envelope (new-message icon), same 14x9 footprint as the signal bars.
export function envelope() {
  return ['..............', '..............', '.############.', '.##........##.', '.#.#......#.#.', '.#..##..##..#.', '.#....##....#.', '.############.', '..............'];
}

// Battery outline with `level` (0-4) segments.
export function battery(level) {
  const rows = ['##############.', '#............##', '#............##', '#............##', '#............##', '#............##', '##############.'];
  return rows.map((r, y) => {
    if (y === 0 || y === 6) return r;
    const a = r.split('');
    for (let s = 0; s < level; s++) for (let x = 0; x < 2; x++) a[2 + s * 3 + x] = '#';
    return a.join('');
  });
}

// Stamp sprites onto a W x H canvas of rows.
export function compose(W, H, parts) {
  const rows = Array.from({ length: H }, () => Array(W).fill('.'));
  for (const [spr, ox, oy] of parts) {
    spr.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) {
        const X = ox + x, Y = oy + y;
        if (r[x] === '#' && X >= 0 && Y >= 0 && X < W && Y < H) rows[Y][X] = '#';
      }
    });
  }
  return rows.map(r => r.join(''));
}

// rows -> SVG markup (horizontal runs merged, crispEdges)
export function spriteSVG(rows, ink = '#000') {
  let rects = '';
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length;) {
      if (r[x] !== '#') { x++; continue; }
      let e = x;
      while (r[e] === '#') e++;
      rects += `<rect x="${x}" y="${y}" width="${e - x}" height="1"/>`;
      x = e;
    }
  });
  const w = rows[0].length, h = rows.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
    `shape-rendering="crispEdges" fill="${ink}">${rects}</svg>`;
}

const urls = new Map();
export function spriteURL(rows) {
  const key = rows.join('/');
  let u = urls.get(key);
  if (!u) { u = 'data:image/svg+xml,' + encodeURIComponent(spriteSVG(rows)); urls.set(key, u); }
  return u;
}

// An inline element that paints the sprite in the current text colour at `px` CSS px per sprite pixel.
export function spriteHTML(rows, px = 2, cls = '') {
  const u = spriteURL(rows);
  return `<i class="spr ${cls}" aria-hidden="true" style="width:${rows[0].length * px}px;height:${rows.length * px}px;` +
    `-webkit-mask-image:url(&quot;${u}&quot;);mask-image:url(&quot;${u}&quot;)"></i>`;
}

// Same, applied to an existing element (no innerHTML churn on per-frame updates).
export function setSprite(el, rows, px = 2) {
  const u = spriteURL(rows);
  if (el._spr === u) return;
  el._spr = u;
  el.style.width = rows[0].length * px + 'px';
  el.style.height = rows.length * px + 'px';
  el.style.webkitMaskImage = el.style.maskImage = `url("${u}")`;
}

// Sort-order icons (7 px wide), shown instead of the name when the header has no room for it; ICON_FIND does the same for "Find".
export const SORT_ICONS = {
  'diff-asc': ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'], // star: rating
  title: ['.#.###.', '#.#..#.', '###.#..', '#.##...', '#.####.'].map(r => r.slice(0, 7)),     // A Z
  bpm: ['...#...', '..###..', '..#.#..', '.#.#.#.', '.#.#.#.', '#..#..#', '#######'],      // metronome
  length: ['#######', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#######'],     // hourglass: duration
  fav: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],                   // heart
};
// Language toggle on the title screen.
export const ICON_GLOBE = ['..#####..', '.#..#..#.', '#...#...#', '#########', '#...#...#', '#########', '#...#...#', '.#..#..#.', '..#####..'];
export const ICON_FIND = ['.###...', '#...#..', '#...#..', '#...#..', '.###...', '....##.', '.....##'];
