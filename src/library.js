// Song library: built-in songs plus the user's custom (pasted / shared) song, with derived metadata.
import { parseRTTTL } from './rtttl.js';
import { generateChart } from './chart.js';
import { SONGS } from './songs.js';

// Bot-measured difficulty ({songId: {rating, tags}}, from scripts/bench.mjs); set once at startup.
let measured = {};
export function setMeasured(data) { measured = data && typeof data === 'object' ? data : {}; }
// Stars 1..5 from a bot rating 1..10.
const starsFromRating = r => Math.max(1, Math.min(5, Math.round(r / 1.4)));

// Difficulty rating 1..5 from the chart's note density (notes per second).
export function starsFor(chart) {
  const density = chart.notes.length / Math.max(1, chart.length);
  return Math.max(1, Math.min(5, Math.round(0.8 + density * 0.9)));
}

// Small stable string hash -> base36 (ids for custom songs, so scores follow the melody).
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// Parsed song + generated chart per RTTTL string: the library is rebuilt when measured ratings arrive, and only the
// rating lookup changes then, so the (pure) parse/chart work is reused.
const derived = new Map();
function derive(rtttl) {
  let d = derived.get(rtttl);
  if (d) return d;
  const song = parseRTTTL(rtttl);
  d = { song, chart: null };
  try { d.chart = generateChart(song); } catch { /* unplayable: makeEntry returns null */ }
  if (derived.size > 256) derived.clear();
  derived.set(rtttl, d);
  return d;
}

// Build a library entry; returns null if the RTTTL cannot be parsed or charted.
// `own` is a custom song's stored rating record (customrating.js), used instead of the bundled measurements.
export function makeEntry({ id, title, tag, category, rtttl, own }) {
  let song, chart;
  try { ({ song, chart } = derive(rtttl)); } catch { return null; }
  if (!chart || !chart.length) return null;
  const m = own ? own : measured[id];
  const measuredOk = m && typeof m.rating === 'number';
  const rating = measuredOk ? m.rating : undefined;
  const tags = measuredOk && Array.isArray(m.tags) ? m.tags : [];
  const stars = measuredOk ? starsFromRating(m.rating) : starsFor(chart);
  const estimated = !measuredOk || !!(own && own.imported); // only the density heuristic, or an unverified imported rating
  return {
    id, rtttl, tag: tag || '', category: category || '', song,
    title: title || song.name || 'Untitled',
    bpm: song.bpm, length: chart.length, stars, notes: chart.notes.length, rating, tags, estimated,
  };
}

export function buildLibrary() {
  return SONGS.map(makeEntry).filter(Boolean);
}

export function customEntry(rtttl, own = null) {
  return makeEntry({ id: 'custom:' + hashString(rtttl.trim()), tag: 'Custom', category: 'custom', rtttl: rtttl.trim(), own });
}

export function formatLength(sec) {
  const s = Math.round(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
