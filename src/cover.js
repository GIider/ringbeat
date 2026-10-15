// Procedural song art as a 72x28 1-bit "picture message": a scene (night, dusk or day) with a sky, a ground
// (hills, skyline, sea or mountains), small details and the song's category motif enlarged in front.
// Derived from the song id; returned as sprite rows (see pixelart.js).
import { hashString } from './library.js';
import { SPRITES, compose } from './pixelart.js';

export const COVER_W = 72, COVER_H = 28;

function rng(seed) {
  let s = parseInt(seed, 36) || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 374761393 | 0) >>> 0) / 4294967296;
}

const scale2 = rows => rows.flatMap(r => { const w = r.replace(/./g, c => c + c); return [w, w]; });

// Per-category leanings: [scenes, grounds]; the rng still picks within them.
const BIAS = {
  classical: [['night', 'dusk'], ['hills', 'mountains']],
  pop: [['night', 'dusk', 'day'], ['skyline', 'hills', 'sea']],
  dance: [['night', 'dusk'], ['skyline', 'sea']],
  ndw: [['dusk', 'night'], ['skyline', 'mountains']],
  screen: [['night', 'day'], ['skyline', 'mountains', 'sea']],
  videogame: [['day', 'dusk'], ['hills', 'mountains', 'skyline']],
  folk: [['day', 'dusk'], ['hills', 'sea']],
};
const SCENES = ['night', 'dusk', 'day'], GROUNDS = ['hills', 'skyline', 'sea', 'mountains'];

