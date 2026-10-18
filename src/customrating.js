// Difficulty ratings of custom songs: validation of stored / imported values and the compact share-link form.
// A rating record is { v, rating, tags, imported? }; `v` is bot.js's CALC_VERSION.
import { CALC_VERSION, SPECIALISTS } from './bot.js';

const TAG_NAMES = SPECIALISTS.map(s => s.tag);

function cleanOne(x) {
  if (!x || typeof x.rating !== 'number' || !isFinite(x.rating)) return null;
  const tags = Array.isArray(x.tags) ? [...new Set(x.tags.filter(t => TAG_NAMES.includes(t)))].slice(0, 2) : [];
  return { rating: Math.round(Math.max(1, Math.min(10, x.rating)) * 10) / 10, tags };
}

// Returns a clean record, or null when it is missing, malformed or from another calculation version.
export function cleanRating(r) {
  if (!r || r.v !== CALC_VERSION) return null;
  const c = cleanOne(r);
  if (!c) return null;
  const out = { v: CALC_VERSION, ...c };
  if (r.imported) out.imported = true;
  return out;
}

// Record from a finished measurement (a measureChart result).
export const ratingFromMeasured = m => cleanRating({ v: CALC_VERSION, rating: m.rating, tags: m.tags });

// Share form "<v>.<rating*10>.<tag indices>", e.g. "2.65.03".
export function encodeRating(r) {
  r = cleanRating(r);
  if (!r) return '';
  return [r.v, Math.round(r.rating * 10), r.tags.map(t => TAG_NAMES.indexOf(t)).join('')].join('.');
}

// Never throws; returns an unverified (`imported`) record, or null for anything garbled or from another version.
export function decodeRating(str) {
  const m = /^(\d{1,4})\.(\d{1,3})\.(\d{0,4})$/.exec(String(str || ''));
  if (!m) return null;
  return cleanRating({
    v: +m[1], imported: true, rating: +m[2] / 10,
    tags: [...m[3]].map(i => TAG_NAMES[+i]).filter(Boolean),
  });
}
