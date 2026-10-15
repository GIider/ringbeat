// Procedural song art as a 72x28 1-bit "picture message": a night scene (moon, stars, hills or a skyline)
// with the song's category motif enlarged in front. Derived from the song id; returned as sprite rows (see pixelart.js).
import { hashString } from './library.js';
import { SPRITES, compose } from './pixelart.js';

export const COVER_W = 72, COVER_H = 28;

function rng(seed) {
  let s = parseInt(seed, 36) || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 374761393 | 0) >>> 0) / 4294967296;
}

const scale2 = rows => rows.flatMap(r => { const w = r.replace(/./g, c => c + c); return [w, w]; });

const cache = new Map();
export function coverRows(id, category = '') {
  const key = id + '|' + category;
  if (cache.has(key)) return cache.get(key);
  const r = rng(hashString(id));
  const W = COVER_W, H = COVER_H;
  const px = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) px[y][x] = '#'; };
  // stars
  for (let i = 0; i < 16; i++) set(Math.floor(r() * W), Math.floor(r() * 12));
  // moon: full or crescent
  const mx = 6 + Math.floor(r() * 56), my = 5 + Math.floor(r() * 3), mr = 3 + Math.floor(r() * 2), cres = r() < 0.5;
  for (let y = -mr; y <= mr; y++) for (let x = -mr; x <= mr; x++) {
    if (x * x + y * y > mr * mr + 1) continue;
    if (cres && (x + 2) * (x + 2) + (y - 1) * (y - 1) <= mr * mr) continue;
    set(mx + x, my + y);
  }
  // ground: rolling hills or a city skyline
  if (r() < 0.5) {
    const a = 2 + r() * 3, f = 0.08 + r() * 0.1, ph = r() * 6;
    for (let x = 0; x < W; x++) {
      const top = Math.round(H - 7 - a * Math.sin(x * f + ph));
      for (let y = top; y < H; y++) if (y === top || (x + y) % 2 === 0) set(x, y);
    }
  } else {
    for (let x = 0; x < W;) {
      const w = 4 + Math.floor(r() * 6), h = 6 + Math.floor(r() * 10);
      for (let dx = 0; dx < w && x + dx < W; dx++) {
        for (let y = H - h; y < H; y++) {
          const edge = dx === 0 || dx === w - 1 || y === H - h;
          const lit = dx % 2 === 1 && y % 3 === 0 && r() < 0.6;
          if (edge || lit) set(x + dx, y);
        }
      }
      x += w + Math.floor(r() * 2);
    }
  }
  let rows = px.map(row => row.join(''));
  const motif = SPRITES[category];
  if (motif) {
    // clear a halo, then stamp the motif at 2x
    const big = scale2(motif), ox = r() < 0.5 ? 6 : W - big[0].length - 6, oy = H - big.length - 3;
    rows = rows.map((row, y) => row.split('').map((c, x) =>
      (x >= ox - 2 && x < ox + big[0].length + 2 && y >= oy - 2 && y < oy + big.length + 2) ? '.' : c).join(''));
    rows = compose(W, H, [[rows, 0, 0], [big, ox, oy]]);
  }
  cache.set(key, rows);
  return rows;
}