const cache = new Map();
export function coverRows(id, category = '') {
  const key = id + '|' + category;
  if (cache.has(key)) return cache.get(key);
  const r = rng(hashString(id));
  const ri = n => Math.floor(r() * n);
  const pick = a => a[ri(a.length)];
  const W = COVER_W, H = COVER_H;
  const px = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) px[y][x] = '#'; };
  const clear = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) px[y][x] = '.'; };
  const disc = (cx, cy, rad, fill = true) => {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      const d = x * x + y * y;
      if (d <= rad * rad + 1 && (fill || d >= (rad - 1) * (rad - 1))) set(cx + x, cy + y);
    }
  };

  // Fixed draw order and rng consumption: a given id keeps its look regardless of which branches run.
  const [sceneOpts, groundOpts] = BIAS[category] || [SCENES, GROUNDS];
  const scene = r() < 0.75 ? pick(sceneOpts) : pick(SCENES);
  const ground = r() < 0.75 ? pick(groundOpts) : pick(GROUNDS);
  const sx = 6 + ri(W - 12), sr = 3 + ri(2), cres = r() < 0.5;
  const starSeed = Array.from({ length: 16 }, () => [ri(W), ri(12)]);
  const cloudSeed = Array.from({ length: 3 }, () => [ri(W), 2 + ri(8), 3 + ri(4)]);
  const birdSeed = Array.from({ length: 3 }, () => [ri(W), 3 + ri(8)]);
  const extra = r(), framed = r() < 0.4;
  const a = 2 + r() * 3, f = 0.08 + r() * 0.1, ph = r() * 6;

  // sky
  if (scene !== 'day') for (const [x, y] of starSeed) {
    if (scene === 'dusk' && y > 7) continue;
    set(x, y);
    if (extra < 0.5 && x % 5 === 0) { set(x - 1, y); set(x + 1, y); set(x, y - 1); set(x, y + 1); } // twinkle
  }
  const horizon = H - 7;
  if (scene === 'night') {
    for (let y = -sr; y <= sr; y++) for (let x = -sr; x <= sr; x++) {
      if (x * x + y * y > sr * sr + 1) continue;
      if (cres && (x + 2) * (x + 2) + (y - 1) * (y - 1) <= sr * sr) continue;
      set(sx + x, 6 + y);
    }
    if (extra > 0.7) { // shooting star
      const x0 = ri(W - 20) + 14;
      for (let i = 0; i < 8; i++) set(x0 - i, 2 + (i >> 1));
    }
  } else if (scene === 'dusk') { // low sun sinking into the horizon, scanline gaps
    const cy = horizon - 1;
    for (let y = -6; y <= 0; y++) for (let x = -7; x <= 7; x++) {
      if (x * x + y * y > 42 || (y % 2 === 0 && y < -1 && y !== -6)) continue;
      set(sx + x, cy + y);
    }
  } else { // day: sun with rays, clouds
    const cy = 6;
    disc(sx, cy, 3);
    for (let i = 0; i < 8; i++) {
      const an = i * Math.PI / 4;
      set(Math.round(sx + Math.cos(an) * 6), Math.round(cy + Math.sin(an) * 6));
      set(Math.round(sx + Math.cos(an) * 5), Math.round(cy + Math.sin(an) * 5));
    }
    for (const [x, y, w] of cloudSeed.slice(0, 1 + (extra < 0.5 ? 1 : 0) + (extra < 0.2 ? 1 : 0))) {
      if (Math.abs(x - sx) < 11) continue;
      for (let dx = 0; dx < w + 2; dx++) set(x + dx, y + 2);
      for (let dx = 1; dx < w + 1; dx++) set(x + dx, y + 1);
      for (let dx = 2; dx < w; dx++) set(x + dx, y);
    }
  }
  if (scene !== 'night' && extra > 0.45) { // birds
    for (const [x, y] of birdSeed.slice(0, 2 + (extra > 0.8 ? 1 : 0))) {
      if (Math.abs(x - sx) < 9) continue;
      set(x, y); set(x + 1, y + 1); set(x + 2, y); set(x + 3, y - 1); set(x + 4, y);
    }
  }

  // ground
  if (ground === 'hills') {
    const tops = [];
    for (let x = 0; x < W; x++) {
      const top = Math.round(horizon - a * Math.sin(x * f + ph));
      tops.push(top);
      for (let y = top; y < H; y++) if (y === top || (x + y) % 2 === 0) set(x, y);
    }
    for (let i = 0, x = 3 + ri(8); x < W - 3 && i < 5; i++, x += 9 + ri(10)) { // pines
      const t = tops[x], h = 5 + (i & 1);
      for (let k = 0; k < h; k++) { const w = Math.min(k >> 1, 2); for (let d = -w; d <= w; d++) set(x + d, t - h + k); }
      set(x, t - h - 1);
    }
  } else if (ground === 'skyline') {
    for (let x = 0; x < W;) {
      const w = 4 + ri(6), h = 6 + ri(10), roof = ri(4);
      for (let dx = 0; dx < w && x + dx < W; dx++) {
        for (let y = H - h; y < H; y++) {
          const edge = dx === 0 || dx === w - 1 || y === H - h;
          const lit = dx % 2 === 1 && y % 3 === 0 && r() < 0.6;
          if (edge || lit) set(x + dx, y);
        }
      }
      if (roof === 0) for (let y = 1; y <= 3; y++) set(x + (w >> 1), H - h - y); // antenna
      else if (roof === 1 && w > 5) { set(x + 1, H - h - 1); set(x + 2, H - h - 1); set(x + 1, H - h - 2); set(x + 2, H - h - 2); } // tank
      x += w + ri(2);
    }
  } else if (ground === 'sea') {
    for (let y = horizon; y < H; y++) {
      const row = y - horizon;
      for (let x = 0; x < W; x++) {
        if (row === 0) set(x, y);
        else if ((x + row * 3 + (row % 2) * 2) % (4 + row % 3) < 2 && (x + y) % 2 === 0) set(x, y);
      }
    }
    const bx = 8 + ri(W - 24); // sailboat
    for (let k = 0; k < 5; k++) set(bx, horizon - 1 - k);
    for (let k = 1; k < 4; k++) for (let d = 1; d <= 4 - k; d++) set(bx + d, horizon - 1 - k);
    for (let d = -2; d <= 3; d++) set(bx + d, horizon - 0);
  } else { // mountains
    const peaks = [];
    for (let x = 0; x < W + 12; x += 14 + ri(8)) peaks.push([x, 9 + ri(9)]);
    for (const [px0, h] of peaks) {
      for (let k = 0; k <= h; k++) {
        const y = H - h + k;
        set(px0 - k, y); set(px0 + k, y);
        if (k > 3 && k % 3 === 0) for (let d = -k + 2; d < k - 1; d += 2) set(px0 + d, y); // ridge texture
      }
      if (h > 12) { set(px0, H - h + 1); set(px0 - 1, H - h + 2); set(px0 + 1, H - h + 2); } // snow cap
    }
    for (let x = 0; x < W; x++) set(x, H - 1);
  }

  if (framed) { // dotted picture frame with notched corners
    for (let x = 1; x < W - 1; x += 2) { set(x, 0); set(x, H - 1); }
    for (let y = 1; y < H - 1; y += 2) { set(0, y); set(W - 1, y); }
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) set(x, y);
    clear(1, 1); clear(W - 2, 1);
  }

  let rows = px.map(row => row.join(''));
  const motif = SPRITES[category];
  if (motif) {
    // clear a halo, then stamp the motif at 2x
    const big = scale2(motif), ox = r() < 0.5 ? 6 : W - big[0].length - 6, oy = H - big.length - 3;
    rows = rows.map((row, y) => row.split('').map((c, x) =>
      (x >= ox - 2 && x < ox + big[0].length + 2 && y >= oy - 2 && y < oy + big.length + 2) ? '.' : c).join(''));
    const parts = [[rows, 0, 0], [big, ox, oy]];
    const note = SPRITES.note; // a small note drifting up beside the motif
    if (note && extra > 0.3) {
      const nx = ox < W / 2 ? ox + big[0].length + 4 : ox - note[0].length - 4;
      parts.push([note, Math.max(1, nx), Math.max(1, oy - note.length - 1)]);
    }
    rows = compose(W, H, parts);
  }
  cache.set(key, rows);
  return rows;
}
