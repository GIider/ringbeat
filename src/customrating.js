// Difficulty ratings of custom songs: validation of stored / imported values and the compact share-link form.
// A rating record is { v, normal: {rating, tags}, hard: {rating, tags}, imported? }; `v` is bot.js's CALC_VERSION.
import { CALC_VERSION, SPECIALISTS } from './bot.js';

const DIFFS = ['normal', 'hard'];
const TAG_NAMES = SPECIALISTS.map(s => s.tag);

function cleanDiff(x) {
  if (!x || typeof x.rating !== 'number' || !isFinite(x.rating)) return null;
  const tags = Array.isArray(x.tags) ? [...new Set(x.tags.filter(t => TAG_NAMES.includes(t)))].slice(0, 2) : [];
  return { rating: Math.round(Math.max(1, Math.min(10, x.rating)) * 10) / 10, tags };
}

// Returns a clean record, or null when it is missing, malformed or from another calculation version.
export function cleanRating(r) {
  if (!r || r.v !== CALC_VERSION) return null;
  const out = { v: CALC_VERSION };
  for (const d of DIFFS) { const c = cleanDiff(r[d]); if (!c) return null; out[d] = c; }
  if (r.imported) out.imported = true;
  return out;
}

// Record from a finished measurement: { normal: measureChart result, hard: ... }.
export const ratingFromMeasured = m => cleanRating({ v: CALC_VERSION, normal: m.normal, hard: m.hard });

// Share form "<v>.<normal*10>.<hard*10>.<normal tag indices>.<hard tag indices>", e.g. "1.42.65.03.".
export function encodeRating(r) {
  r = cleanRating(r);
  if (!r) return '';
  const tagIdx = d => r[d].tags.map(t => TAG_NAMES.indexOf(t)).join('');
  return [r.v, Math.round(r.normal.rating * 10), Math.round(r.hard.rating * 10), tagIdx('normal'), tagIdx('hard')].join('.');
}

// Never throws; returns an unverified (`imported`) record, or null for anything garbled or from another version.
export function decodeRating(str) {
  const m = /^(\d{1,4})\.(\d{1,3})\.(\d{1,3})\.(\d{0,4})\.(\d{0,4})$/.exec(String(str || ''));
  if (!m) return null;
  const tags = s => [...s].map(i => TAG_NAMES[+i]).filter(Boolean);
  return cleanRating({
    v: +m[1], imported: true,
    normal: { rating: +m[2] / 10, tags: tags(m[4]) },
    hard: { rating: +m[3] / 10, tags: tags(m[5]) },
  });
}
