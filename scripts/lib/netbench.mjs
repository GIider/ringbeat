// Helpers for scripts/net-bench.mjs: a synthetic GET /boards snapshot, format variants of it, compression sizes, timing.
import { gzipSync, brotliCompressSync, gunzipSync, brotliDecompressSync, inflateSync, constants } from 'node:zlib';
import { mulberry32 } from '../../src/bot.js';

export const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
export const percentile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] : 0; };
export const kb = n => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');
export const ms = n => (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.round(n))) + ' ms';

const NAMES = ['Nova', 'Pixel', 'Beep', 'Snake', 'Ringo', 'Buzz', 'Chirp', 'Tonal', 'Echo', 'Fuzz', 'Wave', 'Byte', 'Trill', 'Riff', 'Dial', 'Ping'];
const GRADES = ['S', 'A', 'B', 'C'];
const MODS = [[], [], [], [], ['hidden'], ['fast'], ['hidden', 'fast']];

// `boards` boards x `top` rows, in the shape rebuildBoards (server/src/index.js) stores: { songId: [row] }. Seeded.
export function synthBoards({ boards = 367, top = 10, seed = 1 } = {}) {
  const rnd = mulberry32(seed), out = {};
  for (let b = 0; b < boards; b++) {
    const total = top + Math.floor(rnd() * 40);
    let score = 700_000 + Math.floor(rnd() * 300_000);
    out[`song-${String(b).padStart(3, '0')}-some-title`] = Array.from({ length: top }, (_, i) => {
      score -= Math.floor(rnd() * 20_000);
      const ap = i === 0 && rnd() < 0.1, fc = ap || rnd() < 0.3;
      return {
        rank: i + 1, total, name: NAMES[Math.floor(rnd() * NAMES.length)] + (rnd() < 0.5 ? '-' + (1 + Math.floor(rnd() * 40)) : ''),
        score, grade: GRADES[Math.min(3, i >> 1)], accuracy: Math.round((0.99 - i * 0.02 - rnd() * 0.02) * 10_000) / 10_000,
        maxCombo: 50 + Math.floor(rnd() * 400), fc, ap, mods: MODS[Math.floor(rnd() * MODS.length)],
        playedAt: 1_760_000_000_000 + Math.floor(rnd() * 3e9), ...(rnd() < 0.05 && { dev: true }),
      };
    });
  }
  return out;
}

// The snapshot body as the Worker sends it.
export const bodyOf = (boards, extra = {}) => JSON.stringify({ rules: '1', built: 1_760_000_000_000, ...extra, boards });

// Format variants measured (and, if they pay off, adopted in step 2 of the plan).
// slim: no per-row rank/total (hoisted), no empty mods, no false fc/ap. top3: only each board's first 3 rows.
export function slimBoards(boards) {
  const out = {};
  for (const [k, rows] of Object.entries(boards)) {
    out[k] = { total: rows[0] ? rows[0].total : 0, rows: rows.map(({ rank, total, mods, fc, ap, ...r }) => ({ ...r, ...(mods.length && { mods }), ...(fc && { fc }), ...(ap && { ap }) })) };
  }
  return out;
}
export const expandBoards = slim => Object.fromEntries(Object.entries(slim).map(([k, b]) => [k, b.rows.map((r, i) => ({ rank: i + 1, total: b.total, ...r, fc: !!r.fc, ap: !!r.ap, mods: r.mods || [] }))]));
export const topBoards = (boards, n) => Object.fromEntries(Object.entries(boards).map(([k, rows]) => [k, rows.slice(0, n)]));

export const variants = boards => [
  { name: 'current (top 10)', body: bodyOf(boards) },
  { name: 'slim rows', body: bodyOf(slimBoards(boards), { v: 2 }), expand: true },
  { name: 'current, top 3', body: bodyOf(topBoards(boards, 3)) },
  { name: 'slim rows, top 3', body: bodyOf(slimBoards(topBoards(boards, 3)), { v: 2 }), expand: true },
];

export const DECODERS = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync };

// Median ms of `fn` over `runs` calls (after a few warm-ups).
export function timeIt(fn, runs = 30) {
  for (let i = 0; i < 3; i++) fn();
  const t = [];
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); }
  return median(t);
}

// Sizes and timings of one body. -> a row for console.table.
export function measureBody({ name, body, expand }, runs = 30) {
  const raw = Buffer.from(body);
  const gz = gzipSync(raw, { level: 6 });
  const br4 = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
  const br11 = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  const parsed = JSON.parse(body);
  return {
    variant: name, raw: kb(raw.length), gzip6: kb(gz.length), 'br 4': kb(br4.length), 'br 11': kb(br11.length),
    'gunzip': ms(timeIt(() => gunzipSync(gz), runs)), 'unbrotli': ms(timeIt(() => brotliDecompressSync(br4), runs)),
    parse: ms(timeIt(() => JSON.parse(body), runs)), expand: expand ? ms(timeIt(() => expandBoards(parsed.boards), runs)) : '-',
  };
}
